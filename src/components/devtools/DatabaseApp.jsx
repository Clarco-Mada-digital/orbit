import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Eye,
  FileCode2,
  FolderOpen,
  History,
  Loader2,
  Network,
  Pencil,
  Pin,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Star,
  Table2,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import ConnectionForm, { DRIVER_INFO } from './ConnectionForm';
import CodeEditor from './CodeEditor';
import ResultGrid from './ResultGrid';
import SchemaDiagram from './SchemaDiagram';
import { splitSql, statementAt, toCsv, toInsertSql, toJsonRows } from '../../lib/sqlStatements';
import { useDbUiStore, useDevToolsStore } from '../../lib/devToolsStore';

// ---------------------------------------------------------------------------
// Base de données — app native d'Orbit (extension « Orbit Base de données »).
//
//   • à gauche : connexions (épinglées / jetables) et arbre des tables ;
//   • au centre : onglets — éditeur SQL (fichier .sql exécutable requête par
//     requête) ou table (données éditables, structure, analyse).
// ---------------------------------------------------------------------------
const api = () => window.electronAPI?.database;
const NO_ENTRIES = [];
let tabSeq = 0;
const newTabId = () => `t${Date.now().toString(36)}${(tabSeq += 1)}`;

function download(name, content) {
  window.electronAPI?.devFiles?.save({ defaultPath: name, content });
}

