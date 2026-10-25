import { app, net } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import { getJavaInstallInstructions } from '../src/lib/javaRuntime.js';

const LANGUAGETOOL_VERSION = '6.6';
const LANGUAGETOOL_URL = `https://languagetool.org/download/LanguageTool-${LANGUAGETOOL_VERSION}.zip`;
const MAX_ARCHIVE_BYTES = 300_000_000;
const MAX_EXTRACTED_BYTES = 2_000_000_000;
const MAX_TEXT_LENGTH = 20_000;
const MAX_RESPONSE_BYTES = 12_000_000;

let root;
let installPromise = null;
let progressReporter = () => {};
let serverProcess = null;
let serverPort = null;
let serverStart = null;
let serverIdleTimer = null;
let checkQueue = Promise.resolve();
let javaCheckPromise = null;
let javaCheckCache = null;
let javaCheckAt = 0;
const JAVA_CHECK_CACHE_MS = 30_000;

export function setGrammarProgressReporter(reporter) {
  if (typeof reporter !== 'function') throw new TypeError('Progress reporter must be a function');
  progressReporter = reporter;
}

function grammarRoot() {
  if (!root) root = path.join(app.getPath('userData'), 'orbit-grammar');
  return root;
}

function installDirectory() {
  return path.join(grammarRoot(), `LanguageTool-${LANGUAGETOOL_VERSION}`);
}

function serverJar() {
  return path.join(installDirectory(), 'languagetool-server.jar');
}

function readLinuxDistro() {
  if (process.platform !== 'linux') return {};
  try {
    const release = fs.readFileSync('/etc/os-release', 'utf8');
    const read = (key) => {
      const value = release.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim();
      return value?.replace(/^["']|["']$/g, '') || '';
    };
    return { distroId: read('ID'), distroLike: read('ID_LIKE') };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[orbit] détection de la distribution Linux échouée:', error);
    }
    return {};
  }
}

function javaVersion({ refresh = false } = {}) {
  if (refresh) {
    javaCheckCache = null;
    javaCheckAt = 0;
  }
  if (javaCheckCache && Date.now() - javaCheckAt < JAVA_CHECK_CACHE_MS) {
    return Promise.resolve(javaCheckCache);
  }
  if (javaCheckPromise) return javaCheckPromise;

  javaCheckPromise = new Promise((resolve) => {
    let child;
    let output = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      javaCheckCache = result;
      javaCheckAt = Date.now();
      resolve(result);
    };
    const timer = setTimeout(() => {
      child?.kill();
      finish({ available: false, version: null });
    }, 2500);
    timer.unref?.();
    try {
      child = spawn('java', ['-version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      finish({ available: false, version: null });
      return;
    }
    const collect = (chunk) => {
      if (output.length < 4096) output += chunk.toString('utf8').slice(0, 4096 - output.length);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', () => finish({ available: false, version: null }));
    child.once('close', (code) => {
      const version = output.match(/version\s+"?(\d+)(?:\.(\d+))?/i);
      const major = version ? Number(version[1] === '1' ? version[2] : version[1]) : null;
      finish({ available: code === 0 && major >= 17, version: major });
    });
  }).finally(() => {
    javaCheckPromise = null;
  });
  return javaCheckPromise;
}

export async function getGrammarState(options = {}) {
  let installed = false;
  try {
    installed = fs.statSync(serverJar()).isFile();
  } catch {
    installed = false;
  }
  const java = await javaVersion({ refresh: options?.refreshJava === true });
  const installInstructions = getJavaInstallInstructions(process.platform, readLinuxDistro());
  return {
    success: true,
    installed,
    javaAvailable: java.available,
    javaVersion: java.version,
    javaInstallLabel: installInstructions.label,
    javaInstallCommand: installInstructions.command,
    platform: process.platform,
    downloading: Boolean(installPromise),
    running: Boolean(serverProcess && serverProcess.exitCode === null),
    downloadBytes: MAX_ARCHIVE_BYTES,
    version: LANGUAGETOOL_VERSION,
  };
}

async function downloadArchive(destination) {
  const response = await net.fetch(LANGUAGETOOL_URL, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`LanguageTool download failed: HTTP ${response.status}`);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  if (total > MAX_ARCHIVE_BYTES) throw new Error('LanguageTool archive exceeds the allowed size');

  const temporary = `${destination}.part`;
  const output = fs.createWriteStream(temporary);
  let received = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_ARCHIVE_BYTES) throw new Error('LanguageTool archive exceeds the allowed size');
      if (!output.write(Buffer.from(value))) {
        await new Promise((resolve, reject) => {
          output.once('drain', resolve);
          output.once('error', reject);
        });
      }
      progressReporter({ phase: 'download', received, total });
    }
    await new Promise((resolve, reject) => {
      output.once('error', reject);
      output.end(resolve);
    });
    if (!received) throw new Error('LanguageTool archive is empty');
    fs.renameSync(temporary, destination);
  } catch (error) {
    response.body.cancel().catch(() => {});
    output.destroy();
    try {
      fs.unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        console.error('[orbit] nettoyage du téléchargement LanguageTool échoué:', cleanupError);
      }
    }
    throw error;
  }
}

