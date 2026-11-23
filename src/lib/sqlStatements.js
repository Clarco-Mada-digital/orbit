// ---------------------------------------------------------------------------
// Découpage d'un script SQL en requêtes (app « Base de données »).
//
// Sert à exécuter un fichier .sql requête par requête, comme les extensions
// SQL de VS Code : chaque requête a sa ligne de départ, et un ▶ dans la marge
// l'exécute seule. Le découpage respecte les chaînes ('…', "…", `…`, […]),
// les commentaires (-- et /* */), le dollar-quoting de PostgreSQL ($$ … $$,
// $tag$ … $tag$) et la commande `DELIMITER` des scripts MySQL.
// ---------------------------------------------------------------------------

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

// Retire les commentaires et blancs de tête : une « requête » faite seulement
// de commentaires n'est pas une requête.
function meaningful(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\n)\s*--[^\n]*/g, '\n')
    .replace(/(^|\n)\s*#[^\n]*/g, '\n')
    .trim();
}

export function splitSql(text) {
  const src = String(text ?? '');
  const out = [];
  let delimiter = ';';
  let start = 0;
  let i = 0;
  const n = src.length;

  const push = (end, nextStart) => {
    const raw = src.slice(start, end);
    if (meaningful(raw)) {
      // Le ▶ de la marge doit tomber sur la première ligne de SQL, pas sur
      // le commentaire qui la précède.
      let lead = 0;
      for (;;) {
        const rest = raw.slice(lead);
        const m = /^(\s+|--[^\n]*\n?|#[^\n]*\n?|\/\*[\s\S]*?\*\/)/.exec(rest);
        if (!m || !m[0]) break;
        lead += m[0].length;
      }
      const s = start + lead;
      out.push({ text: src.slice(s, end).trim(), start: s, end, line: lineAt(src, s) });
    }
    start = nextStart;
  };

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    // Ligne `DELIMITER $$` (clients MySQL) : change le séparateur.
    if ((i === 0 || src[i - 1] === '\n') && /^delimiter\s+\S+/i.test(src.slice(i, i + 40))) {
      const eol = src.indexOf('\n', i);
      const lineEnd = eol === -1 ? n : eol;
      push(i, lineEnd + 1);
      delimiter = src.slice(i, lineEnd).trim().split(/\s+/)[1];
      i = lineEnd + 1;
      start = i;
      continue;
    }

    if (ch === '-' && next === '-') {
      const eol = src.indexOf('\n', i);
      i = eol === -1 ? n : eol + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = src.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      i += 1;
      while (i < n) {
        if (src[i] === '\\' && ch !== '"') {
          i += 2;
          continue;
        }
        if (src[i] === ch) {
          if (src[i + 1] === ch) {
            i += 2;
            continue;
          }
          break;
        }
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === '[') {
      const close = src.indexOf(']', i + 1);
      // Crochet non fermé sur la ligne : ce n'est pas un identifiant SQL Server.
      const eol = src.indexOf('\n', i);
      if (close !== -1 && (eol === -1 || close < eol)) {
        i = close + 1;
        continue;
      }
    }
    if (ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i, i + 64));
      if (m && !(delimiter.startsWith('$') && src.startsWith(delimiter, i))) {
        const tag = m[0];
        const close = src.indexOf(tag, i + tag.length);
        i = close === -1 ? n : close + tag.length;
        continue;
      }
    }
    if (src.startsWith(delimiter, i)) {
      push(i, i + delimiter.length);
      i += delimiter.length;
      continue;
    }
    i += 1;
  }
  push(n, n);
  return out;
}

// Requête sous le curseur (Ctrl+Entrée). Le curseur juste après le `;` vaut
// encore pour la requête qu'il termine, comme dans les éditeurs SQL courants.
export function statementAt(text, cursor) {
  const list = splitSql(text);
  if (list.length === 0) return null;
  const pos = Math.max(0, Number(cursor) || 0);
  let best = list[0];
  for (const st of list) {
    if (pos >= st.start) best = st;
    if (pos >= st.start && pos <= st.end + 1) return st;
  }
  return best;
}

// Valeurs → CSV (RFC 4180) pour l'export des résultats.
export function toCsv(columns, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? (v.$binary ? `0x${v.preview}` : JSON.stringify(v)) : String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
}

export function toJsonRows(columns, rows) {
  return JSON.stringify(
    rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))),
    null,
    2
  );
}

// `INSERT` prêts à rejouer ailleurs (export SQL d'un résultat).
export function toInsertSql(table, columns, rows) {
  const lit = (v) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'object' && v.$binary) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
  };
  const cols = columns.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(', ');
  return rows.map((r) => `INSERT INTO ${table} (${cols}) VALUES (${r.map(lit).join(', ')});`).join('\n');
}