// ---------------------------------------------------------------------------
// Barre latérale
// ---------------------------------------------------------------------------
function ConnectionItem({ conn, active, expanded, tables, loading, filter, onSelect, onToggle, onOpenTable, onEdit, onRemove, onDisconnect, onRefresh }) {
  const d = DRIVER_INFO[conn.driver];
  const visible = (tables || []).filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()));
  const groups = useMemo(() => {
    const g = new Map();
    for (const t of visible) {
      const key = t.schema || '';
      if (!g.has(key)) g.set(key, []);
      g.get(key).push(t);
    }
    return [...g.entries()];
  }, [visible]);

  return (
    <div className={`rounded-lg ${active ? 'bg-bg-hover' : ''}`}>
      <div className="group flex items-center gap-1 px-1.5 py-1">
        <button className="btn-icon h-5 w-5 flex-shrink-0" onClick={onToggle}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm" onClick={onSelect} title={conn.driver === 'sqlite' ? conn.file : `${conn.user ? `${conn.user}@` : ''}${conn.host}:${conn.port}/${conn.database || ''}`}>
          <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: conn.connected ? d?.color : 'transparent', border: `1.5px solid ${d?.color}` }} />
          <span className="truncate">{conn.name}</span>
          {conn.pinned ? <Pin size={10} className="flex-shrink-0 text-text-muted" /> : <span className="flex-shrink-0 rounded bg-bg-elevated px-1 text-[9px] uppercase text-text-muted">jetable</span>}
          {conn.readOnly ? <ShieldCheck size={11} className="flex-shrink-0 text-success" title="Lecture seule" /> : null}
        </button>
        <div className="hidden flex-shrink-0 items-center group-hover:flex">
          {conn.connected ? (
            <>
              <button className="btn-icon h-5 w-5" onClick={onRefresh} title="Actualiser">
                <RefreshCw size={11} />
              </button>
              <button className="btn-icon h-5 w-5" onClick={onDisconnect} title="Déconnecter">
                <Unplug size={11} />
              </button>
            </>
          ) : null}
          <button className="btn-icon h-5 w-5" onClick={onEdit} title="Modifier">
            <Pencil size={11} />
          </button>
          <button className="btn-icon h-5 w-5 hover:text-error" onClick={onRemove} title="Supprimer">
            <Trash2 size={11} />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="pb-1 pl-6 pr-1">
          {loading ? (
            <div className="flex items-center gap-1.5 py-1 text-xs text-text-muted">
              <Loader2 size={12} className="animate-spin" /> Chargement…
            </div>
          ) : visible.length === 0 ? (
            <div className="py-1 text-xs text-text-muted">{tables ? 'Aucune table' : '—'}</div>
          ) : (
            groups.map(([schema, list]) => (
              <div key={schema}>
                {groups.length > 1 || (schema && schema !== 'public' && schema !== 'dbo') ? (
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">{schema || 'principal'}</div>
                ) : null}
                {list.map((t) => (
                  <button
                    key={`${t.schema}.${t.name}`}
                    onClick={() => onOpenTable(t)}
                    className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-bg-hover"
                  >
                    {t.type === 'view' ? <Eye size={12} className="flex-shrink-0 text-text-muted" /> : <Table2 size={12} className="flex-shrink-0 text-text-muted" />}
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet « Requête » : éditeur + résultats
// ---------------------------------------------------------------------------
function QueryTab({ tab, conn, onChange }) {
  const editor = useRef(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]); // [{ sql, line, ...résultat }]
  const [current, setCurrent] = useState(0);
  const [panel, setPanel] = useState(null); // 'history' | 'favorites'
  const pushHistory = useDbUiStore((s) => s.pushHistory);
  // Repli sur une constante : un `[]` neuf à chaque lecture ferait boucler
  // zustand (nouvelle référence → nouveau rendu → nouvelle référence…).
  const history = useDbUiStore((s) => s.history[conn.id] || NO_ENTRIES);
  const favorites = useDbUiStore((s) => s.favorites[conn.id] || NO_ENTRIES);
  const addFavorite = useDbUiStore((s) => s.addFavorite);
  const removeFavorite = useDbUiStore((s) => s.removeFavorite);
  const statements = useMemo(() => splitSql(tab.sql || ''), [tab.sql]);

  const runList = useCallback(
    async (list) => {
      if (!list.length) return;
      setRunning(true);
      const out = [];
      for (const st of list) {
        const res = await api()?.query(conn.id, st.text);
        const entry = { sql: st.text, line: st.line, ...(res || { success: false, error: 'Pas de réponse' }) };
        out.push(entry);
        pushHistory(conn.id, { sql: st.text, ms: res?.ms, rows: res?.rows?.length, error: res?.success ? undefined : res?.error });
        // Un script s'arrête à la première erreur, comme un client SQL.
        if (!res?.success) break;
      }
      setResults(out);
      // On montre le dernier résultat qui a des lignes, sinon le dernier.
      const withRows = out.map((r, i) => (r.columns?.length ? i : -1)).filter((i) => i >= 0);
      setCurrent(out[out.length - 1]?.success === false ? out.length - 1 : withRows.length ? withRows[withRows.length - 1] : out.length - 1);
      setRunning(false);
    },
    [conn.id, pushHistory]
  );

  const runCurrent = () => {
    const sel = editor.current?.selection();
    if (sel && sel.text.trim()) {
      runList(splitSql(sel.text).map((s) => ({ ...s, line: s.line })));
      return;
    }
    const st = statementAt(tab.sql || '', sel?.start ?? 0);
    if (st) runList([st]);
  };

  const openFile = async () => {
    const res = await window.electronAPI?.devFiles?.open({ title: 'Ouvrir un script SQL', filters: [{ name: 'SQL', extensions: ['sql', 'txt'] }, { name: 'Tous', extensions: ['*'] }] });
    if (res?.success) onChange({ sql: res.content, file: res.path, title: res.name });
  };
  const saveFile = async () => {
    const res = await window.electronAPI?.devFiles?.save({ path: tab.file, defaultPath: 'requetes.sql', content: tab.sql || '', filters: [{ name: 'SQL', extensions: ['sql'] }] });
    if (res?.success) onChange({ file: res.path, title: res.name });
  };

  const result = results[current];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <button className="btn btn-primary btn-sm flex items-center gap-1.5" onClick={runCurrent} disabled={running} title="Exécuter la requête sous le curseur, ou la sélection (Ctrl+Entrée)">
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Exécuter
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => runList(statements)} disabled={running || !statements.length} title="Exécuter tout le script, requête par requête">
          Tout exécuter ({statements.length})
        </button>
        <div className="mx-1 h-5 w-px bg-border" />
        <button className="btn-icon" onClick={openFile} title="Ouvrir un fichier .sql">
          <FolderOpen size={15} />
        </button>
        <button className="btn-icon" onClick={saveFile} title={tab.file ? `Enregistrer (${tab.file})` : 'Enregistrer en .sql'}>
          <Save size={15} />
        </button>
        <button
          className="btn-icon"
          title="Ajouter aux favoris"
          onClick={() => {
            const sel = editor.current?.selection();
            const sql = (sel?.text || '').trim() || statementAt(tab.sql || '', sel?.start ?? 0)?.text;
            if (!sql) return;
            const name = sql.replace(/\s+/g, ' ').slice(0, 60);
            addFavorite(conn.id, name, sql);
            setPanel('favorites');
          }}
        >
          <BookmarkPlus size={15} />
        </button>
        <button className={`btn-icon ${panel === 'history' ? 'bg-bg-hover' : ''}`} onClick={() => setPanel(panel === 'history' ? null : 'history')} title="Historique">
          <History size={15} />
        </button>
        <button className={`btn-icon ${panel === 'favorites' ? 'bg-bg-hover' : ''}`} onClick={() => setPanel(panel === 'favorites' ? null : 'favorites')} title="Requêtes favorites">
          <Star size={15} className={favorites.length ? 'fill-current text-yellow-500' : ''} />
        </button>
        {conn.readOnly ? (
          <span className="ml-auto flex items-center gap-1 text-xs text-success">
            <ShieldCheck size={13} /> Lecture seule
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-[140px] flex-col p-2" style={{ height: '40%' }}>
            <CodeEditor
              ref={editor}
              value={tab.sql || ''}
              onChange={(sql) => onChange({ sql })}
              onRun={runCurrent}
              runnables={statements.map((s) => ({ ...s, title: s.text.slice(0, 120) }))}
              onRunAt={(st) => runList([st])}
              placeholder={'-- Écrivez vos requêtes, une par ligne terminée par « ; »\n-- Ctrl+Entrée exécute la requête sous le curseur, ▶ dans la marge en exécute une précise.\nSELECT * FROM ma_table LIMIT 100;'}
              className="flex-1"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-border">
            {results.length > 1 ? (
              <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1">
                {results.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrent(i)}
                    className={`flex-shrink-0 rounded px-2 py-0.5 text-xs ${i === current ? 'bg-bg-hover font-medium' : 'text-text-muted hover:bg-bg-hover'} ${r.success === false ? 'text-error' : ''}`}
                    title={r.sql}
                  >
                    L{r.line} · {r.success === false ? 'erreur' : r.columns?.length ? `${r.rows.length} lignes` : `${r.affected ?? 0} modif.`}
                  </button>
                ))}
              </div>
            ) : null}
            <ResultPane result={result} />
          </div>
        </div>

        {panel ? (
          <div className="flex w-72 flex-shrink-0 flex-col border-l border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm font-semibold">
              {panel === 'history' ? 'Historique' : 'Favoris'}
              <button className="btn-icon h-6 w-6" onClick={() => setPanel(null)}>
                <X size={13} />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
              {(panel === 'history' ? history : favorites).length === 0 ? (
                <p className="p-2 text-xs text-text-muted">{panel === 'history' ? 'Aucune requête exécutée.' : 'Aucun favori : ⭐ ajoute la requête sous le curseur.'}</p>
              ) : null}
              {(panel === 'history' ? history : favorites).map((h, i) => (
                <div key={h.id || i} className="group rounded border border-border p-2 text-xs hover:bg-bg-hover">
                  {h.name ? <div className="mb-1 font-medium">{h.name}</div> : null}
                  <button className="block w-full text-left font-mono text-[11px] text-text-secondary" onClick={() => onChange({ sql: `${(tab.sql || '').trimEnd()}${tab.sql ? '\n\n' : ''}${h.sql};\n` })} title="Insérer dans l’éditeur">
                    <span className="line-clamp-3 whitespace-pre-wrap break-all">{h.sql}</span>
                  </button>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
                    {h.at ? <span>{new Date(h.at).toLocaleString()}</span> : null}
                    {h.error ? <span className="text-error">erreur</span> : h.ms !== undefined ? <span>{h.ms} ms</span> : null}
                    <button className="ml-auto text-success hover:underline" onClick={() => runList([{ text: h.sql, line: 0 }])}>
                      Exécuter
                    </button>
                    {h.id ? (
                      <button className="hover:text-error" onClick={() => removeFavorite(conn.id, h.id)}>
                        Retirer
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ExportMenu({ columns, rows, table }) {
  const [open, setOpen] = useState(false);
  if (!columns?.length) return null;
  const base = (table || 'resultat').replace(/[^\w.-]+/g, '_');
  return (
    <div className="relative">
      <button className="btn btn-secondary btn-sm flex items-center gap-1" onClick={() => setOpen(!open)}>
        <Download size={13} /> Exporter
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-lg border border-border bg-bg-elevated p-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          {[
            ['CSV', () => download(`${base}.csv`, toCsv(columns, rows))],
            ['JSON', () => download(`${base}.json`, toJsonRows(columns, rows))],
            ['SQL (INSERT)', () => download(`${base}.sql`, toInsertSql(table || 'resultat', columns, rows))],
            ['Copier (CSV)', () => navigator.clipboard?.writeText(toCsv(columns, rows))],
          ].map(([label, fn]) => (
            <button
              key={label}
              className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-bg-hover"
              onClick={() => {
                fn();
                setOpen(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResultPane({ result }) {
  if (!result) return <div className="flex flex-1 items-center justify-center text-sm text-text-muted">Les résultats s’afficheront ici.</div>;
  if (result.success === false) {
    return (
      <div className="m-3 rounded-lg border border-error/40 bg-error/10 p-3 text-sm text-error">
        <div className="mb-1 font-semibold">Erreur{result.line ? ` (ligne ${result.line})` : ''}</div>
        <pre className="whitespace-pre-wrap break-words font-mono text-xs select-text">{result.error}</pre>
      </div>
    );
  }
  if (!result.columns?.length) {
    return (
      <div className="m-3 text-sm text-success">
        ✓ Requête exécutée — {result.affected ?? 0} ligne(s) modifiée(s){result.insertId ? `, id inséré : ${result.insertId}` : ''} · {result.ms} ms
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-3 py-1.5 text-xs text-text-muted">
        <span>
          {result.rows.length} ligne(s){result.truncated ? ' (limité à 5 000)' : ''} · {result.ms} ms
        </span>
        <div className="ml-auto">
          <ExportMenu columns={result.columns} rows={result.rows} />
        </div>
      </div>
      <ResultGrid key={result.sql + result.ms} columns={result.columns} rows={result.rows} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet « Table » : données / structure / analyse
// ---------------------------------------------------------------------------
function TableTab({ tab, conn }) {
  const [view, setView] = useState('data');
  const [state, setState] = useState({ loading: true });
  const [where, setWhere] = useState('');
  const [appliedWhere, setAppliedWhere] = useState('');
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(100);
  const [message, setMessage] = useState(null);
  const [adding, setAdding] = useState(null);
  const [stats, setStats] = useState(null);
  const target = { schema: tab.schema, table: tab.table };

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const res = await api()?.browse(conn.id, { ...target, where: appliedWhere, orderBy: sort?.column, desc: sort?.desc, limit, offset: page * limit });
    setState({ loading: false, ...res });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id, tab.schema, tab.table, appliedWhere, sort, page, limit]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const pkCols = (state.columnInfo || []).filter((c) => c.pk).map((c) => c.name);
  const canEdit = tab.type !== 'view' && !state.readOnly && !conn.readOnly && pkCols.length > 0;
  const keyOf = (rowIndex) => {
    const row = state.rows[rowIndex];
    return Object.fromEntries(pkCols.map((c) => [c, row[state.columns.indexOf(c)]]));
  };

  const editCell = async (r, column, value) => {
    const res = await api()?.update(conn.id, { ...target, key: keyOf(r), changes: { [column]: value } });
    setMessage(res?.success ? { ok: true, text: `${res.affected} ligne modifiée` } : { ok: false, text: res?.error });
    load();
  };
  const deleteRow = async (r) => {
    const key = keyOf(r);
    if (!window.confirm(`Supprimer la ligne ${JSON.stringify(key)} ?`)) return;
    const res = await api()?.deleteRow(conn.id, { ...target, key });
    setMessage(res?.success ? { ok: true, text: 'Ligne supprimée' } : { ok: false, text: res?.error });
    load();
  };
  const insert = async () => {
    const values = Object.fromEntries(Object.entries(adding || {}).filter(([, v]) => v !== ''));
    const res = await api()?.insert(conn.id, { ...target, values });
    setMessage(res?.success ? { ok: true, text: 'Ligne ajoutée' } : { ok: false, text: res?.error });
    if (res?.success) {
      setAdding(null);
      load();
    }
  };
  const analyze = async () => {
    setStats({ loading: true });
    const res = await api()?.analyze(conn.id, tab.schema, tab.table);
    setStats(res?.success ? res : { error: res?.error });
  };

  const totalPages = state.total != null ? Math.max(1, Math.ceil(state.total / limit)) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-3 pt-2">
        {[
          ['data', 'Données', Table2],
          ['structure', 'Structure', FileCode2],
          ['analyse', 'Analyse', BarChart3],
        ].map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => {
              setView(id);
              if (id === 'analyse' && !stats) analyze();
            }}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm ${view === id ? 'border-accent-primary font-medium' : 'border-transparent text-text-muted hover:text-text-primary'}`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {view === 'data' ? (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <div className="flex min-w-[16rem] flex-1 items-center gap-1 rounded-lg border border-border bg-bg-primary px-2">
              <span className="font-mono text-xs text-text-muted">WHERE</span>
              <input
                value={where}
                onChange={(e) => setWhere(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setPage(0);
                    setAppliedWhere(where);
                  }
                }}
                placeholder="ex. age > 30 AND nom LIKE 'A%'  (Entrée)"
                className="min-w-0 flex-1 bg-transparent py-1 font-mono text-xs outline-none"
              />
            </div>
            <button className="btn-icon" onClick={load} title="Actualiser">
              {state.loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            </button>
            {canEdit ? (
              <button className="btn btn-secondary btn-sm flex items-center gap-1" onClick={() => setAdding(adding ? null : {})}>
                <Plus size={13} /> Ligne
              </button>
            ) : null}
            <ExportMenu columns={state.columns} rows={state.rows} table={tab.table} />
          </div>
          {!canEdit && !state.loading && state.success ? (
            <div className="border-b border-border bg-bg-secondary px-3 py-1 text-[11px] text-text-muted">
              {conn.readOnly || state.readOnly
                ? 'Lecture seule : édition désactivée.'
                : tab.type === 'view'
                  ? 'Vue : non modifiable.'
                  : 'Pas de clé primaire : édition désactivée pour ne jamais modifier plusieurs lignes par erreur. Utilisez une requête SQL.'}
            </div>
          ) : canEdit ? (
            <div className="border-b border-border bg-bg-secondary px-3 py-1 text-[11px] text-text-muted">Double-clic sur une cellule pour la modifier.</div>
          ) : null}
          {adding ? (
            <div className="flex flex-wrap items-end gap-2 border-b border-border bg-bg-secondary p-3">
              {(state.columnInfo || []).map((c) => (
                <label key={c.name} className="text-xs">
                  <span className="mb-0.5 block text-text-muted">
                    {c.name} <span className="opacity-70">{c.type}</span>
                  </span>
                  <input className="input w-36 py-1 font-mono text-xs" placeholder={c.default ? `défaut : ${c.default}` : c.nullable ? 'NULL' : ''} value={adding[c.name] ?? ''} onChange={(e) => setAdding({ ...adding, [c.name]: e.target.value })} />
                </label>
              ))}
              <button className="btn btn-primary btn-sm" onClick={insert}>
                Ajouter
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setAdding(null)}>
                Annuler
              </button>
            </div>
          ) : null}
          {message ? (
            <div className={`flex items-center justify-between px-3 py-1 text-xs ${message.ok ? 'text-success' : 'bg-error/10 text-error'}`}>
              <span className="break-words">{message.text}</span>
              <button className="btn-icon h-5 w-5" onClick={() => setMessage(null)}>
                <X size={11} />
              </button>
            </div>
          ) : null}
          {state.success === false ? (
            <div className="m-3 rounded-lg bg-error/10 p-3 font-mono text-xs text-error">{state.error}</div>
          ) : (
            <ResultGrid
              key={`${tab.id}-${page}-${appliedWhere}-${sort?.column}-${sort?.desc}`}
              columns={state.columns || []}
              rows={state.rows || []}
              columnInfo={state.columnInfo}
              sort={sort}
              onSort={(column) => setSort((s) => (s?.column === column ? (s.desc ? null : { column, desc: true }) : { column, desc: false }))}
              canEdit={canEdit}
              onEditCell={editCell}
              onDeleteRow={deleteRow}
              rowOffset={page * limit}
            />
          )}
          <div className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-xs text-text-muted">
            <span>{state.total != null ? `${state.total.toLocaleString()} ligne(s)` : ''}</span>
            <div className="ml-auto flex items-center gap-1">
              <select className="input py-0.5 text-xs" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(0); }}>
                {[50, 100, 500, 1000].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
              <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                ‹
              </button>
              <span>
                Page {page + 1}
                {totalPages ? ` / ${totalPages}` : ''}
              </span>
              <button className="btn btn-secondary btn-sm" disabled={totalPages ? page + 1 >= totalPages : (state.rows || []).length < limit} onClick={() => setPage((p) => p + 1)}>
                ›
              </button>
            </div>
          </div>
        </>
      ) : null}

      {view === 'structure' ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-text-muted">
              <tr>
                <th className="py-1">Colonne</th>
                <th>Type</th>
                <th>Nullable</th>
                <th>Défaut</th>
                <th>Clé</th>
              </tr>
            </thead>
            <tbody>
              {(state.columnInfo || []).map((c) => (
                <tr key={c.name} className="border-t border-border">
                  <td className="py-1.5 font-mono">{c.name}</td>
                  <td className="font-mono text-xs text-text-secondary">{c.type}</td>
                  <td>{c.nullable ? 'oui' : 'non'}</td>
                  <td className="font-mono text-xs text-text-muted">{c.default ?? ''}</td>
                  <td>{c.pk ? 'PRIMARY' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {view === 'analyse' ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="mb-3 flex items-center gap-2">
            <p className="text-sm text-text-muted">Profil de chaque colonne : remplissage, valeurs distinctes, bornes et valeurs les plus fréquentes.</p>
            <button className="btn btn-secondary btn-sm ml-auto flex items-center gap-1" onClick={analyze}>
              <RefreshCw size={13} /> Relancer
            </button>
          </div>
          {stats?.loading ? (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <Loader2 size={14} className="animate-spin" /> Analyse en cours…
            </div>
          ) : stats?.error ? (
            <div className="text-sm text-error">{stats.error}</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {(stats?.columns || []).map((c) => {
                const fill = c.total ? Math.round((c.filled / c.total) * 100) : 0;
                return (
                  <div key={c.name} className="rounded-lg border border-border bg-bg-secondary p-3">
                    <div className="mb-2 flex items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold">{c.name}</span>
                      <span className="text-xs text-text-muted">{c.type}</span>
                      {c.pk ? <span className="ml-auto text-[10px] text-yellow-500">CLÉ</span> : null}
                    </div>
                    {c.error ? (
                      <div className="text-xs text-error">{c.error}</div>
                    ) : (
                      <>
                        <div className="mb-1 flex justify-between text-xs">
                          <span>Remplie</span>
                          <span>
                            {fill}% ({(c.filled ?? 0).toLocaleString()} / {(c.total ?? 0).toLocaleString()})
                          </span>
                        </div>
                        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-bg-hover">
                          <div className="h-full rounded-full bg-accent-primary" style={{ width: `${fill}%` }} />
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-xs">
                          <span className="text-text-muted">Distinctes</span>
                          <span className="text-right">{(c.distinct ?? 0).toLocaleString()}</span>
                          <span className="text-text-muted">Min</span>
                          <span className="truncate text-right font-mono">{String(c.min ?? '—')}</span>
                          <span className="text-text-muted">Max</span>
                          <span className="truncate text-right font-mono">{String(c.max ?? '—')}</span>
                        </div>
                        {c.total > 0 && c.distinct === c.filled && c.filled === c.total ? (
                          <div className="mt-2 border-t border-border pt-2 text-[11px] text-text-muted">Valeurs toutes uniques</div>
                        ) : c.top?.length ? (
                          <div className="mt-2 border-t border-border pt-2">
                            {c.top.map((tv, i) => (
                              <div key={i} className="flex justify-between gap-2 font-mono text-[11px]">
                                <span className="truncate">{tv.value === null ? 'NULL' : String(tv.value)}</span>
                                <span className="text-text-muted">{tv.n.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function DatabaseApp({ onClose }) {
  const [connections, setConnections] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [tables, setTables] = useState({});
  const [loadingTables, setLoadingTables] = useState({});
  const [errors, setErrors] = useState({});
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(null); // null | {} | connexion
  const [tabs, setTabs] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const forgetConnection = useDbUiStore((s) => s.forgetConnection);

  const refreshList = useCallback(async () => {
    const res = await api()?.list();
    if (res?.success) {
      setConnections(res.connections);
      // Historique des connexions disparues (jetables d'une session passée).
      const ids = new Set(res.connections.map((c) => c.id));
      const st = useDbUiStore.getState();
      for (const id of Object.keys(st.history)) if (!ids.has(id)) st.forgetConnection(id);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(refreshList, 0);
    return () => clearTimeout(t);
  }, [refreshList]);

  const loadTables = useCallback(
    async (id) => {
      setLoadingTables((l) => ({ ...l, [id]: true }));
      setErrors((e) => ({ ...e, [id]: null }));
      const res = await api()?.tables(id);
      setLoadingTables((l) => ({ ...l, [id]: false }));
      if (res?.success) setTables((t) => ({ ...t, [id]: res.tables }));
      else setErrors((e) => ({ ...e, [id]: res?.error || 'Connexion impossible' }));
      refreshList();
      return res?.success;
    },
    [refreshList]
  );

  const conn = connections.find((c) => c.id === activeId);


  const openQuery = (connId, patch = {}) => {
    const id = newTabId();
    setTabs((list) => [...list, { id, type: 'query', connId, title: 'Requête', sql: '', ...patch }]);
    setActiveTab(id);
  };

  // Un seul diagramme par connexion : le rouvrir ramène à l'onglet existant.
  const openDiagram = (connId) => {
    const existing = tabs.find((x) => x.type === 'diagram' && x.connId === connId);
    if (existing) {
      setActiveTab(existing.id);
      return;
    }
    const id = newTabId();
    setTabs((list) => [...list, { id, type: 'diagram', connId, title: 'Diagramme' }]);
    setActiveTab(id);
  };

  // Script .sql ouvert depuis le système : il attend qu'on choisisse sur
  // quelle connexion l'exécuter (un script ne dit pas à quelle base il parle).
  const [pendingScript, setPendingScript] = useState(null); // { sql, path, name }

  const select = async (c) => {
    setActiveId(c.id);
    setExpanded((x) => ({ ...x, [c.id]: true }));
    let ok = Boolean(tables[c.id]);
    if (!ok) ok = await loadTables(c.id);
    if (ok && pendingScript) {
      openQuery(c.id, { sql: pendingScript.sql, file: pendingScript.path || undefined, title: pendingScript.name || 'Script' });
      setPendingScript(null);
      return;
    }
    if (ok && !tabs.some((t) => t.connId === c.id)) openQuery(c.id);
  };

  // Fichiers confiés par le système ou la visionneuse.
  const pendingFile = useDevToolsStore((st) => st.pendingFile);
  useEffect(() => {
    if (pendingFile?.kind !== 'sql' && pendingFile?.kind !== 'sqlite') return undefined;
    const t = setTimeout(async () => {
      const file = useDevToolsStore.getState().takePendingFile(['sql', 'sqlite']);
      if (!file) return;
      if (file.kind === 'sql') {
        // Une seule connexion ouverte (ou sélectionnée) : c'est elle. Sinon on
        // demande, sans rien exécuter.
        const target = connections.find((c) => c.id === activeId) || (connections.length === 1 ? connections[0] : null);
        if (target) {
          await select(target);
          openQuery(target.id, { sql: file.text || '', file: file.path || undefined, title: file.name || 'Script' });
        } else setPendingScript({ sql: file.text || '', path: file.path, name: file.name });
        return;
      }
      // Base SQLite : connexion jetable au fichier (ou celle qui existe déjà),
      // puis le diagramme des relations, la vue d'ensemble la plus parlante.
      const list = (await api()?.list())?.connections || [];
      let conn = list.find((c) => c.driver === 'sqlite' && c.file === file.path);
      if (!conn) {
        const res = await api()?.save({ driver: 'sqlite', file: file.path, name: file.name, pinned: false });
        if (!res?.success) return;
        conn = res.connection;
      }
      await refreshList();
      await select(conn);
      openDiagram(conn.id);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFile]);

  const openTable = (connId, t) => {
    const existing = tabs.find((x) => (x.type === 'table' || x.type === 'view') && x.connId === connId && x.table === t.name && x.schema === t.schema);
    if (existing) {
      setActiveTab(existing.id);
      return;
    }
    const id = newTabId();
    setTabs((list) => [...list, { id, type: t.type === 'view' ? 'view' : 'table', connId, schema: t.schema, table: t.name, title: t.name }]);
    setActiveTab(id);
  };

  const closeTab = (id) => {
    setTabs((list) => {
      const next = list.filter((t) => t.id !== id);
      if (activeTab === id) setActiveTab(next[next.length - 1]?.id || null);
      return next;
    });
  };

  const updateTab = (id, patch) => setTabs((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const remove = async (c) => {
    if (!window.confirm(`Supprimer la connexion « ${c.name} » ?`)) return;
    await api()?.remove(c.id);
    forgetConnection(c.id);
    setTabs((list) => list.filter((t) => t.connId !== c.id));
    if (activeId === c.id) setActiveId(null);
    refreshList();
  };

  const disconnect = async (c) => {
    await api()?.disconnect(c.id);
    setTables((t) => ({ ...t, [c.id]: undefined }));
    refreshList();
  };

  const tab = tabs.find((t) => t.id === activeTab);
  const tabConn = tab ? connections.find((c) => c.id === tab.connId) : null;

  return (
    <div className="relative flex h-full min-h-0">
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-border bg-bg-secondary">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Database size={16} className="text-accent-primary" />
          <span className="flex-1 text-sm font-semibold">Bases de données</span>
          <button className="btn-icon h-7 w-7" onClick={() => setForm({})} title="Nouvelle connexion">
            <Plus size={15} />
          </button>
          <button className="btn-icon h-7 w-7" onClick={onClose} title="Fermer (Échap)">
            <X size={15} />
          </button>
        </div>
        <div className="px-2 py-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-primary px-2">
            <Search size={12} className="text-text-muted" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrer les tables" className="min-w-0 flex-1 bg-transparent py-1 text-xs outline-none" />
          </div>
        </div>
        {pendingScript ? (
          <div className="mx-2 mb-2 rounded-lg border border-accent-primary/40 bg-accent-primary/10 px-2.5 py-2 text-[11px] text-text-secondary">
            <div className="font-medium text-text-primary">« {pendingScript.name || 'Script SQL'} »</div>
            Choisissez la connexion sur laquelle l’ouvrir (rien n’est exécuté sans vous).
            <button className="mt-1 block text-text-muted hover:text-error" onClick={() => setPendingScript(null)}>
              Annuler
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 space-y-0.5 overflow-auto px-1.5 pb-2">
          {connections.length === 0 ? <p className="px-2 text-xs text-text-muted">Aucune connexion. Cliquez sur + pour en créer une.</p> : null}
          {connections.map((c) => (
            <div key={c.id}>
              <ConnectionItem
                conn={c}
                active={c.id === activeId}
                expanded={Boolean(expanded[c.id])}
                tables={tables[c.id]}
                loading={loadingTables[c.id]}
                filter={filter}
                onSelect={() => select(c)}
                onToggle={() => {
                  const next = !expanded[c.id];
                  setExpanded((x) => ({ ...x, [c.id]: next }));
                  if (next && !tables[c.id]) loadTables(c.id);
                }}
                onOpenTable={(t) => {
                  setActiveId(c.id);
                  openTable(c.id, t);
                }}
                onEdit={() => setForm(c)}
                onRemove={() => remove(c)}
                onDisconnect={() => disconnect(c)}
                onRefresh={() => loadTables(c.id)}
              />
              {errors[c.id] ? <div className="mx-2 mb-1 break-words rounded bg-error/10 px-2 py-1 text-[11px] text-error">{errors[c.id]}</div> : null}
            </div>
          ))}
        </div>
        {conn ? (
          <div className="space-y-1.5 border-t border-border p-2">
            <button className="btn btn-primary btn-sm flex w-full items-center justify-center gap-1.5" onClick={() => openDiagram(conn.id)}>
              <Network size={13} /> Diagramme des relations
            </button>
            <button className="btn btn-secondary btn-sm flex w-full items-center justify-center gap-1.5" onClick={() => openQuery(conn.id)}>
              <FileCode2 size={13} /> Nouvelle requête
            </button>
          </div>
        ) : null}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {tabs.length ? (
          <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border bg-bg-secondary px-1 pt-1">
            {tabs.map((t) => {
              const c = connections.find((x) => x.id === t.connId);
              return (
                <div
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`group flex max-w-[14rem] flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-xs ${t.id === activeTab ? 'bg-bg-primary font-medium' : 'text-text-muted hover:bg-bg-hover'}`}
                  title={`${c?.name || ''} — ${t.file || t.title}`}
                >
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: DRIVER_INFO[c?.driver]?.color }} />
                  {t.type === 'query' ? <FileCode2 size={12} /> : t.type === 'diagram' ? <Network size={12} /> : t.type === 'view' ? <Eye size={12} /> : <Table2 size={12} />}
                  <span className="truncate">{t.title}</span>
                  <button
                    className="btn-icon h-4 w-4 opacity-60 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}
            {conn ? (
              <button className="btn-icon ml-1 h-6 w-6 flex-shrink-0" onClick={() => openQuery(conn.id)} title="Nouvelle requête">
                <Plus size={13} />
              </button>
            ) : null}
          </div>
        ) : null}

        {tab && tabConn ? (
          tab.type === 'query' ? (
            <QueryTab key={tab.id} tab={tab} conn={tabConn} onChange={(patch) => updateTab(tab.id, patch)} />
          ) : tab.type === 'diagram' ? (
            <SchemaDiagram
              key={tab.id}
              conn={tabConn}
              onOpenTable={(t) => openTable(tabConn.id, t)}
              onQuery={(sql) => openQuery(tabConn.id, { sql: `${sql}\n` })}
            />
          ) : (
            <TableTab key={tab.id} tab={tab} conn={tabConn} />
          )
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <Database size={40} className="text-accent-primary" />
            <div>
              <h2 className="text-lg font-semibold">Consultez, analysez et modifiez vos bases</h2>
              <p className="mt-1 max-w-md text-sm text-text-muted">
                SQLite, MySQL / MariaDB, PostgreSQL et SQL Server. Épinglez une connexion pour la retrouver, ou utilisez-la en jetable : elle sera oubliée à la fermeture.
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm flex items-center gap-1.5" onClick={() => setForm({})}>
                <Plug size={14} /> Nouvelle connexion
              </button>
              {conn ? (
                <>
                  <button className="btn btn-secondary btn-sm flex items-center gap-1.5" onClick={() => openDiagram(conn.id)}>
                    <Network size={14} /> Diagramme des relations
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => openQuery(conn.id)}>
                    Ouvrir un éditeur SQL
                  </button>
                </>
              ) : null}
            </div>
          </div>
        )}
      </section>

      {form ? (
        <ConnectionForm
          initial={form.id ? form : null}
          onClose={() => setForm(null)}
          onSaved={async (c) => {
            setForm(null);
            setTables((t) => ({ ...t, [c.id]: undefined }));
            await refreshList();
            select(c);
          }}
        />
      ) : null}
    </div>
  );
}