async function extractArchive(archive, destination) {
  const zipfile = await promisify(yauzl.open)(archive, { lazyEntries: true });
  const destinationRoot = path.resolve(destination);
  let extractedBytes = 0;
  let foundServerJar = false;

  await new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      zipfile.close();
      reject(error);
    };
    zipfile.on('error', fail);
    zipfile.on('end', () => {
      if (settled) return;
      settled = true;
      if (!foundServerJar) reject(new Error('LanguageTool server is missing from its archive'));
      else resolve();
    });
    zipfile.on('entry', (entry) => {
      const entryName = entry.fileName.replace(/\\/g, '/');
      if (!entryName.startsWith(`LanguageTool-${LANGUAGETOOL_VERSION}/`)) {
        fail(new Error('Unexpected path in LanguageTool archive'));
        return;
      }
      const target = path.resolve(destinationRoot, entryName);
      const relative = path.relative(destinationRoot, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        fail(new Error('Unsafe path in LanguageTool archive'));
        return;
      }
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (mode === 0xa000) {
        fail(new Error('Symbolic links are not allowed in LanguageTool archive'));
        return;
      }
      extractedBytes += entry.uncompressedSize;
      if (extractedBytes > MAX_EXTRACTED_BYTES) {
        fail(new Error('LanguageTool archive expands beyond the allowed size'));
        return;
      }

      if (entryName.endsWith('/')) {
        fs.mkdirSync(target, { recursive: true });
        zipfile.readEntry();
        return;
      }
      if (entryName === `LanguageTool-${LANGUAGETOOL_VERSION}/languagetool-server.jar`) {
        foundServerJar = true;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      zipfile.openReadStream(entry, (error, stream) => {
        if (error) {
          fail(error);
          return;
        }
        const output = fs.createWriteStream(target, { flags: 'wx' });
        output.once('error', fail);
        output.once('finish', () => {
          if (!settled) zipfile.readEntry();
        });
        stream.once('error', fail);
        stream.pipe(output);
      });
    });
    zipfile.readEntry();
  });
}

export async function installLanguageTool() {
  if (installPromise) return installPromise;
  const java = await javaVersion();
  if (!java.available) {
    return {
      success: false,
      error: java.version ? 'java-version' : 'java-missing',
    };
  }
  if ((await getGrammarState()).installed) return { success: true, alreadyInstalled: true };

  installPromise = (async () => {
    const base = grammarRoot();
    const archive = path.join(base, `LanguageTool-${LANGUAGETOOL_VERSION}.zip`);
    const temporaryDirectory = path.join(base, `.LanguageTool-${LANGUAGETOOL_VERSION}.installing`);
    fs.mkdirSync(base, { recursive: true });
    try {
      progressReporter({ phase: 'download', received: 0, total: 0 });
      await downloadArchive(archive);
      progressReporter({ phase: 'extract', received: 0, total: 0 });
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      fs.mkdirSync(temporaryDirectory, { recursive: true });
      await extractArchive(archive, temporaryDirectory);
      const stagedRoot = path.join(temporaryDirectory, `LanguageTool-${LANGUAGETOOL_VERSION}`);
      const destination = installDirectory();
      fs.rmSync(destination, { recursive: true, force: true });
      fs.renameSync(stagedRoot, destination);
      return { success: true };
    } catch (error) {
      console.error('[orbit] installation de LanguageTool échouée:', error);
      return { success: false, error: String(error.message || error) };
    } finally {
      for (const target of [archive, temporaryDirectory]) {
        try {
          fs.rmSync(target, { recursive: true, force: true });
        } catch (error) {
          console.error('[orbit] nettoyage après installation de LanguageTool échoué:', error);
        }
      }
    }
  })();

  try {
    return await installPromise;
  } finally {
    installPromise = null;
  }
}

