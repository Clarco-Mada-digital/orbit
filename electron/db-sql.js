// ---------------------------------------------------------------------------
// Construction SQL pure (sans pilote) pour l'app « Base de données ».
//
// Tout ce qui fabrique du SQL à partir d'un clic (modifier une cellule,
// supprimer une ligne, parcourir une table) vit ici : ces fonctions ne touchent
// à aucune connexion, elles sont donc testables sous `node --test`.
//
// Règle d'or : les VALEURS passent toujours en paramètres, jamais dans le
// texte. Seuls les noms (tables, colonnes) sont insérés, entre guillemets du
// dialecte, guillemets internes doublés.
// ---------------------------------------------------------------------------

export const DRIVERS = ['sqlite', 'mysql', 'postgres', 'mssql'];

export const DEFAULT_PORTS = { mysql: 3306, postgres: 5432, mssql: 1433 };

export function quoteIdent(driver, name) {
  const s = String(name);
  if (driver === 'mysql') return '`' + s.replace(/`/g, '``') + '`';
  if (driver === 'mssql') return '[' + s.replace(/]/g, ']]') + ']';
  return '"' + s.replace(/"/g, '""') + '"';
}

// `schema.table`, le schéma étant facultatif (SQLite, MySQL base courante).
export function qualified(driver, schema, table) {
  return schema ? `${quoteIdent(driver, schema)}.${quoteIdent(driver, table)}` : quoteIdent(driver, table);
}

// Marqueur du n-ième paramètre (1-based) selon le dialecte.
export function placeholder(driver, i) {
  if (driver === 'postgres') return `$${i}`;
  if (driver === 'mssql') return `@p${i}`;
  return '?';
}

function whereFromKey(driver, key, start) {
  const cols = Object.keys(key || {});
  if (cols.length === 0) throw new Error('Aucune clé primaire : modification refusée pour ne pas toucher plusieurs lignes.');
  const params = [];
  const parts = cols.map((col) => {
    const v = key[col];
    if (v === null || v === undefined) return `${quoteIdent(driver, col)} IS NULL`;
    params.push(v);
    return `${quoteIdent(driver, col)} = ${placeholder(driver, start + params.length)}`;
  });
  return { sql: parts.join(' AND '), params };
}

export function buildUpdate(driver, { schema, table, key, changes }) {
  const cols = Object.keys(changes || {});
  if (cols.length === 0) throw new Error('Aucune modification.');
  const params = cols.map((c) => changes[c]);
  const set = cols.map((c, i) => `${quoteIdent(driver, c)} = ${placeholder(driver, i + 1)}`).join(', ');
  const where = whereFromKey(driver, key, params.length);
  return {
    sql: `UPDATE ${qualified(driver, schema, table)} SET ${set} WHERE ${where.sql}`,
    params: [...params, ...where.params],
  };
}

export function buildInsert(driver, { schema, table, values }) {
  const cols = Object.keys(values || {});
  const target = qualified(driver, schema, table);
  if (cols.length === 0) {
    return {
      sql: driver === 'mysql' ? `INSERT INTO ${target} () VALUES ()` : `INSERT INTO ${target} DEFAULT VALUES`,
      params: [],
    };
  }
  return {
    sql: `INSERT INTO ${target} (${cols.map((c) => quoteIdent(driver, c)).join(', ')}) VALUES (${cols
      .map((_, i) => placeholder(driver, i + 1))
      .join(', ')})`,
    params: cols.map((c) => values[c]),
  };
}

export function buildDelete(driver, { schema, table, key }) {
  const where = whereFromKey(driver, key, 0);
  return { sql: `DELETE FROM ${qualified(driver, schema, table)} WHERE ${where.sql}`, params: where.params };
}

// Parcours paginé d'une table. `where` est le filtre tapé par l'utilisateur
// (sa propre base : c'est voulu), `orderBy` une colonne existante.
export function buildBrowse(driver, { schema, table, where, orderBy, desc, limit = 100, offset = 0 }) {
  const target = qualified(driver, schema, table);
  const lim = Math.max(1, Math.min(5000, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  const filter = where && String(where).trim() ? ` WHERE ${where}` : '';
  let order = orderBy ? ` ORDER BY ${quoteIdent(driver, orderBy)}${desc ? ' DESC' : ''}` : '';
  let page;
  if (driver === 'mssql') {
    // OFFSET/FETCH exige un ORDER BY.
    if (!order) order = ' ORDER BY (SELECT NULL)';
    page = ` OFFSET ${off} ROWS FETCH NEXT ${lim} ROWS ONLY`;
  } else {
    page = ` LIMIT ${lim} OFFSET ${off}`;
  }
  return {
    sql: `SELECT * FROM ${target}${filter}${order}${page}`,
    countSql: `SELECT COUNT(*) AS n FROM ${target}${filter}`,
  };
}

// Requêtes de profil d'une colonne (onglet « Analyse »).
export function buildColumnStats(driver, { schema, table, column }) {
  const target = qualified(driver, schema, table);
  const c = quoteIdent(driver, column);
  return {
    sql: `SELECT COUNT(*) AS total, COUNT(${c}) AS filled, COUNT(DISTINCT ${c}) AS distinct_values FROM ${target}`,
    rangeSql: `SELECT MIN(${c}) AS min_value, MAX(${c}) AS max_value FROM ${target}`,
    topSql:
      driver === 'mssql'
        ? `SELECT TOP 5 ${c} AS value, COUNT(*) AS n FROM ${target} GROUP BY ${c} ORDER BY COUNT(*) DESC`
        : `SELECT ${c} AS value, COUNT(*) AS n FROM ${target} GROUP BY ${c} ORDER BY COUNT(*) DESC LIMIT 5`,
  };
}

// Une requête modifie-t-elle quelque chose ? Sert au mode « lecture seule ».
// Volontairement prudent : tout ce qui n'est pas reconnu comme lecture est
// considéré comme une écriture.
const READ_START = /^(select|with|show|describe|desc|explain|pragma|values|table)\b/i;
const WRITE_WORDS = /\b(insert|update|delete|merge|drop|alter|create|truncate|replace|grant|revoke|attach|detach|vacuum|reindex|call|exec|execute)\b/i;

export function stripSqlComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .trim();
}

export function isReadOnlySql(sql) {
  const s = stripSqlComments(sql);
  if (!READ_START.test(s)) return false;
  // `WITH x AS (...) DELETE ...` ou `PRAGMA x = y` modifient.
  if (/^with\b/i.test(s) && WRITE_WORDS.test(s)) return false;
  if (/^pragma\b/i.test(s) && /=/.test(s)) return false;
  return true;
}

// Valeur transportable par IPC et affichable : Buffer → aperçu, BigInt →
// texte, Date → ISO. Le renderer n'a jamais à deviner un type exotique.
export function toCell(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
  if (value instanceof Uint8Array) {
    const hex = Buffer.from(value.subarray(0, 32)).toString('hex');
    return { $binary: true, size: value.length, preview: hex };
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
}
