// ---------------------------------------------------------------------------
// App native « Base de données » (extension « Orbit Base de données »).
//
// Le renderer ne parle jamais directement à une base : il envoie des ordres
// ici, par IPC. Ce module tient :
//   • les connexions ÉPINGLÉES (db-connections.json, mot de passe chiffré par
//     le trousseau du système via safeStorage) ;
//   • les connexions JETABLES, gardées en mémoire seulement et oubliées à la
//     fermeture d'Orbit ;
//   • les sessions ouvertes (un client par connexion), fermées proprement.
//
// Pilotes : SQLite (node:sqlite, intégré à Electron), MySQL / MariaDB
// (mysql2), PostgreSQL (pg), SQL Server (mssql). Chacun est chargé à la
// PREMIÈRE connexion de ce type, jamais au démarrage.
// ---------------------------------------------------------------------------
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import {
  DEFAULT_PORTS,
  DRIVERS,
  buildBrowse,
  buildColumnStats,
  buildDelete,
  buildInsert,
  buildUpdate,
  isReadOnlySql,
  toCell,
} from './db-sql.js';

const require = createRequire(import.meta.url);

const MAX_ROWS = 5000;

let file = null;
let crypt = { encrypt: (s) => s, decrypt: (s) => s, available: false };
// Pilotes non embarqués (SQL Server) : fournis par Orbit, qui sait les
// télécharger et les vérifier. Hors d'Orbit (tests), `require` classique.
let loadDriver = async (name) => require(name);
let saved = []; // connexions épinglées (sans mot de passe en clair)
const temporary = new Map(); // id → config complète (mémoire seulement)
const sessions = new Map(); // id → { driver, client, config }
// Mot de passe d'une connexion épinglée quand le système n'offre aucun
// trousseau : gardé en mémoire pour la session, jamais écrit en clair.
const unsavedPasswords = new Map(); // id → mot de passe

// ---------------------------------------------------------------------------
// Stockage
// ---------------------------------------------------------------------------
export function init(userDataDir, cryptoApi, options = {}) {
  file = path.join(userDataDir, 'db-connections.json');
  if (cryptoApi) crypt = cryptoApi;
  if (typeof options.loadDriver === 'function') loadDriver = options.loadDriver;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved = Array.isArray(raw?.connections) ? raw.connections : [];
  } catch {
    saved = [];
  }
}

function persist() {
  if (!file) return;
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 1, connections: saved }, null, 2));
  } catch (err) {
    console.error('[orbit] écriture des connexions impossible :', err.message);
  }
}

const PUBLIC_FIELDS = [
  'id',
  'name',
  'driver',
  'host',
  'port',
  'user',
  'database',
  'file',
  'ssl',
  'sslVerify',
  'readOnly',
  'color',
  'pinned',
];

function publicView(conn, pinned) {
  const out = {};
  for (const k of PUBLIC_FIELDS) if (conn[k] !== undefined) out[k] = conn[k];
  out.pinned = pinned;
  out.hasPassword = Boolean(conn.password || conn.passwordEnc || unsavedPasswords.has(conn.id));
  out.connected = sessions.has(conn.id);
  return out;
}

export function list() {
  return [...saved.map((c) => publicView(c, true)), ...[...temporary.values()].map((c) => publicView(c, false))];
}

function sanitize(input) {
  const driver = DRIVERS.includes(input?.driver) ? input.driver : null;
  if (!driver) throw new Error('Type de base inconnu.');
  const conn = {
    id: input.id || crypto.randomUUID(),
    name: String(input.name || '')
      .trim()
      .slice(0, 80),
    driver,
    readOnly: Boolean(input.readOnly),
    color: typeof input.color === 'string' ? input.color.slice(0, 20) : undefined,
  };
  if (driver === 'sqlite') {
    conn.file = String(input.file || '').trim();
    if (!conn.file) throw new Error('Choisissez un fichier SQLite.');
  } else {
    conn.host = String(input.host || 'localhost').trim();
    conn.port = Number(input.port) || DEFAULT_PORTS[driver];
    conn.user = String(input.user || '').trim();
    conn.database = String(input.database || '').trim();
    conn.ssl = Boolean(input.ssl);
    // Certificat du serveur vérifié par défaut : sans cela, le chiffrement ne
    // protège de rien (n'importe qui sur le chemin peut présenter le sien).
    // Décocher reste possible pour un serveur à certificat auto-signé, mais
    // c'est un choix explicite, visible dans le formulaire.
    conn.sslVerify = input.sslVerify !== false;
  }
  if (!conn.name) {
    conn.name = driver === 'sqlite' ? path.basename(conn.file) : `${conn.database || conn.host}`;
  }
  return conn;
}