export async function removeLanguageTool() {
  if (installPromise) return { success: false, error: 'busy' };
  await checkQueue.catch(() => {});
  stopLanguageToolServer();
  try {
    fs.rmSync(installDirectory(), { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    console.error('[orbit] suppression de LanguageTool échouée:', error);
    return { success: false, error: String(error.message || error) };
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requestJson(port, pathname, body, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const encoded = body ? new URLSearchParams(body).toString() : null;
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: encoded ? 'POST' : 'GET',
      headers: encoded
        ? {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(encoded),
        }
        : undefined,
      timeout,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy(new Error('LanguageTool response exceeds the allowed size'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`LanguageTool returned HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('LanguageTool request timed out')));
    request.on('error', reject);
    if (encoded) request.write(encoded);
    request.end();
  });
}

async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function ensureLanguageToolServer() {
  clearTimeout(serverIdleTimer);
  serverIdleTimer = null;
  if (serverProcess && serverProcess.exitCode === null && serverPort) {
    try {
      await requestJson(serverPort, '/v2/languages', null, 2000);
      return serverPort;
    } catch {
      serverProcess.kill();
      serverProcess = null;
      serverPort = null;
    }
  }
  if (!serverStart) {
    serverStart = (async () => {
      if (!(await getGrammarState()).installed) throw new Error('LanguageTool is not installed');
      const java = await javaVersion();
      if (!java.available) throw new Error(java.version ? 'Java 17 or newer is required' : 'Java 17 or newer is required but was not found');
      const port = await reservePort();
      progressReporter({ phase: 'starting' });
      const child = spawn('java', [
        '-Xms64m',
        '-Xmx512m',
        '-cp',
        'languagetool-server.jar',
        'org.languagetool.server.HTTPServer',
        '--port',
        String(port),
      ], {
        cwd: installDirectory(),
        stdio: 'ignore',
        windowsHide: true,
      });
      serverProcess = child;
      serverPort = port;
      let childError = null;
      child.once('error', (error) => {
        childError = error;
      });
      child.once('exit', () => {
        if (serverProcess === child) {
          serverProcess = null;
          serverPort = null;
        }
      });
      const deadline = Date.now() + 60_000;
      let lastError;
      while (Date.now() < deadline) {
        if (childError) throw childError;
        if (child.exitCode !== null) throw new Error(`LanguageTool server exited with code ${child.exitCode}`);
        try {
          await requestJson(port, '/v2/languages', null, 1500);
          return port;
        } catch (error) {
          lastError = error;
          await wait(250);
        }
      }
      child.kill();
      serverProcess = null;
      serverPort = null;
      throw new Error(`LanguageTool server did not start: ${lastError?.message || 'timeout'}`);
    })();
  }

  try {
    return await serverStart;
  } finally {
    serverStart = null;
  }
}

function checkLanguageTool(text, language) {
  return ensureLanguageToolServer().then(async (port) => {
    const lang = language === 'fr' ? 'fr-FR' : 'en-US';
    const result = await requestJson(port, '/v2/check', { text, language: lang });
    if (!Array.isArray(result?.matches)) throw new Error('LanguageTool returned an invalid response');
    return { success: true, matches: result.matches };
  }).finally(scheduleServerStop);
}

function scheduleServerStop() {
  clearTimeout(serverIdleTimer);
  serverIdleTimer = setTimeout(stopLanguageToolServer, 5 * 60_000);
  serverIdleTimer.unref?.();
}

export function checkWithLanguageTool(text, language) {
  if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH) {
    return Promise.resolve({ success: false, error: 'invalid-text' });
  }
  if (!['fr', 'en'].includes(language)) {
    return Promise.resolve({ success: false, error: 'unsupported-language' });
  }
  const operation = checkQueue.then(() => checkLanguageTool(text, language));
  checkQueue = operation.catch(() => {});
  return operation.catch((error) => {
    console.error('[orbit] vérification LanguageTool échouée:', error);
    return { success: false, error: String(error.message || error) };
  });
}

function stopLanguageToolServer() {
  clearTimeout(serverIdleTimer);
  serverIdleTimer = null;
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
  serverProcess = null;
  serverPort = null;
}

app.once('before-quit', stopLanguageToolServer);
process.once('exit', stopLanguageToolServer);
