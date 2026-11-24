// ---------------------------------------------------------------------------
// Explorateur JSON — logique pure (aucun React, aucun DOM).
//
//   • lecture tolérante : JSON, JSON Lines (un objet par ligne), erreurs
//     situées (ligne, colonne) ;
//   • chemins : JSONPath ($.users[0].name) et JavaScript (data.users[0].name) ;
//   • arbre aplati pour un affichage virtualisé (des centaines de milliers de
//     nœuds sans figer l'interface) ;
//   • recherche, requêtes JSONPath (sous-ensemble sûr, SANS eval) ;
//   • édition immuable (modifier, supprimer, renommer, ajouter, trier) ;
//   • schéma déduit (JSON Schema), analyse des tableaux d'objets, CSV.
// ---------------------------------------------------------------------------

export function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v === 'object' ? 'object' : typeof v;
}

export const isContainer = (v) => v !== null && typeof v === 'object';

// --- Lecture ------------------------------------------------------------------
function positionOf(text, index) {
  let line = 1;
  let col = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      col = 1;
    } else col += 1;
  }
  return { line, col };
}

// Analyseur minimal qui ne sert qu'à SITUER la première erreur de syntaxe
// (le vrai décodage reste JSON.parse).
export function locateJsonError(src) {
  let i = 0;
  const n = src.length;
  const fail = (message, at = i) => {
    throw { index: Math.min(at, n), message };
  };
  const ws = () => {
    while (i < n && /\s/.test(src[i])) i += 1;
  };
  const value = () => {
    ws();
    if (i >= n) fail('Fin du texte inattendue : une valeur est attendue');
    const c = src[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    for (const lit of ['true', 'false', 'null']) {
      if (src.startsWith(lit, i)) {
        i += lit.length;
        return undefined;
      }
    }
    return fail(`Caractère inattendu « ${c} » : une valeur est attendue (texte entre guillemets, nombre, true, false, null, objet ou tableau)`);
  };
  const string = () => {
    i += 1;
    while (i < n && src[i] !== '"') {
      if (src[i] === '\\') i += 1;
      else if (src[i] === '\n') fail('Retour à la ligne dans une chaîne : utilisez \\n');
      i += 1;
    }
    if (i >= n) fail('Chaîne jamais fermée (guillemet manquant)');
    i += 1;
  };
  const number = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
    if (!m) fail('Nombre mal formé');
    i += m[0].length;
  };
  const array = () => {
    i += 1;
    ws();
    if (src[i] === ']') {
      i += 1;
      return;
    }
    for (;;) {
      value();
      ws();
      if (src[i] === ',') {
        i += 1;
        ws();
        if (src[i] === ']') fail('Virgule en trop avant « ] »', i - 1);
        continue;
      }
      if (src[i] === ']') {
        i += 1;
        return;
      }
      fail(i >= n ? 'Tableau jamais fermé (« ] » manquant)' : `« , » ou « ] » attendu, « ${src[i]} » trouvé`);
    }
  };
  const object = () => {
    i += 1;
    ws();
    if (src[i] === '}') {
      i += 1;
      return;
    }
    for (;;) {
      ws();
      if (src[i] !== '"') fail(src[i] === '}' ? 'Virgule en trop avant « } »' : 'Nom de clé entre guillemets attendu');
      string();
      ws();
      if (src[i] !== ':') fail('« : » attendu après le nom de la clé');
      i += 1;
      value();
      ws();
      if (src[i] === ',') {
        i += 1;
        continue;
      }
      if (src[i] === '}') {
        i += 1;
        return;
      }
      fail(i >= n ? 'Objet jamais fermé (« } » manquant)' : `« , » ou « } » attendu, « ${src[i]} » trouvé`);
    }
  };
  try {
    value();
    ws();
    if (i < n) fail('Texte en trop après la fin du document JSON');
    return null;
  } catch (e) {
    if (e && typeof e.index === 'number') return e;
    return null;
  }
}