// Enregistre (épinglée) ou garde en mémoire (jetable) une connexion.
// `password` : undefined = garder l'ancien, '' = aucun.
export async function upsert(input) {
  const conn = sanitize(input);
  const pinned = input.pinned !== false;
  const previousSaved = saved.find((c) => c.id === conn.id);
  const previousTemp = temporary.get(conn.id);
  let password = input.password;
  if (password === undefined) {
    password =
      previousTemp?.password ??
      (previousSaved?.passwordEnc ? await decryptPassword(previousSaved) : unsavedPasswords.get(conn.id) || '');
  }
  saved = saved.filter((c) => c.id !== conn.id);
  temporary.delete(conn.id);
  unsavedPasswords.delete(conn.id);
  // Une connexion modifiée doit se rouvrir avec ses nouveaux paramètres.
  if (sessions.has(conn.id)) disconnect(conn.id);
  if (pinned) {
    const entry = { ...conn };
    if (password) {
      if (!crypt.available) {
        // Pas de trousseau système : on n'écrit JAMAIS un mot de passe en clair.
        entry.passwordEnc = undefined;
        entry.passwordUnsaved = true;
        unsavedPasswords.set(conn.id, password);
      } else {
        entry.passwordEnc = await crypt.encrypt(password);
      }
    }
    saved.push(entry);
    persist();
  } else {
    temporary.set(conn.id, { ...conn, password });
  }
  return { success: true, connection: publicView(conn, pinned) };
}

async function decryptPassword(conn) {
  try {
    return conn.passwordEnc ? await crypt.decrypt(conn.passwordEnc) : '';
  } catch {
    return '';
  }
}

async function fullConfig(id) {
  const temp = temporary.get(id);
  if (temp) return temp;
  const conn = saved.find((c) => c.id === id);
  if (!conn) return null;
  const password = conn.passwordEnc ? await decryptPassword(conn) : unsavedPasswords.get(id) || '';
  return { ...conn, password };
}

