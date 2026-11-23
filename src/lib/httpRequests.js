// ---------------------------------------------------------------------------
// Client API d'Orbit — logique pure (aucun accès réseau ni DOM).
//
//   • fichiers .http / .rest au format de l'extension « REST Client » de
//     VS Code : `###` sépare les requêtes, `@var = valeur` déclare une
//     variable, `# @name login` nomme une requête dont la réponse peut être
//     réutilisée plus bas : {{login.response.body.$.token}} ;
//   • variables {{nom}} et variables système ({{$guid}}, {{$timestamp}},
//     {{$randomInt 1 100}}, {{$datetime iso8601}}…) ;
//   • import cURL, export cURL ;
//   • import OpenAPI 3 / Swagger 2 (JSON) et collections Postman v2.x ;
//   • construction de la requête finale envoyée au processus principal.
// ---------------------------------------------------------------------------

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const METHOD_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+(\S.*?)(?:\s+HTTP\/[\d.]+)?\s*$/i;

let seq = 0;
export function newId(prefix = 'r') {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyRequest(patch = {}) {
  return {
    id: newId(),
    name: '',
    method: 'GET',
    url: '',
    headers: [],
    body: { kind: 'none', text: '', fields: [], file: '' },
    auth: { type: 'none' },
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// Paramètres d'URL ⇄ tableau éditable
// ---------------------------------------------------------------------------
export function splitUrlParams(url) {
  const s = String(url || '');
  const q = s.indexOf('?');
  if (q === -1) return { base: s, params: [] };
  const hashAt = s.indexOf('#', q);
  const query = s.slice(q + 1, hashAt === -1 ? undefined : hashAt);
  const params = query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=');
      const dec = (v) => {
        try {
          return decodeURIComponent(v.replace(/\+/g, ' '));
        } catch {
          return v;
        }
      };
      return eq === -1
        ? { key: dec(pair), value: '', enabled: true }
        : { key: dec(pair.slice(0, eq)), value: dec(pair.slice(eq + 1)), enabled: true };
    });
  return { base: s.slice(0, q), params };
}

// Les {{variables}} restent lisibles : on n'encode pas les accolades.
function encodePart(v) {
  return encodeURIComponent(v).replace(/%7B%7B/gi, '{{').replace(/%7D%7D/gi, '}}');
}

export function joinUrlParams(base, params) {
  const q = (params || [])
    .filter((p) => p.enabled !== false && p.key)
    .map((p) => (p.value === '' ? encodePart(p.key) : `${encodePart(p.key)}=${encodePart(p.value)}`))
    .join('&');
  return q ? `${base}?${q}` : base;
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------
function jsonPath(value, expr) {
  let cur = value;
  const path = String(expr || '').trim();
  if (!path.startsWith('$')) return undefined;
  const re = /\.([A-Za-z_$][\w$-]*)|\[(\d+)\]|\[['"]([^'"]+)['"]\]|\.\*/g;
  let m;
  const rest = path.slice(1);
  let consumed = 0;
  while ((m = re.exec(rest))) {
    if (m.index !== consumed) return undefined;
    consumed = re.lastIndex;
    if (cur === null || cur === undefined) return undefined;
    if (m[1] !== undefined) cur = cur[m[1]];
    else if (m[2] !== undefined) cur = cur[Number(m[2])];
    else if (m[3] !== undefined) cur = cur[m[3]];
  }
  return consumed === rest.length ? cur : undefined;
}

function responseRef(ref, responses) {
  // nom.response.body.<$.chemin | *>   ou   nom.response.headers.<En-tête>
  const m = /^([\w-]+)\.(response|request)\.(body|headers)(?:\.(.*))?$/.exec(ref);
  if (!m) return undefined;
  const saved = responses?.[m[1]];
  if (!saved) return undefined;
  const part = saved[m[2]];
  if (!part) return undefined;
  if (m[3] === 'headers') {
    const name = String(m[4] || '').toLowerCase();
    const found = (part.headers || []).find(([k]) => String(k).toLowerCase() === name);
    return found ? found[1] : undefined;
  }
  const raw = part.body ?? '';
  if (!m[4] || m[4] === '*') return raw;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const v = jsonPath(parsed, m[4]);
  return v === undefined ? undefined : typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function systemVar(expr, now = new Date()) {
  const [name, ...args] = expr.trim().split(/\s+/);
  switch (name) {
    case '$guid':
    case '$uuid':
      return typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
          });
    case '$timestamp': {
      let t = now.getTime();
      if (args.length >= 2) t += offsetMs(Number(args[0]), args[1]);
      return String(Math.floor(t / 1000));
    }
    case '$isoTimestamp':
      return now.toISOString();
    case '$datetime':
    case '$localDatetime': {
      let d = now;
      if (args.length >= 3) d = new Date(now.getTime() + offsetMs(Number(args[1]), args[2]));
      const fmt = (args[0] || 'iso8601').replace(/^["']|["']$/g, '');
      if (fmt === 'rfc1123') return d.toUTCString();
      if (fmt === 'iso8601') return d.toISOString();
      const local = name === '$localDatetime';
      const Y = local ? d.getFullYear() : d.getUTCFullYear();
      const M = pad((local ? d.getMonth() : d.getUTCMonth()) + 1);
      const D = pad(local ? d.getDate() : d.getUTCDate());
      const h = pad(local ? d.getHours() : d.getUTCHours());
      const mi = pad(local ? d.getMinutes() : d.getUTCMinutes());
      const s = pad(local ? d.getSeconds() : d.getUTCSeconds());
      return fmt
        .replace('YYYY', Y)
        .replace('MM', M)
        .replace('DD', D)
        .replace('HH', h)
        .replace('mm', mi)
        .replace('ss', s);
    }
    case '$randomInt': {
      const min = Number(args[0] ?? 0);
      const max = Number(args[1] ?? 1000);
      return String(Math.floor(min + Math.random() * (max - min)));
    }
    default:
      return undefined;
  }
}

function offsetMs(n, unit) {
  const k = { y: 31536e6, M: 2592e6, w: 6048e5, d: 864e5, h: 36e5, m: 6e4, s: 1e3, ms: 1 }[unit] || 0;
  return (Number.isFinite(n) ? n : 0) * k;
}

// Remplace les {{…}}. `vars` peut contenir des valeurs elles-mêmes
// paramétrées (`@url = {{host}}/api`) : on résout récursivement, avec une
// limite contre les boucles. Une variable inconnue reste telle quelle — elle
// se voit dans la requête envoyée au lieu de disparaître en silence.
export function substitute(text, ctx = {}, depth = 0) {
  if (text === null || text === undefined) return text;
  const str = String(text);
  if (depth > 8 || !str.includes('{{')) return str;
  return str.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, expr) => {
    if (expr.startsWith('$')) {
      const v = systemVar(expr, ctx.now);
      return v === undefined ? whole : v;
    }
    const vars = ctx.vars || {};
    if (Object.prototype.hasOwnProperty.call(vars, expr)) return substitute(vars[expr], ctx, depth + 1);
    const ref = responseRef(expr, ctx.responses);
    return ref === undefined ? whole : ref;
  });
}

export function unresolvedVariables(text) {
  return [...String(text || '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// Fichiers .http / .rest
// ---------------------------------------------------------------------------
export function parseHttpFile(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const variables = {};
  const requests = [];
  let block = { startLine: 0, title: '' };
  const blocks = [];
  lines.forEach((line, idx) => {
    if (/^###/.test(line)) {
      blocks.push({ ...block, endLine: idx - 1 });
      block = { startLine: idx + 1, title: line.replace(/^###+/, '').trim() };
    }
  });
  blocks.push({ ...block, endLine: lines.length - 1 });

  for (const b of blocks) {
    let i = b.startLine;
    let name = '';
    let note = '';
    // Avant la ligne de requête : commentaires, métadonnées, variables.
    for (; i <= b.endLine; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) continue;
      const meta = /^(?:#|\/\/)\s*@name\s+([\w-]+)/.exec(trimmed);
      if (meta) {
        name = meta[1];
        continue;
      }
      const vdef = /^@([\w.-]+)\s*=\s*(.*)$/.exec(trimmed);
      if (vdef) {
        variables[vdef[1]] = vdef[2].trim();
        continue;
      }
      if (/^(#|\/\/)/.test(trimmed)) {
        if (!note) note = trimmed.replace(/^(#|\/\/)\s*/, '');
        continue;
      }
      break;
    }
    if (i > b.endLine) continue;

    const first = lines[i].trim();
    const m = METHOD_RE.exec(first);
    let method = 'GET';
    let url = first;
    if (m) {
      method = m[1].toUpperCase();
      url = m[2].trim();
    } else {
      url = first.replace(/\s+HTTP\/[\d.]+\s*$/i, '');
    }
    const requestLine = i;
    i += 1;
    // Suite de l'URL sur plusieurs lignes (`?page=1` puis `&size=20`).
    while (i <= b.endLine && /^\s*[?&]/.test(lines[i])) {
      url += lines[i].trim();
      i += 1;
    }
    const headers = [];
    for (; i <= b.endLine; i += 1) {
      const line = lines[i];
      if (!line.trim()) {
        i += 1;
        break;
      }
      if (/^\s*(#|\/\/)/.test(line)) continue;
      const c = line.indexOf(':');
      if (c > 0) headers.push({ key: line.slice(0, c).trim(), value: line.slice(c + 1).trim(), enabled: true });
    }
    let bodyLines = lines.slice(i, b.endLine + 1);
    while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
    // Un commentaire seul en fin de bloc n'appartient pas au corps.
    const bodyText = bodyLines.join('\n');
    const type = (headers.find((h) => h.key.toLowerCase() === 'content-type')?.value || '').toLowerCase();
    let kind = 'none';
    if (bodyText.trim()) {
      if (type.includes('json')) kind = 'json';
      else if (type.includes('xml')) kind = 'xml';
      else if (type.includes('x-www-form-urlencoded')) kind = 'text';
      else if (/^\s*[[{]/.test(bodyText)) kind = 'json';
      else kind = 'text';
    }
    requests.push({
      id: `h${requestLine}`,
      name: name || b.title || `${method} ${url}`,
      requestName: name || null,
      note,
      line: requestLine + 1,
      method,
      url,
      headers,
      body: { kind, text: bodyText, fields: [], file: '' },
      auth: { type: 'none' },
    });
  }
  return { variables, requests };
}

// Collection → texte .http (sauvegarde lisible, partageable, versionnable).
export function toHttpFile(requests, variables = {}) {
  const out = [];
  for (const [k, v] of Object.entries(variables)) out.push(`@${k} = ${v}`);
  if (out.length) out.push('');
  for (const r of requests) {
    out.push(`### ${r.name || ''}`.trimEnd());
    if (r.requestName) out.push(`# @name ${r.requestName}`);
    out.push(`${r.method || 'GET'} ${r.url}`);
    const headers = [...(r.headers || []).filter((h) => h.enabled !== false && h.key)];
    const auth = authHeader(r.auth);
    if (auth) headers.push({ key: auth[0], value: auth[1] });
    for (const h of headers) out.push(`${h.key}: ${h.value}`);
    const body = r.body || {};
    if (body.kind && body.kind !== 'none' && body.text) {
      if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) {
        const t = { json: 'application/json', xml: 'application/xml', graphql: 'application/json' }[body.kind];
        if (t) out.push(`Content-Type: ${t}`);
      }
      out.push('', body.text);
    } else if (body.kind === 'form' && body.fields?.length) {
      out.push('Content-Type: application/x-www-form-urlencoded', '');
      out.push(
        body.fields
          .filter((f) => f.enabled !== false && f.key)
          .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value ?? '')}`)
          .join('&')
      );
    }
    out.push('');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Requête finale
// ---------------------------------------------------------------------------
// UTF-8 → base64 (btoa existe dans le renderer comme dans Node ≥ 16).
function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function authHeader(auth) {
  if (!auth) return null;
  if (auth.type === 'bearer' && auth.token) return ['Authorization', `Bearer ${auth.token}`];
  if (auth.type === 'basic' && (auth.username || auth.password)) {
    return ['Authorization', `Basic ${b64(`${auth.username || ''}:${auth.password || ''}`)}`];
  }
  if (auth.type === 'apikey' && auth.key && (auth.in || 'header') === 'header') return [auth.key, auth.value || ''];
  return null;
}

export function buildFinalRequest(req, ctx = {}) {
  const sub = (v) => substitute(v, ctx);
  let url = sub(req.url || '').trim();
  if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
  const auth = req.auth || { type: 'none' };
  const resolvedAuth = Object.fromEntries(Object.entries(auth).map(([k, v]) => [k, typeof v === 'string' ? sub(v) : v]));
  if (resolvedAuth.type === 'apikey' && resolvedAuth.in === 'query' && resolvedAuth.key) {
    const { base, params } = splitUrlParams(url);
    url = joinUrlParams(base, [...params, { key: resolvedAuth.key, value: resolvedAuth.value || '' }]);
  }
  const headers = (req.headers || [])
    .filter((h) => h.enabled !== false && h.key)
    .map((h) => [sub(h.key), sub(h.value ?? '')]);
  const ah = authHeader(resolvedAuth);
  if (ah && !headers.some(([k]) => k.toLowerCase() === ah[0].toLowerCase())) headers.push(ah);
  const body = { ...(req.body || { kind: 'none' }) };
  if (body.kind === 'graphql') {
    let variables = {};
    try {
      variables = body.variables ? JSON.parse(sub(body.variables)) : {};
    } catch {
      variables = {};
    }
    body.text = JSON.stringify({ query: sub(body.text || ''), variables });
  } else if (typeof body.text === 'string') {
    body.text = sub(body.text);
  }
  if (Array.isArray(body.fields)) {
    body.fields = body.fields.map((f) => ({ ...f, key: sub(f.key), value: f.type === 'file' ? f.value : sub(f.value) }));
  }
  return { method: (req.method || 'GET').toUpperCase(), url, headers, body };
}

// ---------------------------------------------------------------------------
// cURL
// ---------------------------------------------------------------------------
function shellTokens(cmd) {
  const src = String(cmd || '').replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  const out = [];
  let cur = '';
  let has = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      cur += src.slice(i + 1, end === -1 ? undefined : end);
      i = end === -1 ? src.length : end;
      has = true;
    } else if (c === '"') {
      i += 1;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) i += 1;
        cur += src[i];
        i += 1;
      }
      has = true;
    } else if (c === '$' && src[i + 1] === "'") {
      // Chaîne ANSI-C de bash : $'…' (copiée depuis Chrome sous Linux/macOS)
      i += 2;
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\' && i + 1 < src.length) {
          const n = src[i + 1];
          cur += { n: '\n', t: '\t', r: '\r', "'": "'", '\\': '\\' }[n] ?? n;
          i += 2;
          continue;
        }
        cur += src[i];
        i += 1;
      }
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else if (c === '\\' && i + 1 < src.length) {
      cur += src[i + 1];
      i += 1;
      has = true;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

export function parseCurl(cmd) {
  const tokens = shellTokens(String(cmd).trim());
  if (!tokens.length || !/^curl(\.exe)?$/i.test(tokens[0])) throw new Error('La commande doit commencer par « curl ».');
  const req = emptyRequest();
  const data = [];
  const form = [];
  let explicitMethod = null;
  let get = false;
  let json = false;
  const takes = new Set([
    '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii',
    '--data-urlencode', '--json', '-u', '--user', '-F', '--form', '--form-string', '--url', '-A', '--user-agent',
    '-b', '--cookie', '-e', '--referer', '-o', '--output', '-m', '--max-time', '--connect-timeout', '-x', '--proxy',
  ]);
  for (let i = 1; i < tokens.length; i += 1) {
    let t = tokens[i];
    let val;
    const eq = t.startsWith('--') ? t.indexOf('=') : -1;
    if (eq > 0) {
      val = t.slice(eq + 1);
      t = t.slice(0, eq);
    } else if (takes.has(t)) {
      val = tokens[++i];
    } else if (/^-[XHdubFA]./.test(t)) {
      val = t.slice(2);
      t = t.slice(0, 2);
    }
    switch (t) {
      case '-X':
      case '--request':
        explicitMethod = String(val).toUpperCase();
        break;
      case '-H':
      case '--header': {
        const c = String(val).indexOf(':');
        if (c > 0) req.headers.push({ key: val.slice(0, c).trim(), value: val.slice(c + 1).trim(), enabled: true });
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
      case '--data-urlencode':
        data.push(String(val ?? ''));
        break;
      case '--json':
        data.push(String(val ?? ''));
        json = true;
        break;
      case '-u':
      case '--user': {
        const [username, ...rest] = String(val).split(':');
        req.auth = { type: 'basic', username, password: rest.join(':') };
        break;
      }
      case '-F':
      case '--form':
      case '--form-string': {
        const s = String(val);
        const e = s.indexOf('=');
        const key = s.slice(0, e);
        const v = s.slice(e + 1);
        form.push(v.startsWith('@') && t !== '--form-string'
          ? { key, value: v.slice(1).split(';')[0], type: 'file', enabled: true }
          : { key, value: v, type: 'text', enabled: true });
        break;
      }
      case '--url':
        req.url = val;
        break;
      case '-A':
      case '--user-agent':
        req.headers.push({ key: 'User-Agent', value: val, enabled: true });
        break;
      case '-b':
      case '--cookie':
        req.headers.push({ key: 'Cookie', value: val, enabled: true });
        break;
      case '-e':
      case '--referer':
        req.headers.push({ key: 'Referer', value: val, enabled: true });
        break;
      case '-G':
      case '--get':
        get = true;
        break;
      case '-I':
      case '--head':
        explicitMethod = 'HEAD';
        break;
      default:
        if (!t.startsWith('-') && !req.url) req.url = t;
    }
  }
  if (json) {
    if (!req.headers.some((h) => h.key.toLowerCase() === 'content-type')) {
      req.headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
    }
    if (!req.headers.some((h) => h.key.toLowerCase() === 'accept')) {
      req.headers.push({ key: 'Accept', value: 'application/json', enabled: true });
    }
  }
  if (get && data.length) {
    const { base, params } = splitUrlParams(req.url);
    req.url = joinUrlParams(base, [...params, ...splitUrlParams(`?${data.join('&')}`).params]);
  } else if (form.length) {
    req.body = { kind: 'multipart', text: '', fields: form, file: '' };
  } else if (data.length) {
    const text = data.join('&');
    const type = (req.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value || '').toLowerCase();
    if (type.includes('json') || (!type && /^\s*[[{]/.test(text))) req.body = { kind: 'json', text: prettyJson(text), fields: [], file: '' };
    else if (type.includes('xml')) req.body = { kind: 'xml', text, fields: [], file: '' };
    else if (!type || type.includes('x-www-form-urlencoded')) {
      req.body = { kind: 'form', text: '', fields: splitUrlParams(`?${text}`).params, file: '' };
      req.headers = req.headers.filter((h) => h.key.toLowerCase() !== 'content-type');
    } else req.body = { kind: 'text', text, fields: [], file: '' };
  }
  req.method = explicitMethod || ((data.length || form.length) && !get ? 'POST' : 'GET');
  // Les en-têtes de navigation que Chrome ajoute à « Copier en cURL » ne
  // servent à rien dans un client API et noient l'essentiel.
  req.headers = req.headers.filter((h) => !/^(sec-ch-|sec-fetch-|priority$|upgrade-insecure-requests$)/i.test(h.key));
  // La méthode s'affiche déjà à côté du nom : le nom n'en a pas besoin.
  try {
    req.name = new URL(req.url).pathname || req.url;
  } catch {
    req.name = req.url;
  }
  return req;
}

function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function toCurl(final) {
  const parts = ['curl'];
  if (final.method !== 'GET') parts.push('-X', final.method);
  parts.push(shq(final.url));
  for (const [k, v] of final.headers || []) parts.push('-H', shq(`${k}: ${v}`));
  const b = final.body || {};
  if (['json', 'text', 'xml', 'graphql'].includes(b.kind) && b.text) {
    if (b.kind === 'json' && !(final.headers || []).some(([k]) => k.toLowerCase() === 'content-type')) {
      parts.push('-H', shq('Content-Type: application/json'));
    }
    parts.push('--data-raw', shq(b.text));
  } else if (b.kind === 'form') {
    for (const f of b.fields || []) if (f.enabled !== false && f.key) parts.push('--data-urlencode', shq(`${f.key}=${f.value ?? ''}`));
  } else if (b.kind === 'multipart') {
    for (const f of b.fields || []) {
      if (f.enabled === false || !f.key) continue;
      parts.push('-F', shq(f.type === 'file' ? `${f.key}=@${f.value}` : `${f.key}=${f.value ?? ''}`));
    }
  } else if (b.kind === 'binary' && b.file) {
    parts.push('--data-binary', shq(`@${b.file}`));
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Imports : OpenAPI 3 / Swagger 2 et Postman v2.x
// ---------------------------------------------------------------------------
function exampleFromSchema(schema, spec, depth = 0) {
  if (!schema || depth > 6) return null;
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], spec);
    return exampleFromSchema(target, spec, depth + 1);
  }
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  const sub = schema.allOf || schema.oneOf || schema.anyOf;
  if (sub?.length) {
    if (schema.allOf) return Object.assign({}, ...sub.map((s) => exampleFromSchema(s, spec, depth + 1) || {}));
    return exampleFromSchema(sub[0], spec, depth + 1);
  }
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'object' || schema.properties) {
    const o = {};
    for (const [k, v] of Object.entries(schema.properties || {})) o[k] = exampleFromSchema(v, spec, depth + 1);
    return o;
  }
  if (type === 'array') return [exampleFromSchema(schema.items, spec, depth + 1)];
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'string') {
    if (schema.format === 'date-time') return new Date(0).toISOString();
    if (schema.format === 'date') return '1970-01-01';
    if (schema.format === 'email') return 'user@example.com';
    if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
    return 'string';
  }
  return null;
}

export function importOpenApi(spec) {
  if (!spec || typeof spec !== 'object' || !(spec.openapi || spec.swagger) || !spec.paths) {
    throw new Error('Ce fichier n’est pas une spécification OpenAPI/Swagger (JSON).');
  }
  let baseUrl = '';
  if (spec.openapi) {
    const server = spec.servers?.[0];
    baseUrl = server?.url || '';
    for (const [k, v] of Object.entries(server?.variables || {})) baseUrl = baseUrl.replace(`{${k}}`, v.default ?? '');
  } else {
    const scheme = spec.schemes?.[0] || 'https';
    baseUrl = spec.host ? `${scheme}://${spec.host}${spec.basePath || ''}` : spec.basePath || '';
  }
  const variables = { baseUrl: baseUrl.replace(/\/$/, '') };
  const requests = [];
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const op = item?.[method];
      if (!op) continue;
      const params = [...(item.parameters || []), ...(op.parameters || [])].map((x) =>
        x.$ref ? x.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], spec) : x
      );
      const query = [];
      const headers = [];
      for (const prm of params) {
        if (!prm) continue;
        const ex = prm.example ?? prm.schema?.example ?? prm.default ?? prm.schema?.default ?? '';
        if (prm.in === 'path') variables[prm.name] = variables[prm.name] ?? String(ex);
        if (prm.in === 'query') query.push({ key: prm.name, value: String(ex), enabled: Boolean(prm.required) });
        if (prm.in === 'header') headers.push({ key: prm.name, value: String(ex), enabled: true });
      }
      let body = { kind: 'none', text: '', fields: [], file: '' };
      const content = op.requestBody?.content;
      if (content) {
        const type = Object.keys(content).find((t) => t.includes('json')) || Object.keys(content)[0];
        const media = content[type] || {};
        const example = media.example ?? Object.values(media.examples || {})[0]?.value ?? exampleFromSchema(media.schema, spec);
        if (type?.includes('json')) body = { kind: 'json', text: JSON.stringify(example ?? {}, null, 2), fields: [], file: '' };
        else if (type?.includes('form')) {
          const props = (media.schema?.$ref ? exampleFromSchema(media.schema, spec) : exampleFromSchema(media.schema, spec)) || {};
          body = {
            kind: type.includes('multipart') ? 'multipart' : 'form',
            text: '',
            fields: Object.entries(props).map(([key, value]) => ({ key, value: String(value ?? ''), type: 'text', enabled: true })),
            file: '',
          };
        } else body = { kind: 'text', text: example ? String(example) : '', fields: [], file: '' };
      } else {
        const bodyParam = params.find((x) => x?.in === 'body');
        if (bodyParam) body = { kind: 'json', text: JSON.stringify(exampleFromSchema(bodyParam.schema, spec) ?? {}, null, 2), fields: [], file: '' };
      }
      const url = joinUrlParams(`{{baseUrl}}${p.replace(/\{([^}]+)\}/g, '{{$1}}')}`, query);
      requests.push(
        emptyRequest({
          name: op.summary || op.operationId || `${method.toUpperCase()} ${p}`,
          folder: op.tags?.[0] || '',
          method: method.toUpperCase(),
          url,
          headers,
          body,
        })
      );
    }
  }
  return { name: spec.info?.title || 'API importée', variables, requests };
}

export function importPostman(col) {
  const info = col?.info;
  if (!info || !Array.isArray(col.item) || !/postman/i.test(String(info.schema || ''))) {
    throw new Error('Ce fichier n’est pas une collection Postman (v2.x).');
  }
  const vars = {};
  for (const v of col.variable || []) if (v?.key) vars[v.key] = v.value ?? '';
  const convAuth = (a) => {
    if (!a) return { type: 'none' };
    const get = (list, k) => (Array.isArray(list) ? list.find((x) => x.key === k)?.value : list?.[k]) ?? '';
    if (a.type === 'bearer') return { type: 'bearer', token: get(a.bearer, 'token') };
    if (a.type === 'basic') return { type: 'basic', username: get(a.basic, 'username'), password: get(a.basic, 'password') };
    if (a.type === 'apikey') return { type: 'apikey', key: get(a.apikey, 'key'), value: get(a.apikey, 'value'), in: get(a.apikey, 'in') || 'header' };
    return { type: 'none' };
  };
  const rootAuth = convAuth(col.auth);
  const requests = [];
  const walk = (items, folder, inherited) => {
    for (const it of items) {
      if (Array.isArray(it.item)) {
        walk(it.item, folder ? `${folder} / ${it.name}` : it.name, it.auth ? convAuth(it.auth) : inherited);
        continue;
      }
      const r = it.request;
      if (!r) continue;
      const url = typeof r.url === 'string' ? r.url : r.url?.raw || '';
      let body = { kind: 'none', text: '', fields: [], file: '' };
      const b = r.body;
      if (b?.mode === 'raw') {
        const lang = b.options?.raw?.language;
        body = { kind: lang === 'json' || /^\s*[[{]/.test(b.raw || '') ? 'json' : lang === 'xml' ? 'xml' : 'text', text: b.raw || '', fields: [], file: '' };
      } else if (b?.mode === 'urlencoded') {
        body = { kind: 'form', text: '', fields: (b.urlencoded || []).map((f) => ({ key: f.key, value: f.value ?? '', type: 'text', enabled: !f.disabled })), file: '' };
      } else if (b?.mode === 'formdata') {
        body = {
          kind: 'multipart',
          text: '',
          fields: (b.formdata || []).map((f) => ({ key: f.key, value: f.type === 'file' ? f.src || '' : f.value ?? '', type: f.type === 'file' ? 'file' : 'text', enabled: !f.disabled })),
          file: '',
        };
      } else if (b?.mode === 'graphql') {
        body = { kind: 'graphql', text: b.graphql?.query || '', variables: b.graphql?.variables || '', fields: [], file: '' };
      }
      requests.push(
        emptyRequest({
          name: it.name || url,
          folder: folder || '',
          method: (r.method || 'GET').toUpperCase(),
          url,
          headers: (r.header || []).map((h) => ({ key: h.key, value: h.value ?? '', enabled: !h.disabled })),
          body,
          auth: r.auth ? convAuth(r.auth) : inherited,
        })
      );
    }
  };
  walk(col.item, '', rootAuth);
  return { name: info.name || 'Collection Postman', variables: vars, requests };
}

// Fichier déposé ou ouvert : on devine le format.
export function importAny(text, fileName = '') {
  const trimmed = String(text || '').trim();
  if (/^curl\b/i.test(trimmed)) {
    const r = parseCurl(trimmed);
    return { name: r.name, variables: {}, requests: [r] };
  }
  const looksHttp = /^(###|@\w+\s*=|(GET|POST|PUT|PATCH|DELETE)\s)/m.test(trimmed) && !/^[[{]/.test(trimmed);
  if (/\.(http|rest)$/i.test(fileName) || looksHttp) {
    const parsed = parseHttpFile(trimmed);
    return { name: fileName.replace(/\.(http|rest)$/i, '') || 'Fichier .http', variables: parsed.variables, requests: parsed.requests.map((r) => ({ ...r, id: newId() })) };
  }
  let json;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new Error('Format non reconnu : collez une commande cURL, un fichier .http, un JSON OpenAPI/Swagger ou une collection Postman. (OpenAPI en YAML : convertissez-le d’abord en JSON.)');
  }
  if (json.openapi || json.swagger) return importOpenApi(json);
  if (json.info && json.item) return importPostman(json);
  throw new Error('JSON non reconnu : ni OpenAPI/Swagger, ni collection Postman.');
}

// ---------------------------------------------------------------------------
// Affichage de la réponse
// ---------------------------------------------------------------------------
export function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

export function prettyBody(text, contentType = '') {
  if (text === null || text === undefined) return '';
  if (/json/i.test(contentType) || /^\s*[[{]/.test(text)) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}