export function parseJsonDocument(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  try {
    return { ok: true, value: JSON.parse(src), format: 'json' };
  } catch (err) {
    // JSON Lines : chaque ligne non vide est un document JSON.
    const lines = src.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length > 1) {
      const out = [];
      let ok = true;
      for (const l of lines) {
        try {
          out.push(JSON.parse(l));
        } catch {
          ok = false;
          break;
        }
      }
      if (ok) return { ok: true, value: out, format: 'jsonl' };
    }
    // Les messages du moteur varient d'une version à l'autre (et ne donnent
    // plus toujours la position) : on situe l'erreur nous-mêmes.
    const found = locateJsonError(src);
    return {
      ok: false,
      error: found ? found.message : err.message,
      position: found ? positionOf(src, found.index) : null,
    };
  }
}

// --- Chemins ------------------------------------------------------------------
const IDENT = /^[A-Za-z_$][\w$]*$/;

export function pathToJsonPath(path) {
  return path.reduce((acc, k) => {
    if (typeof k === 'number') return `${acc}[${k}]`;
    return IDENT.test(k) ? `${acc}.${k}` : `${acc}['${String(k).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`;
  }, '$');
}

export function pathToJs(path, root = 'data') {
  return path.reduce((acc, k) => {
    if (typeof k === 'number') return `${acc}[${k}]`;
    return IDENT.test(k) ? `${acc}.${k}` : `${acc}[${JSON.stringify(k)}]`;
  }, root);
}

export const pathKey = (path) => JSON.stringify(path);