export async function remove(id) {
  await disconnect(id);
  saved = saved.filter((c) => c.id !== id);
  temporary.delete(id);
  unsavedPasswords.delete(id);
  persist();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Pilotes
// ---------------------------------------------------------------------------
const drivers = {
  sqlite: {
    async connect(cfg) {
      const { DatabaseSync } = require('node:sqlite');
      if (!fs.existsSync(cfg.file) && cfg.readOnly) throw new Error('Fichier introuvable.');
      const db = new DatabaseSync(cfg.file, {
        readOnly: Boolean(cfg.readOnly),
      });
      return db;
    },
    async close(db) {
      db.close();
    },
    async query(db, sql, params = []) {
      const stmt = db.prepare(sql);
      const cols = stmt.columns();
      if (cols.length > 0) {
        stmt.setReturnArrays?.(true);
        const rows = [];
        let truncated = false;
        for (const row of stmt.iterate(...params)) {
          if (rows.length >= MAX_ROWS) {
            truncated = true;
            break;
          }
          rows.push(Array.isArray(row) ? row.map(toCell) : cols.map((c) => toCell(row[c.name])));
        }
        return { columns: cols.map((c) => c.name), rows, truncated };
      }
      const res = stmt.run(...params);
      return {
        columns: [],
        rows: [],
        affected: Number(res.changes),
        insertId: toCell(res.lastInsertRowid),
      };
    },
    async tables(db) {
      const r = await this.query(
        db,
        "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
      );
      return r.rows.map(([name, type]) => ({
        schema: '',
        name,
        type: type === 'view' ? 'view' : 'table',
      }));
    },
    async columns(db, _schema, table) {
      const r = await this.query(db, `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?)`, [table]);
      return r.rows.map(([name, type, notnull, dflt, pk]) => ({
        name,
        type: type || '',
        nullable: !notnull,
        default: dflt,
        pk: Number(pk) > 0,
      }));
    },
  },

  mysql: {
    async connect(cfg) {
      const mysql = require('mysql2/promise');
      const conn = await mysql.createConnection({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password || undefined,
        database: cfg.database || undefined,
        ssl: cfg.ssl ? { rejectUnauthorized: cfg.sslVerify !== false } : undefined,
        multipleStatements: false,
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
        connectTimeout: 10000,
      });
      if (cfg.readOnly) await conn.query('SET SESSION TRANSACTION READ ONLY');
      return conn;
    },
    async close(conn) {
      await conn.end();
    },
    async query(conn, sql, params = []) {
      const [result, fields] = await conn.query({
        sql,
        values: params,
        rowsAsArray: true,
      });
      if (Array.isArray(result) && fields) {
        const truncated = result.length > MAX_ROWS;
        return {
          columns: fields.map((f) => f.name),
          rows: result.slice(0, MAX_ROWS).map((r) => r.map(toCell)),
          truncated,
        };
      }
      return {
        columns: [],
        rows: [],
        affected: result?.affectedRows ?? 0,
        insertId: toCell(result?.insertId),
      };
    },
    async tables(conn) {
      const r = await this.query(
        conn,
        `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
         WHERE (DATABASE() IS NOT NULL AND TABLE_SCHEMA = DATABASE())
            OR (DATABASE() IS NULL AND TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys'))
         ORDER BY TABLE_SCHEMA, TABLE_TYPE, TABLE_NAME`,
      );
      return r.rows.map(([schema, name, type]) => ({
        schema,
        name,
        type: /VIEW/i.test(type) ? 'view' : 'table',
      }));
    },
    async columns(conn, schema, table) {
      const r = await this.query(
        conn,
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [schema || null, table],
      );
      return r.rows.map(([name, type, nullable, dflt, key]) => ({
        name,
        type,
        nullable: nullable === 'YES',
        default: dflt,
        pk: key === 'PRI',
      }));
    },
  },

  postgres: {
    async connect(cfg) {
      const { Client, types } = require('pg');
      // Dates et grands entiers en texte : pas de décalage de fuseau, pas de
      // perte de précision à l'affichage.
      const asText = (v) => v;
      for (const oid of [20, 1082, 1114, 1184, 1700]) types.setTypeParser(oid, asText);
      const client = new Client({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password || undefined,
        database: cfg.database || undefined,
        ssl: cfg.ssl ? { rejectUnauthorized: cfg.sslVerify !== false } : undefined,
        connectionTimeoutMillis: 10000,
      });
      await client.connect();
      if (cfg.readOnly) await client.query('SET default_transaction_read_only = on');
      return client;
    },
    async close(client) {
      await client.end();
    },
    async query(client, sql, params = []) {
      const res = await client.query({
        text: sql,
        values: params,
        rowMode: 'array',
      });
      const last = Array.isArray(res) ? res[res.length - 1] : res;
      if (last.fields && last.fields.length) {
        const truncated = last.rows.length > MAX_ROWS;
        return {
          columns: last.fields.map((f) => f.name),
          rows: last.rows.slice(0, MAX_ROWS).map((r) => r.map(toCell)),
          truncated,
        };
      }
      return { columns: [], rows: [], affected: last.rowCount ?? 0 };
    },
    async tables(client) {
      const r = await this.query(
        client,
        `SELECT table_schema, table_name, table_type FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_schema NOT LIKE 'pg_toast%'
         ORDER BY table_schema = 'public' DESC, table_schema, table_type, table_name`,
      );
      return r.rows.map(([schema, name, type]) => ({
        schema,
        name,
        type: /VIEW/i.test(type) ? 'view' : 'table',
      }));
    },
    async columns(client, schema, table) {
      const r = await this.query(
        client,
        `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
                EXISTS (
                  SELECT 1 FROM information_schema.table_constraints tc
                  JOIN information_schema.key_column_usage k
                    ON tc.constraint_name = k.constraint_name AND tc.table_schema = k.table_schema
                  WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema
                    AND tc.table_name = c.table_name AND k.column_name = c.column_name
                ) AS pk
         FROM information_schema.columns c
         WHERE c.table_schema = $1 AND c.table_name = $2 ORDER BY c.ordinal_position`,
        [schema || 'public', table],
      );
      return r.rows.map(([name, type, nullable, dflt, pk]) => ({
        name,
        type,
        nullable: nullable === 'YES',
        default: dflt,
        pk: Boolean(pk),
      }));
    },
  },

  mssql: {
    async connect(cfg) {
      // Téléchargé à la première connexion SQL Server (voir db-drivers.js).
      const sql = await loadDriver('mssql');
      const pool = new sql.ConnectionPool({
        server: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password || undefined,
        database: cfg.database || undefined,
        options: { encrypt: Boolean(cfg.ssl), trustServerCertificate: Boolean(cfg.ssl) && cfg.sslVerify === false },
        connectionTimeout: 10000,
        pool: { max: 2 },
      });
      await pool.connect();
      return pool;
    },
    async close(pool) {
      await pool.close();
    },
    async query(pool, text, params = []) {
      const req = pool.request();
      req.arrayRowMode = true;
      params.forEach((v, i) => req.input(`p${i + 1}`, v));
      const res = await req.query(text);
      const sets = res.recordsets || [];
      const last = sets[sets.length - 1];
      const cols = res.columns?.[res.columns.length - 1];
      if (last && cols) {
        const truncated = last.length > MAX_ROWS;
        return {
          columns: cols.map((c) => c.name),
          rows: last.slice(0, MAX_ROWS).map((r) => r.map(toCell)),
          truncated,
        };
      }
      const affected = (res.rowsAffected || []).reduce((a, b) => a + b, 0);
      return { columns: [], rows: [], affected };
    },
    async tables(pool) {
      const r = await this.query(
        pool,
        `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_SCHEMA, TABLE_TYPE, TABLE_NAME`,
      );
      return r.rows.map(([schema, name, type]) => ({
        schema,
        name,
        type: /VIEW/i.test(type) ? 'view' : 'table',
      }));
    },
    async columns(pool, schema, table) {
      const r = await this.query(
        pool,
        `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT,
                CASE WHEN EXISTS (
                  SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                  JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
                    ON tc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = k.TABLE_SCHEMA
                  WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = c.TABLE_SCHEMA
                    AND tc.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME
                ) THEN 1 ELSE 0 END
         FROM INFORMATION_SCHEMA.COLUMNS c
         WHERE c.TABLE_SCHEMA = @p1 AND c.TABLE_NAME = @p2 ORDER BY c.ORDINAL_POSITION`,
        [schema || 'dbo', table],
      );
      return r.rows.map(([name, type, nullable, dflt, pk]) => ({
        name,
        type,
        nullable: nullable === 'YES',
        default: dflt,
        pk: Boolean(pk),
      }));
    },
  },

  // Oracle : pilote officiel `oracledb` en mode « Thin » (JavaScript pur,
  // aucun Oracle Instant Client à installer). Téléchargé à la première
  // connexion, comme SQL Server. Le schéma affiché est celui de l'utilisateur
  // connecté (les schémas système d'Oracle se comptent par dizaines).
  oracle: {
    async connect(cfg) {
      const oracledb = await loadDriver('oracledb');
      // Textes longs (CLOB) lus comme du texte, pas comme des flux.
      oracledb.fetchAsString = [oracledb.CLOB];
      const conn = await oracledb.getConnection({
        user: cfg.user,
        password: cfg.password || undefined,
        // `database` = nom de SERVICE (FREEPDB1, ORCLPDB1, XEPDB1…).
        connectString: `${cfg.host}:${cfg.port}/${cfg.database || 'FREEPDB1'}`,
        connectTimeout: 10,
      });
      conn._orbit = oracledb;
      return conn;
    },
    async close(conn) {
      await conn.close();
    },
    async query(conn, sql, params = []) {
      const oracledb = conn._orbit;
      // Oracle refuse le « ; » final d'une requête SQL (pas d'un bloc PL/SQL).
      const text = /^\s*(begin|declare)\b/i.test(sql) ? sql : sql.replace(/;\s*$/, '');
      const res = await conn.execute(text, params, {
        outFormat: oracledb.OUT_FORMAT_ARRAY,
        maxRows: MAX_ROWS + 1,
        autoCommit: true,
      });
      if (res.metaData) {
        const rows = res.rows || [];
        return {
          columns: res.metaData.map((m) => m.name),
          rows: rows.slice(0, MAX_ROWS).map((r) => r.map(toCell)),
          truncated: rows.length > MAX_ROWS,
        };
      }
      return { columns: [], rows: [], affected: res.rowsAffected ?? 0 };
    },
    async tables(conn) {
      const r = await this.query(
        conn,
        `SELECT USER, TABLE_NAME, 'table' FROM USER_TABLES
         UNION ALL SELECT USER, VIEW_NAME, 'view' FROM USER_VIEWS
         ORDER BY 3, 2`
      );
      return r.rows.map(([schema, name, type]) => ({ schema, name, type }));
    },
    async columns(conn, schema, table) {
      const r = await this.query(
        conn,
        `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.NULLABLE, c.DATA_DEFAULT,
                CASE WHEN EXISTS (
                  SELECT 1 FROM ALL_CONSTRAINTS k JOIN ALL_CONS_COLUMNS kc
                    ON kc.OWNER = k.OWNER AND kc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
                  WHERE k.CONSTRAINT_TYPE = 'P' AND k.OWNER = c.OWNER AND k.TABLE_NAME = c.TABLE_NAME AND kc.COLUMN_NAME = c.COLUMN_NAME
                ) THEN 1 ELSE 0 END
         FROM ALL_TAB_COLUMNS c
         WHERE c.OWNER = COALESCE(:1, USER) AND c.TABLE_NAME = :2 ORDER BY c.COLUMN_ID`,
        [schema || null, table]
      );
      return r.rows.map(([name, type, nullable, dflt, pk]) => ({
        name,
        type,
        nullable: nullable === 'Y',
        default: typeof dflt === 'string' ? dflt.trim() : dflt,
        pk: Boolean(Number(pk)),
      }));
    },
  },
};

// ---------------------------------------------------------------------------
// Schéma complet (diagramme entité-relation)
//
// Trois requêtes pour toute la base (colonnes, clés primaires, clés
// étrangères) plutôt qu'une par table : sur une base de 300 tables, la
// différence est celle entre une seconde et une minute.
// ---------------------------------------------------------------------------
const MAX_SCHEMA_TABLES = 400;

const SCHEMA_SQL = {
  oracle: {
    columns: `SELECT OWNER, TABLE_NAME, COLUMN_NAME, DATA_TYPE, DECODE(NULLABLE, 'Y', 'YES', 'NO'), NULL, 0
              FROM ALL_TAB_COLUMNS WHERE OWNER = USER ORDER BY TABLE_NAME, COLUMN_ID`,
    pks: `SELECT cc.OWNER, cc.TABLE_NAME, cc.COLUMN_NAME
          FROM ALL_CONSTRAINTS c JOIN ALL_CONS_COLUMNS cc ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME
          WHERE c.CONSTRAINT_TYPE = 'P' AND c.OWNER = USER`,
    fks: `SELECT c.CONSTRAINT_NAME, c.OWNER, c.TABLE_NAME, cc.COLUMN_NAME, r.OWNER, r.TABLE_NAME, rc.COLUMN_NAME
          FROM ALL_CONSTRAINTS c
          JOIN ALL_CONS_COLUMNS cc ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME
          JOIN ALL_CONSTRAINTS r ON r.OWNER = c.R_OWNER AND r.CONSTRAINT_NAME = c.R_CONSTRAINT_NAME
          JOIN ALL_CONS_COLUMNS rc ON rc.OWNER = r.OWNER AND rc.CONSTRAINT_NAME = r.CONSTRAINT_NAME AND rc.POSITION = cc.POSITION
          WHERE c.CONSTRAINT_TYPE = 'R' AND c.OWNER = USER
          ORDER BY c.CONSTRAINT_NAME, cc.POSITION`,
  },
  mysql: {
    filter: `(DATABASE() IS NOT NULL AND TABLE_SCHEMA = DATABASE())
             OR (DATABASE() IS NULL AND TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys'))`,
    get columns() {
      return `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY = 'PRI'
              FROM information_schema.COLUMNS WHERE ${this.filter} ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`;
    },
    get fks() {
      return `SELECT CONSTRAINT_NAME, TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME,
                     REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
              FROM information_schema.KEY_COLUMN_USAGE
              WHERE REFERENCED_TABLE_NAME IS NOT NULL AND (${this.filter})
              ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`;
    },
    pks: null, // déjà donné par COLUMN_KEY
  },
  postgres: {
    columns: `SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default, false
              FROM information_schema.columns
              WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_schema NOT LIKE 'pg_toast%'
              ORDER BY table_schema, table_name, ordinal_position`,
    pks: `SELECT kcu.table_schema, kcu.table_name, kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name
          WHERE tc.constraint_type = 'PRIMARY KEY'`,
    fks: `SELECT c.conname, ns.nspname, cl.relname, a.attname, nf.nspname, clf.relname, af.attname
          FROM pg_constraint c
          JOIN pg_class cl ON cl.oid = c.conrelid
          JOIN pg_namespace ns ON ns.oid = cl.relnamespace
          JOIN pg_class clf ON clf.oid = c.confrelid
          JOIN pg_namespace nf ON nf.oid = clf.relnamespace
          CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(attnum, fattnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = k.fattnum
          WHERE c.contype = 'f' AND ns.nspname NOT IN ('pg_catalog','information_schema')
          ORDER BY c.conname, k.ord`,
  },
  mssql: {
    columns: `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, 0
              FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
    pks: `SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
            ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND tc.TABLE_NAME = kcu.TABLE_NAME
          WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'`,
    fks: `SELECT fk.name, SCHEMA_NAME(tp.schema_id), tp.name, cp.name, SCHEMA_NAME(tr.schema_id), tr.name, cr.name
          FROM sys.foreign_keys fk
          JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
          JOIN sys.tables tp ON tp.object_id = fkc.parent_object_id
          JOIN sys.columns cp ON cp.object_id = fkc.parent_object_id AND cp.column_id = fkc.parent_column_id
          JOIN sys.tables tr ON tr.object_id = fkc.referenced_object_id
          JOIN sys.columns cr ON cr.object_id = fkc.referenced_object_id AND cr.column_id = fkc.referenced_column_id
          ORDER BY fk.name, fkc.constraint_column_id`,
  },
};

// Lignes (nom, schéma, table, col, schéma cible, table cible, col cible) →
// relations, une par contrainte (plusieurs colonnes pour une clé composite).
function groupForeignKeys(rows) {
  const byName = new Map();
  for (const [name, schema, table, column, toSchema, toTable, toColumn] of rows) {
    const key = `${schema}.${table}.${name}`;
    if (!byName.has(key)) {
      byName.set(key, {
        name,
        from: { schema: schema || '', table, columns: [] },
        to: { schema: toSchema || '', table: toTable, columns: [] },
      });
    }
    const rel = byName.get(key);
    rel.from.columns.push(column);
    rel.to.columns.push(toColumn);
  }
  return [...byName.values()];
}

async function readSchema(driver, d, client) {
  const tableList = await d.tables(client);
  const tables = tableList.slice(0, MAX_SCHEMA_TABLES).map((t) => ({ ...t, columns: [] }));
  const byKey = new Map(tables.map((t) => [`${t.schema}.${t.name}`, t]));
  let relations = [];

  if (driver === 'sqlite') {
    for (const t of tables) {
      t.columns = await d.columns(client, '', t.name).catch(() => []);
      if (t.type === 'view') continue;
      const fk = await d
        .query(client, 'SELECT id, "table", "from", "to" FROM pragma_foreign_key_list(?) ORDER BY id, seq', [t.name])
        .catch(() => ({ rows: [] }));
      relations.push(
        ...groupForeignKeys(fk.rows.map(([id, toTable, from, to]) => [`fk${id}`, '', t.name, from, '', toTable, to])),
      );
    }
    // SQLite : `REFERENCES t` sans colonne vise la clé primaire de t.
    for (const r of relations) {
      const target = byKey.get(`.${r.to.table}`);
      const pk = target?.columns.filter((c) => c.pk).map((c) => c.name) || [];
      r.to.columns = r.to.columns.map((c, i) => c ?? pk[i] ?? pk[0] ?? null);
    }
  } else {
    const q = SCHEMA_SQL[driver];
    const cols = await d.query(client, q.columns);
    for (const [schema, table, name, type, nullable, dflt, pk] of cols.rows) {
      const t = byKey.get(`${schema}.${table}`);
      if (t)
        t.columns.push({
          name,
          type,
          nullable: nullable === 'YES',
          default: dflt,
          pk: Boolean(Number(pk)) || pk === true,
        });
    }
    if (q.pks) {
      const pks = await d.query(client, q.pks).catch(() => ({ rows: [] }));
      for (const [schema, table, column] of pks.rows) {
        const col = byKey.get(`${schema}.${table}`)?.columns.find((c) => c.name === column);
        if (col) col.pk = true;
      }
    }
    const fks = await d.query(client, q.fks).catch(() => ({ rows: [] }));
    relations = groupForeignKeys(fks.rows);
  }
  // Une relation vers une table hors du diagramme (autre base, limite
  // atteinte) n'a pas de carte où arriver : on l'écarte.
  relations = relations.filter(
    (r) => byKey.has(`${r.from.schema}.${r.from.table}`) && byKey.has(`${r.to.schema}.${r.to.table}`),
  );
  return {
    tables,
    relations,
    truncated: tableList.length > tables.length,
    totalTables: tableList.length,
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
async function openClient(cfg) {
  const driver = drivers[cfg.driver];
  if (!driver) throw new Error('Type de base inconnu.');
  try {
    return await driver.connect(cfg);
  } catch (err) {
    // Certificat refusé : on dit quoi faire, au lieu du code OpenSSL brut.
    const code = String(err?.code || '');
    const msg = String(err?.message || err);
    if (cfg.ssl && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|certificate/i.test(`${code} ${msg}`)) {
      throw new Error(
        'Le certificat du serveur n’a pas pu être vérifié (certificat auto-signé ou inconnu). Si vous faites confiance à ce serveur, décochez « Vérifier le certificat » dans la connexion.'
      );
    }
    throw err;
  }
}

export async function test(input) {
  const cfg = {
    ...sanitize(input),
    password: input.password ?? (await fullConfig(input.id))?.password ?? '',
  };
  const started = Date.now();
  const client = await openClient(cfg);
  try {
    await drivers[cfg.driver].query(client, 'SELECT 1');
  } finally {
    await drivers[cfg.driver].close(client).catch(() => {});
  }
  return { success: true, ms: Date.now() - started };
}

export async function connect(id) {
  if (sessions.has(id)) return { success: true };
  const cfg = await fullConfig(id);
  if (!cfg) throw new Error('Connexion introuvable.');
  const client = await openClient(cfg);
  sessions.set(id, { driver: cfg.driver, client, config: cfg });
  return { success: true };
}

export async function disconnect(id) {
  const s = sessions.get(id);
  if (!s) return { success: true };
  sessions.delete(id);
  queues.delete(id);
  await drivers[s.driver].close(s.client).catch(() => {});
  return { success: true };
}

// À la fermeture d'Orbit : toutes les sessions, et les jetables disparaissent
// d'elles-mêmes (jamais écrites).
export async function closeAll() {
  await Promise.all([...sessions.keys()].map((id) => disconnect(id)));
}

async function openSession(id) {
  if (!sessions.has(id)) await connect(id);
  return sessions.get(id);
}

// Une connexion = une file. Une seule requête à la fois par client : `pg` et
// `mysql2` refusent (ou refuseront) les requêtes simultanées sur un même
// client, et l'interface en lance souvent plusieurs d'un coup (arbre des
// tables, page de données, comptage). Les opérations s'enchaînent donc.
const queues = new Map(); // id → Promise
// Exécute `fn(session)` à son tour dans la file de la connexion.
async function withSession(id, fn) {
  const previous = queues.get(id) || Promise.resolve();
  let release;
  const turn = new Promise((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => turn);
  queues.set(id, chained);
  try {
    await previous;
    return await fn(await openSession(id));
  } finally {
    release();
    // File vide : on ne garde pas une chaîne de promesses qui grandit.
    if (queues.get(id) === chained) queues.delete(id);
  }
}

export async function query(id, sql, params = []) {
  return withSession(id, async (s) => {
    if (s.config.readOnly && !isReadOnlySql(sql)) {
      throw new Error('Connexion en lecture seule : cette requête modifierait la base.');
    }
    const started = Date.now();
    const res = await drivers[s.driver].query(s.client, sql, params);
    return { success: true, ...res, ms: Date.now() - started };
  });
}

export async function tables(id) {
  return withSession(id, async (s) => ({
    success: true,
    driver: s.driver,
    tables: await drivers[s.driver].tables(s.client),
  }));
}

export async function columns(id, schema, table) {
  return withSession(id, async (s) => ({
    success: true,
    columns: await drivers[s.driver].columns(s.client, schema, table),
  }));
}

export async function schema(id) {
  return withSession(id, async (s) => ({
    success: true,
    driver: s.driver,
    ...(await readSchema(s.driver, drivers[s.driver], s.client)),
  }));
}

export async function browse(id, opts) {
  return withSession(id, async (s) => {
    const { sql, countSql } = buildBrowse(s.driver, opts);
    const d = drivers[s.driver];
    // L'une après l'autre, jamais en parallèle sur le même client.
    const page = await d.query(s.client, sql);
    const count = await d.query(s.client, countSql).catch(() => null);
    const cols = await d.columns(s.client, opts.schema, opts.table).catch(() => []);
    return {
      success: true,
      ...page,
      total: count ? Number(count.rows[0]?.[0]) : null,
      columnInfo: cols,
      readOnly: Boolean(s.config.readOnly),
      sql,
    };
  });
}

function write(id, build) {
  return withSession(id, async (s) => {
    if (s.config.readOnly) throw new Error('Connexion en lecture seule.');
    const built = build(s.driver);
    const res = await drivers[s.driver].query(s.client, built.sql, built.params);
    return { success: true, affected: res.affected, sql: built.sql };
  });
}

export const updateRow = (id, args) => write(id, (driver) => buildUpdate(driver, args));
export const insertRow = (id, args) => write(id, (driver) => buildInsert(driver, args));
export const deleteRow = (id, args) => write(id, (driver) => buildDelete(driver, args));

// Profil des colonnes : remplissage, valeurs distinctes, bornes, plus
// fréquentes. Une colonne qui refuse un agrégat (JSON, BLOB…) garde ce qu'on
// a pu mesurer au lieu de faire échouer toute l'analyse.
export async function analyze(id, schema, table) {
  return withSession(id, async (s) => {
    const d = drivers[s.driver];
    const cols = await d.columns(s.client, schema, table);
    const out = [];
    for (const col of cols.slice(0, 60)) {
      const q = buildColumnStats(s.driver, { schema, table, column: col.name });
      const stat = { name: col.name, type: col.type, pk: col.pk };
      try {
        const r = await d.query(s.client, q.sql);
        const [total, filled, distinct] = r.rows[0] || [];
        Object.assign(stat, {
          total: Number(total),
          filled: Number(filled),
          distinct: Number(distinct),
        });
      } catch (err) {
        stat.error = err.message;
      }
      try {
        const r = await d.query(s.client, q.rangeSql);
        [stat.min, stat.max] = r.rows[0] || [];
      } catch {
        /* type sans ordre */
      }
      try {
        const r = await d.query(s.client, q.topSql);
        stat.top = r.rows.map(([value, n]) => ({ value, n: Number(n) }));
      } catch {
        /* type non groupable */
      }
      out.push(stat);
    }
    return { success: true, columns: out };
  });
}
