// ---------------------------------------------------------------------------
// App native « API » (extension « Orbit API ») — envoi des requêtes HTTP.
//
// Les requêtes partent du PROCESSUS PRINCIPAL, pas d'une page : aucune règle
// CORS, aucun en-tête interdit (Origin, Cookie, Host…), comme Postman ou
// REST Client. Le renderer prépare tout (variables, authentification, corps)
// et n'envoie ici qu'une requête finale.
// ---------------------------------------------------------------------------
import fs from 'fs';
import path from 'path';

const MAX_BODY = 20 * 1024 * 1024; // au-delà, on tronque l'affichage
const inflight = new Map(); // id → AbortController

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql|ld\+json|problem\+json|[a-z.+-]*\+(json|xml)))|image\/svg/i;

function buildBody(body, headers, canRead) {
  const readGranted = (file) => {
    if (canRead && !canRead(file)) {
      throw new Error(`Fichier « ${path.basename(String(file))} » : choisissez-le à nouveau (Orbit ne lit que les fichiers sélectionnés pendant cette session).`);
    }
    return fs.readFileSync(file);
  };
  const kind = body?.kind || 'none';
  const has = (name) => headers.some(([k]) => k.toLowerCase() === name);
  if (kind === 'none') return undefined;
  if (kind === 'json' || kind === 'text' || kind === 'xml' || kind === 'graphql') {
    if (!has('content-type')) {
      const type = {
        json: 'application/json',
        graphql: 'application/json',
        xml: 'application/xml',
        text: 'text/plain;charset=UTF-8',
      }[kind];
      headers.push(['Content-Type', type]);
    }
    return body.text ?? '';
  }
  if (kind === 'form') {
    const params = new URLSearchParams();
    for (const f of body.fields || []) if (f.enabled !== false && f.key) params.append(f.key, f.value ?? '');
    return params;
  }
  if (kind === 'multipart') {
    const form = new FormData();
    for (const f of body.fields || []) {
      if (f.enabled === false || !f.key) continue;
      if (f.type === 'file' && f.value) {
        const data = readGranted(f.value);
        form.append(f.key, new Blob([data]), path.basename(f.value));
      } else {
        form.append(f.key, f.value ?? '');
      }
    }
    // Content-Type (avec boundary) fixé par fetch : on retire un éventuel manuel.
    for (let i = headers.length - 1; i >= 0; i -= 1) {
      if (headers[i][0].toLowerCase() === 'content-type') headers.splice(i, 1);
    }
    return form;
  }
  if (kind === 'binary') {
    if (!body.file) return undefined;
    if (!has('content-type')) headers.push(['Content-Type', 'application/octet-stream']);
    return readGranted(body.file);
  }
  return undefined;
}

export async function send(req = {}, { canRead } = {}) {
  const id = String(req.id || Date.now());
  const controller = new AbortController();
  inflight.set(id, controller);
  const timeoutMs = Math.max(0, Number(req.timeoutMs) || 0);
  const timer = timeoutMs ? setTimeout(() => controller.abort(new Error('timeout')), timeoutMs) : null;
  const started = performance.now();
  try {
    let url;
    try {
      url = new URL(req.url);
    } catch {
      throw new Error('Adresse invalide : ' + String(req.url || '(vide)'));
    }
    if (!/^https?:$/.test(url.protocol)) throw new Error('Seuls http:// et https:// sont pris en charge.');
    const headers = (req.headers || [])
      .filter((h) => Array.isArray(h) && h[0])
      .map(([k, v]) => [String(k), String(v ?? '')]);
    const method = String(req.method || 'GET').toUpperCase();
    const body = method === 'GET' || method === 'HEAD' ? undefined : buildBody(req.body, headers, canRead);

    const res = await fetch(url, {
      method,
      headers,
      body,
      redirect: req.followRedirects === false ? 'manual' : 'follow',
      signal: controller.signal,
    });
    const headersAt = performance.now();
    const buf = Buffer.from(await res.arrayBuffer());
    const done = performance.now();
    const type = res.headers.get('content-type') || '';
    const isText = TEXT_TYPES.test(type) || (!type && buf.length < 1_000_000 && !buf.includes(0));
    const slice = buf.length > MAX_BODY ? buf.subarray(0, MAX_BODY) : buf;
    return {
      success: true,
      status: res.status,
      statusText: res.statusText,
      url: res.url,
      redirected: res.redirected,
      headers: [...res.headers.entries()],
      contentType: type,
      size: buf.length,
      truncated: buf.length > MAX_BODY,
      text: isText ? slice.toString('utf8') : null,
      base64: isText ? null : slice.toString('base64'),
      timing: {
        total: Math.round(done - started),
        firstByte: Math.round(headersAt - started),
        download: Math.round(done - headersAt),
      },
    };
  } catch (err) {
    const aborted = controller.signal.aborted;
    const reason = controller.signal.reason?.message;
    const cause = err?.cause?.code || err?.cause?.message;
    return {
      success: false,
      error: aborted ? (reason === 'timeout' ? `Délai dépassé (${timeoutMs} ms)` : 'Requête annulée') : `${err.message}${cause ? ` (${cause})` : ''}`,
      timing: { total: Math.round(performance.now() - started) },
    };
  } finally {
    if (timer) clearTimeout(timer);
    inflight.delete(id);
  }
}

export function cancel(id) {
  const c = inflight.get(String(id));
  if (c) c.abort(new Error('cancel'));
  return { success: true };
}