export function getAt(root, path) {
  let cur = root;
  for (const k of path) {
    if (!isContainer(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

// --- Arbre aplati ---------------------------------------------------------------
// Ne parcourt QUE les nœuds dépliés : coût proportionnel à ce qui est affiché.
export function flattenVisible(root, expanded, { limitChildren = 500, showMore = {} } = {}) {
  const rows = [];
  const visit = (value, path, key, depth) => {
    const container = isContainer(value);
    const id = pathKey(path);
    const size = container ? (Array.isArray(value) ? value.length : Object.keys(value).length) : 0;
    const open = container && (depth === 0 || expanded.has(id));
    rows.push({ id, path, key, value, type: typeOf(value), depth, container, size, open });
    if (!open) return;
    const keys = Array.isArray(value) ? value.map((_, i) => i) : Object.keys(value);
    const cap = showMore[id] || limitChildren;
    keys.slice(0, cap).forEach((k) => visit(value[k], [...path, k], k, depth + 1));
    if (keys.length > cap) {
      rows.push({ id: `${id}#more`, path, more: keys.length - cap, depth: depth + 1, type: 'more' });
    }
  };
  visit(root, [], null, 0);
  return rows;
}

// Chemins de tous les conteneurs jusqu'à `maxDepth` (« tout déplier »).
export function containerPaths(root, maxDepth = 4, cap = 20000) {
  const out = [];
  const visit = (value, path, depth) => {
    if (!isContainer(value) || depth > maxDepth || out.length >= cap) return;
    out.push(pathKey(path));
    const keys = Array.isArray(value) ? value.map((_, i) => i) : Object.keys(value);
    for (const k of keys) visit(value[k], [...path, k], depth + 1);
  };
  visit(root, [], 0);
  return out;
}

// Ancêtres d'un chemin (pour déplier jusqu'à un résultat de recherche).
export function ancestorKeys(path) {
  const out = [];
  for (let i = 0; i < path.length; i += 1) out.push(pathKey(path.slice(0, i)));
  return out;
}

// --- Recherche -----------------------------------------------------------------
export function searchJson(root, query, { keys = true, values = true, caseSensitive = false, limit = 5000 } = {}) {
  const q = String(query ?? '');
  if (!q) return [];
  const norm = (s) => (caseSensitive ? String(s) : String(s).toLowerCase());
  const needle = norm(q);
  const out = [];
  const visit = (value, path, key) => {
    if (out.length >= limit) return;
    const keyHit = keys && key !== null && typeof key === 'string' && norm(key).includes(needle);
    const valueHit = values && !isContainer(value) && norm(value === null ? 'null' : value).includes(needle);
    if (keyHit || valueHit) out.push({ path, key: keyHit, value: valueHit });
    if (isContainer(value)) {
      const ks = Array.isArray(value) ? value.map((_, i) => i) : Object.keys(value);
      for (const k of ks) visit(value[k], [...path, k], k);
    }
  };
  visit(root, [], null);
  return out;
}

// --- Requêtes JSONPath (sous-ensemble, sans eval) -------------------------------
// $  .clé  ['clé']  [n]  [-n]  [*]  .*  ..clé  ..*  [a:b]  [n,m]
// [?(@.champ)]  [?(@.champ op valeur)]  op : == != > >= < <= =~ (regex /…/i)
// conditions combinables par && et ||. La valeur : nombre, 'texte', "texte",
// true, false, null.
function tokenize(expr) {
  const s = String(expr || '').trim();
  if (!s.startsWith('$')) throw new Error('Une requête commence par $ (ex. $.users[*].name)');
  const tokens = [];
  let i = 1;
  while (i < s.length) {
    if (s.startsWith('..', i)) {
      i += 2;
      const m = /^(\*|[A-Za-z_$][\w$-]*)/.exec(s.slice(i));
      if (m) {
        tokens.push({ t: 'deep', key: m[1] });
        i += m[1].length;
      } else if (s[i] === '[') {
        tokens.push({ t: 'deep', key: '*' });
      } else throw new Error(`Requête illisible près de « ${s.slice(i - 2, i + 8)} »`);
      continue;
    }
    if (s[i] === '.') {
      i += 1;
      const m = /^(\*|[A-Za-z_$][\w$-]*)/.exec(s.slice(i));
      if (!m) throw new Error(`Nom attendu après « . » près de « ${s.slice(i, i + 8)} »`);
      tokens.push(m[1] === '*' ? { t: 'all' } : { t: 'key', key: m[1] });
      i += m[1].length;
      continue;
    }
    if (s[i] === '[') {
      // Crochet : on cherche le crochet fermant en respectant les chaînes et
      // les parenthèses du filtre.
      let depth = 0;
      let j = i;
      let quote = null;
      for (; j < s.length; j += 1) {
        const c = s[j];
        if (quote) {
          if (c === '\\') j += 1;
          else if (c === quote) quote = null;
          continue;
        }
        if (c === '"' || c === "'") quote = c;
        else if (c === '(' || c === '[') depth += 1;
        else if (c === ')' || c === ']') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const inner = s.slice(i + 1, j).trim();
      i = j + 1;
      if (inner === '*') tokens.push({ t: 'all' });
      else if (/^\?\(/.test(inner) && inner.endsWith(')')) tokens.push({ t: 'filter', cond: parseCondition(inner.slice(2, -1)) });
      else if (/^-?\d*:-?\d*$/.test(inner)) {
        const [a, b] = inner.split(':');
        tokens.push({ t: 'slice', a: a === '' ? null : Number(a), b: b === '' ? null : Number(b) });
      } else if (/^-?\d+(\s*,\s*-?\d+)*$/.test(inner)) tokens.push({ t: 'idx', list: inner.split(',').map((x) => Number(x.trim())) });
      else {
        const keys = [...inner.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => (m[1] ?? m[2]).replace(/\\(.)/g, '$1'));
        if (!keys.length) throw new Error(`Sélecteur illisible : [${inner}]`);
        tokens.push({ t: 'keys', keys });
      }
      continue;
    }
    throw new Error(`Caractère inattendu « ${s[i]} » à la position ${i + 1}`);
  }
  return tokens;
}

function parseLiteral(raw) {
  const v = raw.trim();
  if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  const q = /^(['"])([\s\S]*)\1$/.exec(v);
  if (q) return q[2];
  const re = /^\/([\s\S]*)\/([a-z]*)$/.exec(v);
  if (re) return new RegExp(re[1], re[2].replace(/[^imsu]/g, ''));
  throw new Error(`Valeur illisible dans le filtre : ${v}`);
}

function parseCondition(src) {
  const ors = splitTop(src, '||').map((part) =>
    splitTop(part, '&&').map((atom) => {
      const m = /^\s*(!?)@((?:\.[A-Za-z_$][\w$-]*|\[\s*(?:'[^']*'|"[^"]*"|\d+)\s*\])*)\s*(?:(==|!=|>=|<=|>|<|=~)\s*([\s\S]+?))?\s*$/.exec(atom);
      if (!m) throw new Error(`Condition illisible : ${atom.trim()} (forme : @.champ > 3)`);
      const path = [...m[2].matchAll(/\.([A-Za-z_$][\w$-]*)|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]|\[\s*(\d+)\s*\]/g)].map((x) =>
        x[4] !== undefined ? Number(x[4]) : x[1] ?? x[2] ?? x[3]
      );
      return { not: m[1] === '!', path, op: m[3] || null, value: m[4] !== undefined ? parseLiteral(m[4]) : undefined };
    })
  );
  return ors;
}

function splitTop(src, sep) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (depth === 0 && src.startsWith(sep, i)) {
      out.push(src.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(src.slice(start));
  return out;
}

function testAtom(item, atom) {
  const v = getAt(item, atom.path);
  let r;
  if (!atom.op) r = v !== undefined && v !== null && v !== false;
  else if (atom.op === '=~') r = atom.value instanceof RegExp ? atom.value.test(String(v ?? '')) : String(v ?? '').includes(String(atom.value));
  else if (atom.op === '==') r = v === atom.value || (typeof v === 'number' && Number(atom.value) === v);
  else if (atom.op === '!=') r = !(v === atom.value || (typeof v === 'number' && Number(atom.value) === v));
  else {
    const a = typeof v === 'string' && typeof atom.value === 'string' ? v : Number(v);
    const b = typeof v === 'string' && typeof atom.value === 'string' ? atom.value : Number(atom.value);
    if (typeof a === 'number' && (Number.isNaN(a) || Number.isNaN(b))) r = false;
    else if (atom.op === '>') r = a > b;
    else if (atom.op === '>=') r = a >= b;
    else if (atom.op === '<') r = a < b;
    else r = a <= b;
  }
  return atom.not ? !r : r;
}

const childrenOf = (node) =>
  isContainer(node.value)
    ? (Array.isArray(node.value) ? node.value.map((_, i) => i) : Object.keys(node.value)).map((k) => ({ path: [...node.path, k], value: node.value[k] }))
    : [];

export function queryJson(root, expr, { limit = 10000 } = {}) {
  const tokens = tokenize(expr);
  let nodes = [{ path: [], value: root }];
  for (const tok of tokens) {
    const next = [];
    for (const node of nodes) {
      if (next.length >= limit) break;
      const v = node.value;
      switch (tok.t) {
        case 'key':
          if (isContainer(v) && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, tok.key)) next.push({ path: [...node.path, tok.key], value: v[tok.key] });
          break;
        case 'keys':
          if (isContainer(v)) for (const k of tok.keys) if (Object.prototype.hasOwnProperty.call(v, k)) next.push({ path: [...node.path, k], value: v[k] });
          break;
        case 'all':
          next.push(...childrenOf(node));
          break;
        case 'idx':
          if (Array.isArray(v)) for (const n of tok.list) {
            const i = n < 0 ? v.length + n : n;
            if (i >= 0 && i < v.length) next.push({ path: [...node.path, i], value: v[i] });
          }
          break;
        case 'slice':
          if (Array.isArray(v)) {
            const norm = (x, d) => (x === null ? d : x < 0 ? Math.max(0, v.length + x) : Math.min(v.length, x));
            for (let i = norm(tok.a, 0); i < norm(tok.b, v.length); i += 1) next.push({ path: [...node.path, i], value: v[i] });
          }
          break;
        case 'filter':
          for (const child of childrenOf(node)) {
            if (tok.cond.some((ands) => ands.every((atom) => testAtom(child.value, atom)))) next.push(child);
          }
          break;
        case 'deep': {
          const stack = [node];
          while (stack.length && next.length < limit) {
            const cur = stack.pop();
            const kids = childrenOf(cur);
            for (const k of kids) {
              const last = k.path[k.path.length - 1];
              if (tok.key === '*' || last === tok.key) next.push(k);
            }
            stack.push(...kids.filter((k) => isContainer(k.value)).reverse());
          }
          break;
        }
        default:
          break;
      }
    }
    nodes = next;
  }
  return nodes.slice(0, limit);
}

// --- Édition immuable -----------------------------------------------------------
export function setAt(root, path, value) {
  if (!path.length) return value;
  const [k, ...rest] = path;
  const copy = Array.isArray(root) ? [...root] : { ...root };
  copy[k] = setAt(root?.[k], rest, value);
  return copy;
}

export function deleteAt(root, path) {
  if (!path.length) return root;
  const [k, ...rest] = path;
  if (!rest.length) {
    if (Array.isArray(root)) return root.filter((_, i) => i !== k);
    const { [k]: _drop, ...others } = root;
    return others;
  }
  const copy = Array.isArray(root) ? [...root] : { ...root };
  copy[k] = deleteAt(root[k], rest);
  return copy;
}

// Renommer une clé en gardant sa place dans l'objet.
export function renameKey(root, path, newKey) {
  const parentPath = path.slice(0, -1);
  const oldKey = path[path.length - 1];
  const parent = getAt(root, parentPath);
  if (!isContainer(parent) || Array.isArray(parent) || oldKey === newKey) return root;
  if (Object.prototype.hasOwnProperty.call(parent, newKey)) throw new Error(`La clé « ${newKey} » existe déjà.`);
  const next = {};
  for (const k of Object.keys(parent)) next[k === oldKey ? newKey : k] = parent[k];
  return setAt(root, parentPath, next);
}

// Ajouter un enfant à un conteneur : clé (objet) ou élément en fin (tableau).
export function addChild(root, path, key, value) {
  const target = getAt(root, path);
  if (Array.isArray(target)) return setAt(root, path, [...target, value]);
  if (isContainer(target)) {
    if (Object.prototype.hasOwnProperty.call(target, key)) throw new Error(`La clé « ${key} » existe déjà.`);
    return setAt(root, path, { ...target, [key]: value });
  }
  throw new Error('On ne peut ajouter un enfant qu’à un objet ou un tableau.');
}

export function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (!isContainer(v)) return v;
  return Object.fromEntries(Object.keys(v).sort((a, b) => a.localeCompare(b)).map((k) => [k, sortKeysDeep(v[k])]));
}

// Saisie d'une valeur dans l'éditeur : JSON si possible (nombre, booléen,
// null, objet, "texte"), sinon texte brut.
export function parseEditedValue(raw) {
  const s = String(raw ?? '');
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// --- Statistiques et analyse -----------------------------------------------------
export function jsonStats(root) {
  const s = { nodes: 0, depth: 0, objects: 0, arrays: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, keys: 0, maxArray: 0 };
  const visit = (v, d) => {
    s.nodes += 1;
    s.depth = Math.max(s.depth, d);
    const t = typeOf(v);
    if (t === 'object') {
      s.objects += 1;
      const ks = Object.keys(v);
      s.keys += ks.length;
      for (const k of ks) visit(v[k], d + 1);
    } else if (t === 'array') {
      s.arrays += 1;
      s.maxArray = Math.max(s.maxArray, v.length);
      for (const x of v) visit(x, d + 1);
    } else if (t === 'string') s.strings += 1;
    else if (t === 'number') s.numbers += 1;
    else if (t === 'boolean') s.booleans += 1;
    else if (t === 'null') s.nulls += 1;
  };
  visit(root, 0);
  return s;
}

// Tableaux d'objets du document : ce sont eux qu'on peut voir en tableau,
// analyser et tracer. Triés du plus grand au plus petit.
export function findRecordArrays(root, { limit = 50 } = {}) {
  const out = [];
  const visit = (v, path, depth) => {
    if (depth > 8 || out.length > 500) return;
    if (Array.isArray(v)) {
      const objects = v.filter((x) => isContainer(x) && !Array.isArray(x)).length;
      if (v.length && objects / v.length >= 0.6) out.push({ path, count: v.length });
      v.slice(0, 50).forEach((x, i) => visit(x, [...path, i], depth + 1));
    } else if (isContainer(v)) {
      for (const k of Object.keys(v)) visit(v[k], [...path, k], depth + 1);
    }
  };
  visit(root, [], 0);
  return out.sort((a, b) => b.count - a.count).slice(0, limit);
}

// Colonnes d'un tableau d'objets : union des clés (objets imbriqués aplatis
// en « adresse.ville », sur un niveau).
export function recordColumns(records, { nested = true } = {}) {
  const cols = new Map();
  for (const r of records) {
    if (!isContainer(r) || Array.isArray(r)) continue;
    for (const [k, v] of Object.entries(r)) {
      if (nested && isContainer(v) && !Array.isArray(v) && Object.keys(v).length <= 12) {
        for (const sub of Object.keys(v)) cols.set(`${k}.${sub}`, [k, sub]);
      } else cols.set(k, [k]);
    }
  }
  return [...cols.entries()].map(([name, path]) => ({ name, path }));
}

export function analyzeRecords(records) {
  const rows = records.filter((r) => isContainer(r) && !Array.isArray(r));
  const columns = recordColumns(rows);
  const fields = columns.map(({ name, path }) => {
    const types = {};
    const counts = new Map();
    let filled = 0;
    let min = null;
    let max = null;
    let sum = 0;
    let nums = 0;
    for (const r of rows) {
      const v = getAt(r, path);
      if (v === undefined) continue;
      const t = typeOf(v);
      types[t] = (types[t] || 0) + 1;
      if (v !== null && v !== '') filled += 1;
      if (t === 'number') {
        nums += 1;
        sum += v;
        min = min === null ? v : Math.min(min, v);
        max = max === null ? v : Math.max(max, v);
      }
      const key = isContainer(v) ? JSON.stringify(v).slice(0, 80) : String(v);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    return {
      name,
      path,
      types,
      filled,
      total: rows.length,
      distinct: counts.size,
      numeric: nums > 0 && nums >= filled * 0.8,
      min,
      max,
      avg: nums ? sum / nums : null,
      sum: nums ? sum : null,
      top,
    };
  });
  return { count: rows.length, fields };
}

// Agrégation pour un graphique : groupe par `x` (ou par position), mesure
// `y` (count / sum / avg / min / max).
export function aggregateRecords(records, { x, y, agg = 'count', limit = 30 }) {
  const groups = new Map();
  records.forEach((r, i) => {
    if (!isContainer(r)) return;
    const raw = x ? getAt(r, x) : i;
    const key = raw === undefined ? '(absent)' : raw === null ? 'null' : isContainer(raw) ? JSON.stringify(raw) : String(raw);
    if (!groups.has(key)) groups.set(key, []);
    const v = y ? Number(getAt(r, y)) : 1;
    groups.get(key).push(v);
  });
  const fold = (vals) => {
    const nums = vals.filter((v) => Number.isFinite(v));
    if (agg === 'count') return vals.length;
    if (!nums.length) return 0;
    if (agg === 'sum') return nums.reduce((a, b) => a + b, 0);
    if (agg === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
    if (agg === 'min') return Math.min(...nums);
    return Math.max(...nums);
  };
  let points = [...groups.entries()].map(([label, vals]) => ({ label, value: fold(vals), n: vals.length }));
  const numericLabels = points.every((p) => p.label !== '' && Number.isFinite(Number(p.label)));
  if (numericLabels) points.sort((a, b) => Number(a.label) - Number(b.label));
  else if (agg === 'count' || x) points.sort((a, b) => b.value - a.value);
  const truncated = points.length > limit;
  if (truncated && !numericLabels) {
    const kept = points.slice(0, limit - 1);
    const rest = points.slice(limit - 1);
    kept.push({ label: `Autres (${rest.length})`, value: agg === 'count' || agg === 'sum' ? rest.reduce((a, p) => a + p.value, 0) : null, n: rest.reduce((a, p) => a + p.n, 0), other: true });
    points = kept.filter((p) => p.value !== null);
  } else if (truncated) points = points.slice(0, limit * 4);
  return { points, numericLabels, truncated };
}

// --- Schéma déduit (JSON Schema, brouillon 2020-12) -------------------------------
export function inferSchema(value, depth = 0) {
  const t = typeOf(value);
  if (depth > 12) return {};
  if (t === 'object') {
    const properties = {};
    for (const [k, v] of Object.entries(value)) properties[k] = inferSchema(v, depth + 1);
    return { type: 'object', properties, required: Object.keys(value) };
  }
  if (t === 'array') {
    if (!value.length) return { type: 'array', items: {} };
    return { type: 'array', items: mergeSchemas(value.slice(0, 500).map((v) => inferSchema(v, depth + 1))) };
  }
  if (t === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (t === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return { type: 'string', format: 'date-time' };
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { type: 'string', format: 'date' };
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return { type: 'string', format: 'email' };
    if (/^https?:\/\//.test(value)) return { type: 'string', format: 'uri' };
    return { type: 'string' };
  }
  return { type: t };
}

function mergeSchemas(list) {
  const types = new Set(list.map((s) => s.type));
  if (types.has('integer') && types.has('number')) {
    types.delete('integer');
    list = list.map((s) => (s.type === 'integer' ? { ...s, type: 'number' } : s));
  }
  if (types.size > 1) {
    const uniq = [...types].map((t) => mergeSchemas(list.filter((s) => s.type === t)));
    return { anyOf: uniq };
  }
  const [type] = [...types];
  if (type === 'object') {
    const props = {};
    const presence = {};
    for (const s of list) {
      for (const [k, v] of Object.entries(s.properties || {})) {
        (props[k] ||= []).push(v);
        presence[k] = (presence[k] || 0) + 1;
      }
    }
    return {
      type: 'object',
      properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, mergeSchemas(v)])),
      required: Object.keys(presence).filter((k) => presence[k] === list.length),
    };
  }
  if (type === 'array') return { type: 'array', items: mergeSchemas(list.map((s) => s.items || {}).filter((s) => s.type)) };
  const formats = new Set(list.map((s) => s.format));
  return formats.size === 1 && list[0].format ? { type, format: list[0].format } : { type };
}

// --- Export CSV --------------------------------------------------------------------
export function recordsToCsv(records, columns = recordColumns(records)) {
  const cell = (v) => {
    if (v === undefined || v === null) return '';
    const s = isContainer(v) ? JSON.stringify(v) : String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => cell(c.name)).join(',');
  const body = records.map((r) => columns.map((c) => cell(getAt(r, c.path))).join(','));
  return [header, ...body].join('\r\n');
}

// Aperçu court d'une valeur (arbre, cellules).
export function preview(value, max = 80) {
  const t = typeOf(value);
  if (t === 'string') return value.length > max ? `"${value.slice(0, max)}…"` : `"${value}"`;
  if (t === 'array') {
    // Petits tableaux de valeurs simples : on les montre (« [1, 2, 3] »).
    if (value.length <= 6 && value.every((x) => !isContainer(x))) {
      const s = `[${value.map((x) => preview(x, 20)).join(', ')}]`;
      if (s.length <= max) return s;
    }
    return `[${value.length} élément${value.length > 1 ? 's' : ''}]`;
  }
  if (t === 'object') {
    // Aperçu lisible : les premières clés et leurs valeurs, coupé à `max`.
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    let s = '{ ';
    for (let i = 0; i < keys.length; i += 1) {
      const part = `${keys[i]}: ${isContainer(value[keys[i]]) ? (Array.isArray(value[keys[i]]) ? '[…]' : '{…}') : preview(value[keys[i]], 24)}`;
      if (s.length + part.length > max - 4) return `${s}… }`;
      s += (i ? ', ' : '') + part;
    }
    return `${s} }`;
  }
  return String(value);
}
