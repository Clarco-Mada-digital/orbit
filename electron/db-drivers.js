// ---------------------------------------------------------------------------
// Pilotes SQL téléchargés à la demande.
//
// SQL Server n'est pas embarqué dans Orbit (voir scripts/bundle-db-drivers.mjs) :
// il est téléchargé à la PREMIÈRE connexion SQL Server, depuis le même endroit
// que le catalogue d'extensions, puis gardé dans les données d'Orbit.
//
// Sécurité : l'empreinte SHA-256 attendue est celle de db-drivers.json, livré
// DANS Orbit. Le fichier téléchargé n'est écrit, et a fortiori exécuté, que
// s'il correspond octet pour octet. La taille est bornée pendant la réception.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const manifest = require('./db-drivers.json');
const MAX_BYTES = 16 * 1024 * 1024;
const loaded = new Map();
const pending = new Map();

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Adresse du pilote : à côté du catalogue (…/extensions/catalog.json →
// …/extensions/drivers/<fichier>).
export function driverUrl(catalogUrl, fileName) {
  const base = new URL(String(catalogUrl));
  return new URL(`drivers/${encodeURIComponent(fileName)}`, base).toString();
}

export function driverInfo(name) {
  return manifest[name] || null;
}

// État pour l'interface : faut-il encore télécharger ?
export function driverStatus(name, { dir }) {
  const info = driverInfo(name);
  if (!info) return { bundled: true };
  const target = path.join(dir, info.file);
  return { bundled: false, installed: fs.existsSync(target), size: info.size, version: info.version };
}

async function download(url, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`le serveur a répondu ${res.status}`);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > MAX_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error('fichier trop volumineux');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Charge un pilote : module embarqué s'il existe (développement), sinon
 * fichier vérifié dans `dir`, téléchargé au besoin.
 * @param {string} name   'mssql'
 * @param {object} opts   { dir, catalogUrl, fetch, preferBundled }
 */
export async function loadDriver(name, { dir, catalogUrl, fetch: fetchImpl, preferBundled = true }) {
  if (loaded.has(name)) return loaded.get(name);
  const info = driverInfo(name);
  if (!info) return require(name);
  if (preferBundled) {
    try {
      const mod = require(name);
      loaded.set(name, mod);
      return mod;
    } catch {
      /* non embarqué (version installée) : on télécharge */
    }
  }
  if (pending.has(name)) return pending.get(name);
  const job = (async () => {
    const target = path.join(dir, info.file);
    let buf = fs.existsSync(target) ? fs.readFileSync(target) : null;
    // Fichier local altéré ou incomplet : on le retélécharge.
    if (buf && sha256(buf) !== info.sha256) buf = null;
    if (!buf) {
      let data;
      try {
        data = await download(driverUrl(catalogUrl, info.file), fetchImpl);
      } catch (err) {
        throw new Error(`Téléchargement du pilote ${name} impossible (${err.message}). Vérifiez la connexion Internet puis réessayez.`);
      }
      if (sha256(data) !== info.sha256) {
        throw new Error(`Pilote ${name} refusé : son empreinte ne correspond pas à celle attendue par Orbit.`);
      }
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, target);
      // Anciennes versions du même pilote : place libérée.
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(`${name}-`) && f !== info.file && !f.endsWith('.tmp')) fs.rmSync(path.join(dir, f), { force: true });
      }
    }
    const mod = require(target);
    loaded.set(name, mod);
    return mod;
  })();
  pending.set(name, job);
  try {
    return await job;
  } finally {
    pending.delete(name);
  }
}
