import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardCopy,
  Code2,
  FileJson,
  Filter,
  ListTree,
  Pencil,
  Play,
  Plus,
  Redo2,
  Save,
  Search,
  Sigma,
  SortAsc,
  Table2,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import JsonChart, { formatNumber } from './JsonChart';
import {
  addChild,
  aggregateRecords,
  analyzeRecords,
  ancestorKeys,
  containerPaths,
  deleteAt,
  findRecordArrays,
  flattenVisible,
  getAt,
  inferSchema,
  isContainer,
  jsonStats,
  parseEditedValue,
  parseJsonDocument,
  pathKey,
  pathToJs,
  pathToJsonPath,
  preview,
  queryJson,
  recordColumns,
  recordsToCsv,
  renameKey,
  searchJson,
  setAt,
  sortKeysDeep,
  typeOf,
} from '../../lib/jsonTools';

// ---------------------------------------------------------------------------
// Explorateur JSON de la visionneuse.
//
//   Arbre     : nœuds dépliables (virtualisés), recherche avec navigation,
//               inspecteur (chemins JSONPath / JS, valeur, actions), édition
//               (valeur, clé, suppression, ajout), annuler / rétablir ;
//   Requête   : JSONPath ($.users[?(@.age > 30)].name), sans eval ;
//   Tableau   : un tableau d'objets en grille (tri, filtre, export CSV) ;
//   Analyse   : structure du document, profil de chaque champ ;
//   Graphique : répartition ou mesure agrégée d'un champ ;
//   Schéma    : JSON Schema déduit ;
//   Texte     : source éditable (formater, minifier, trier les clés).
// Enregistrement : dans le fichier ouvert (si local) ou sous un autre nom.
// ---------------------------------------------------------------------------
const ROW_H = 24;
const TYPE_COLORS = {
  string: 'text-emerald-500',
  number: 'text-sky-500',
  boolean: 'text-violet-500',
  null: 'text-text-muted italic',
  object: 'text-text-muted',
  array: 'text-text-muted',
};

const copyText = (s) => navigator.clipboard?.writeText(String(s ?? '')).catch(() => {});
function indentOf(text) {
  const m = /\n([ \t]+)["{[\]}]/.exec(String(text || ''));
  if (!m) return 2;
  return m[1].includes('\t') ? '\t' : Math.min(8, m[1].length);
}

// --- Arbre ----------------------------------------------------------------------
function TreeRow({ row, selected, hit, current, editMode, onToggle, onSelect, onEditValue, onRename, onDelete, onAdd, onMore }) {
  const [editing, setEditing] = useState(null); // 'value' | 'key'
  const [draft, setDraft] = useState('');
  if (row.type === 'more') {
    return (
      <div className="flex items-center text-xs" style={{ height: ROW_H, paddingLeft: row.depth * 16 + 26 }}>
        <button className="text-accent-primary hover:underline" onClick={() => onMore(row)}>
          … {row.more.toLocaleString('fr-FR')} élément(s) de plus — afficher
        </button>
      </div>
    );
  }
  const isArrayItem = typeof row.key === 'number';
  const commit = () => {
    const kind = editing;
    setEditing(null);
    if (kind === 'value') onEditValue(row.path, draft);
    if (kind === 'key' && draft && draft !== row.key) onRename(row.path, draft);
  };
  const input = (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(null);
      }}
      onClick={(e) => e.stopPropagation()}
      className="input min-w-[8rem] px-1 py-0 font-mono text-xs"
    />
  );
  return (
    <div
      className={`group flex items-center gap-1 whitespace-nowrap pr-2 font-mono text-[12.5px] ${selected ? 'bg-accent-primary/15' : current ? 'bg-amber-500/20' : hit ? 'bg-amber-500/8' : 'hover:bg-bg-hover'}`}
      style={{ height: ROW_H, paddingLeft: row.depth * 16 + 6 }}
      onClick={() => onSelect(row.path)}
    >
      {row.container && row.depth > 0 ? (
        <button
          className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-text-muted"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(row);
          }}
        >
          {row.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      ) : (
        <span className="w-4 flex-shrink-0" />
      )}
      {row.depth === 0 ? (
        <span className="text-text-muted">racine</span>
      ) : editing === 'key' ? (
        input
      ) : (
        <span
          className={isArrayItem ? 'text-text-muted' : 'text-accent-primary'}
          onDoubleClick={(e) => {
            if (!editMode || isArrayItem) return;
            e.stopPropagation();
            setDraft(String(row.key));
            setEditing('key');
          }}
        >
          {isArrayItem ? row.key : `"${row.key}"`}
        </span>
      )}
      <span className="text-text-muted">:</span>
      {editing === 'value' ? (
        input
      ) : row.container ? (
        <span className="text-text-muted">
          {row.type === 'array' ? '[' : '{'}
          {!row.open ? <span className="mx-1 rounded bg-bg-hover px-1 text-[10.5px]">{row.size} {row.type === 'array' ? 'élément(s)' : 'clé(s)'}</span> : null}
          {!row.open ? (row.type === 'array' ? ']' : '}') : null}
        </span>
      ) : (
        <span
          className={`min-w-0 truncate ${TYPE_COLORS[row.type]}`}
          title={typeof row.value === 'string' && row.value.length > 80 ? row.value.slice(0, 1000) : undefined}
          onDoubleClick={(e) => {
            if (!editMode) return;
            e.stopPropagation();
            setDraft(typeof row.value === 'string' ? row.value : JSON.stringify(row.value));
            setEditing('value');
          }}
        >
          {preview(row.value, 140)}
        </span>
      )}
      {editMode && row.depth > 0 ? (
        <span className="ml-auto hidden flex-shrink-0 gap-0.5 pl-2 group-hover:flex">
          {row.container ? (
            <button className="btn-icon h-5 w-5" title="Ajouter un enfant" onClick={(e) => (e.stopPropagation(), onAdd(row))}>
              <Plus size={11} />
            </button>
          ) : null}
          <button className="btn-icon h-5 w-5 hover:text-error" title="Supprimer" onClick={(e) => (e.stopPropagation(), onDelete(row.path))}>
            <Trash2 size={11} />
          </button>
        </span>
      ) : null}
    </div>
  );
}

function VirtualTree({ rows, scrollTo, ...rowProps }) {
  const box = useRef(null);
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setScroll((s) => ({ ...s, height: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (scrollTo == null || !box.current) return;
    const idx = rows.findIndex((r) => r.id === scrollTo);
    if (idx < 0) return;
    const el = box.current;
    const top = idx * ROW_H;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - ROW_H * 2) el.scrollTop = Math.max(0, top - el.clientHeight / 3);
  }, [scrollTo, rows]);
  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - 10);
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / ROW_H) + 10);
  return (
    <div ref={box} className="min-h-0 flex-1 overflow-auto" onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
      <div style={{ height: rows.length * ROW_H, position: 'relative', minWidth: 'max-content' }}>
        <div style={{ transform: `translateY(${first * ROW_H}px)` }}>
          {rows.slice(first, last).map((row) => (
            <TreeRow
              key={row.id}
              row={row}
              selected={rowProps.selectedId === row.id}
              hit={rowProps.hits.has(row.id)}
              current={rowProps.currentHit === row.id}
              {...rowProps}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Inspecteur ------------------------------------------------------------------
function Inspector({ data, path, onShowTable, onQuery }) {
  const value = getAt(data, path);
  const t = typeOf(value);
  const isRecords = Array.isArray(value) && value.some((x) => isContainer(x) && !Array.isArray(x));
  const text = useMemo(() => {
    const s = isContainer(value) ? JSON.stringify(value, null, 2) : JSON.stringify(value);
    return s && s.length > 20000 ? `${s.slice(0, 20000)}\n…` : s;
  }, [value]);
  const rows = [
    ['JSONPath', pathToJsonPath(path)],
    ['JavaScript', pathToJs(path)],
  ];
  return (
    <aside className="flex w-80 flex-shrink-0 flex-col border-l border-border bg-bg-secondary">
      <div className="border-b border-border p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-bg-hover px-1.5 py-0.5 font-mono text-[11px]">{t}</span>
          {isContainer(value) ? (
            <span className="text-xs text-text-muted">
              {Array.isArray(value) ? `${value.length} élément(s)` : `${Object.keys(value).length} clé(s)`}
            </span>
          ) : null}
        </div>
        {rows.map(([label, v]) => (
          <div key={label} className="mb-1 flex items-center gap-1.5">
            <span className="w-[4.6rem] flex-shrink-0 text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
            <code className="min-w-0 flex-1 truncate text-[11.5px] select-text" title={v}>
              {v}
            </code>
            <button className="btn-icon h-5 w-5" title="Copier" onClick={() => copyText(v)}>
              <ClipboardCopy size={11} />
            </button>
          </div>
        ))}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button className="btn btn-secondary btn-sm" onClick={() => copyText(isContainer(value) ? JSON.stringify(value, null, 2) : String(value))}>
            <ClipboardCopy size={12} /> Valeur
          </button>
          {isRecords ? (
            <button className="btn btn-secondary btn-sm" onClick={() => onShowTable(path)}>
              <Table2 size={12} /> Tableau
            </button>
          ) : null}
          {isContainer(value) ? (
            <button className="btn btn-secondary btn-sm" onClick={() => onQuery(`${pathToJsonPath(path)}${Array.isArray(value) ? '[*]' : '.*'}`)}>
              <Filter size={12} /> Requête
            </button>
          ) : null}
        </div>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-[11.5px] text-text-secondary select-text">{text}</pre>
    </aside>
  );
}

// --- Tableau -----------------------------------------------------------------------
function RecordsTable({ records, onSelectRow }) {
  const [sort, setSort] = useState(null);
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(300);
  const columns = useMemo(() => recordColumns(records), [records]);
  const rows = useMemo(() => {
    let list = records.map((r, i) => ({ r, i }));
    const q = filter.trim().toLowerCase();
    if (q) list = list.filter(({ r }) => JSON.stringify(r).toLowerCase().includes(q));
    if (sort) {
      const col = columns.find((c) => c.name === sort.col);
      list.sort((a, b) => {
        const va = getAt(a.r, col.path);
        const vb = getAt(b.r, col.path);
        if (va === vb) return 0;
        if (va === undefined || va === null) return 1;
        if (vb === undefined || vb === null) return -1;
        const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr', { numeric: true });
        return sort.desc ? -c : c;
      });
    }
    return list;
  }, [records, filter, sort, columns]);
  const cell = (v) => {
    if (v === undefined) return <span className="text-text-muted/50">—</span>;
    if (v === null) return <span className="italic text-text-muted">null</span>;
    if (isContainer(v)) return <span className="text-text-muted">{preview(v)}</span>;
    if (typeof v === 'boolean') return <span className="text-violet-500">{String(v)}</span>;
    if (typeof v === 'number') return <span className="tabular-nums">{v}</span>;
    return String(v);
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border bg-bg-primary px-2">
          <Search size={12} className="text-text-muted" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrer les lignes…" className="min-w-0 flex-1 bg-transparent py-1 text-xs outline-none" />
        </div>
        <span className="text-xs text-text-muted">
          {rows.length.toLocaleString('fr-FR')} / {records.length.toLocaleString('fr-FR')} lignes · {columns.length} colonnes
        </span>
        <button className="btn btn-secondary btn-sm" onClick={() => window.electronAPI?.devFiles?.save({ defaultPath: 'donnees.csv', content: recordsToCsv(rows.map((x) => x.r), columns) })}>
          CSV
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => copyText(JSON.stringify(rows.map((x) => x.r), null, 2))}>
          Copier JSON
        </button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-10 bg-bg-secondary">
            <tr>
              <th className="sticky left-0 border-b border-r border-border bg-bg-secondary px-2 py-1.5 text-right text-text-muted">#</th>
              {columns.map((c) => (
                <th
                  key={c.name}
                  onClick={() => setSort((s) => (s?.col === c.name ? (s.desc ? null : { col: c.name, desc: true }) : { col: c.name, desc: false }))}
                  className="cursor-pointer whitespace-nowrap border-b border-r border-border px-2 py-1.5 text-left font-semibold hover:bg-bg-hover"
                >
                  {c.name} {sort?.col === c.name ? (sort.desc ? '↓' : '↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map(({ r, i }) => (
              <tr key={i} className="hover:bg-bg-hover/60" onClick={() => onSelectRow?.(i)}>
                <td className="sticky left-0 border-b border-r border-border bg-bg-primary px-2 py-1 text-right text-text-muted">{i}</td>
                {columns.map((c) => {
                  const v = getAt(r, c.path);
                  return (
                    <td
                      key={c.name}
                      // Valeur complète au survol : la cellule est tronquée.
                      title={v === undefined ? undefined : isContainer(v) ? preview(v, 400) : String(v)}
                      className={`max-w-[22rem] truncate border-b border-r border-border px-2 py-1 ${typeof v === 'number' ? 'text-right' : ''}`}
                    >
                      {cell(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > shown ? (
          <button className="btn btn-secondary btn-sm m-2" onClick={() => setShown((n) => n + 500)}>
            Afficher 500 lignes de plus ({(rows.length - shown).toLocaleString('fr-FR')} restantes)
          </button>
        ) : null}
      </div>
    </div>
  );
}

// --- Analyse -------------------------------------------------------------------------
function Analysis({ data, records, recordsLabel }) {
  const stats = useMemo(() => jsonStats(data), [data]);
  const analysis = useMemo(() => (records ? analyzeRecords(records) : null), [records]);
  const cards = [
    ['Nœuds', stats.nodes],
    ['Profondeur', stats.depth],
    ['Objets', stats.objects],
    ['Tableaux', stats.arrays],
    ['Textes', stats.strings],
    ['Nombres', stats.numbers],
    ['Booléens', stats.booleans],
    ['null', stats.nulls],
  ];
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mb-5 grid grid-cols-4 gap-2 xl:grid-cols-8">
        {cards.map(([label, v]) => (
          <div key={label} className="rounded-lg border border-border bg-bg-elevated px-3 py-2">
            <div className="text-[11px] text-text-muted">{label}</div>
            <div className="text-lg font-semibold tabular-nums text-text-primary">{v.toLocaleString('fr-FR')}</div>
          </div>
        ))}
      </div>
      {analysis ? (
        <>
          <h3 className="mb-2 text-sm font-semibold text-text-primary">
            Champs de {recordsLabel} <span className="font-normal text-text-muted">— {analysis.count.toLocaleString('fr-FR')} objets</span>
          </h3>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {analysis.fields.map((f) => {
              const fill = f.total ? Math.round((f.filled / f.total) * 100) : 0;
              const topMax = f.top[0]?.[1] || 1;
              return (
                <div key={f.name} className="rounded-lg border border-border bg-bg-secondary p-3">
                  <div className="mb-2 flex items-baseline gap-2">
                    <span className="font-mono text-sm font-semibold text-text-primary">{f.name}</span>
                    <span className="text-[11px] text-text-muted">{Object.entries(f.types).map(([t, n]) => (Object.keys(f.types).length > 1 ? `${t} ${n}` : t)).join(' · ')}</span>
                  </div>
                  <div className="mb-1 flex justify-between text-xs text-text-secondary">
                    <span>Rempli</span>
                    <span className="tabular-nums">
                      {fill} % ({f.filled.toLocaleString('fr-FR')} / {f.total.toLocaleString('fr-FR')})
                    </span>
                  </div>
                  <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-bg-hover">
                    <div className="h-full rounded-full bg-accent-primary" style={{ width: `${fill}%` }} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                    <span className="text-text-muted">Valeurs distinctes</span>
                    <span className="text-right tabular-nums">{f.distinct.toLocaleString('fr-FR')}</span>
                    {f.numeric ? (
                      <>
                        <span className="text-text-muted">Min / Max</span>
                        <span className="text-right tabular-nums">
                          {formatNumber(f.min)} / {formatNumber(f.max)}
                        </span>
                        <span className="text-text-muted">Moyenne</span>
                        <span className="text-right tabular-nums">{formatNumber(f.avg)}</span>
                      </>
                    ) : null}
                  </div>
                  {f.distinct < f.filled && f.top.length ? (
                    <div className="mt-2 space-y-1 border-t border-border pt-2">
                      {f.top.slice(0, 5).map(([v, n]) => (
                        <div key={v} className="flex items-center gap-2 text-[11px]">
                          <span className="w-28 truncate font-mono" title={v}>
                            {v}
                          </span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-hover">
                            <span className="block h-full rounded-full bg-accent-primary/70" style={{ width: `${(n / topMax) * 100}%` }} />
                          </span>
                          <span className="w-10 text-right tabular-nums text-text-muted">{n}</span>
                        </div>
                      ))}
                    </div>
                  ) : f.distinct === f.filled && f.filled > 1 ? (
                    <div className="mt-2 border-t border-border pt-2 text-[11px] text-text-muted">Valeurs toutes différentes</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="text-sm text-text-muted">Aucun tableau d’objets dans ce document : l’analyse par champ s’applique aux listes d’objets (ex. une liste d’utilisateurs).</p>
      )}
    </div>
  );
}

// --- Graphique ---------------------------------------------------------------------
function ChartView({ records, recordsLabel }) {
  const analysis = useMemo(() => analyzeRecords(records), [records]);
  const fields = analysis.fields.filter((f) => !Object.keys(f.types).every((t) => t === 'object' || t === 'array'));
  const categories = fields.filter((f) => f.distinct <= Math.max(60, records.length * 0.5) || f.numeric);
  const numeric = fields.filter((f) => f.numeric);
  // Regroupement par défaut : le champ catégoriel le plus « lisible » (le
  // moins de valeurs distinctes au-delà d'une seule) — ville, statut, produit
  // plutôt qu'un identifiant.
  const [x, setX] = useState(
    () =>
      ([...categories].filter((f) => f.types.string && !f.numeric && f.distinct > 1 && f.distinct <= 30).sort((a, b) => a.distinct - b.distinct)[0] ||
        [...categories].filter((f) => !f.numeric && f.distinct > 1).sort((a, b) => a.distinct - b.distinct)[0] ||
        categories[0])?.name || ''
  );
  const [y, setY] = useState('');
  const [agg, setAgg] = useState('count');
  const [kind, setKind] = useState('bar');
  const xField = fields.find((f) => f.name === x);
  const yField = fields.find((f) => f.name === y);
  // Calcul direct (un passage sur la liste) : le compilateur React mémorise
  // déjà ce composant.
  const { points, truncated } = aggregateRecords(records, { x: xField?.path, y: yField?.path, agg: yField ? agg : 'count', limit: 30 });
  const measure = yField ? `${{ sum: 'Somme', avg: 'Moyenne', min: 'Minimum', max: 'Maximum', count: 'Nombre' }[agg]} de ${yField.name}` : 'Nombre d’éléments';
  const title = `${measure}${xField ? ` par ${xField.name}` : ''}`;
  const select = 'input py-1 text-xs';
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mb-4 flex flex-wrap items-end gap-3 text-xs">
        <label className="space-y-1">
          <span className="block text-text-muted">Regrouper par</span>
          <select className={select} value={x} onChange={(e) => setX(e.target.value)}>
            <option value="">(position)</option>
            {categories.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-text-muted">Mesure</span>
          <select
            className={select}
            value={y}
            onChange={(e) => {
              // Choisir une mesure, c'est vouloir l'additionner (ou la moyenner) :
              // « Nombre » n'aurait pas de sens par défaut.
              if (e.target.value && agg === 'count') setAgg('sum');
              setY(e.target.value);
            }}
          >
            <option value="">Nombre d’éléments</option>
            {numeric.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        {yField ? (
          <label className="space-y-1">
            <span className="block text-text-muted">Calcul</span>
            <select className={select} value={agg} onChange={(e) => setAgg(e.target.value)}>
              <option value="sum">Somme</option>
              <option value="avg">Moyenne</option>
              <option value="min">Minimum</option>
              <option value="max">Maximum</option>
              <option value="count">Nombre</option>
            </select>
          </label>
        ) : null}
        <div className="flex overflow-hidden rounded-lg border border-border">
          {[
            ['bar', 'Barres'],
            ['line', 'Courbe'],
          ].map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)} className={`px-3 py-1 ${kind === k ? 'bg-accent-primary/15 text-accent-primary' : 'text-text-muted hover:bg-bg-hover'}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-text-muted">{recordsLabel}</span>
      </div>
      {points.length ? (
        <div className="rounded-xl border border-border bg-bg-elevated p-4">
          <JsonChart points={points} kind={kind} title={title} />
          {truncated ? <p className="mt-2 text-[11px] text-text-muted">Les catégories les moins fréquentes sont regroupées dans « Autres ».</p> : null}
        </div>
      ) : (
        <p className="text-sm text-text-muted">Rien à tracer avec ces choix.</p>
      )}
    </div>
  );
}

// --- Explorateur ------------------------------------------------------------------
const TABS = [
  ['tree', 'Arbre', ListTree],
  ['table', 'Tableau', Table2],
  ['analysis', 'Analyse', Sigma],
  ['chart', 'Graphique', BarChart3],
  ['schema', 'Schéma', Braces],
  ['text', 'Texte', Code2],
];

export default function JsonExplorer({ text, doc, wrap }) {
  const initial = useMemo(() => parseJsonDocument(text), [text]);
  const [data, setData] = useState(initial.ok ? initial.value : undefined);
  const [history, setHistory] = useState({ past: [], future: [] });
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState(initial.ok ? 'tree' : 'text');
  const [expanded, setExpanded] = useState(() => new Set(initial.ok ? containerPaths(initial.value, 1) : []));
  const [showMore, setShowMore] = useState({});
  const [selected, setSelected] = useState([]);
  const [scrollTo, setScrollTo] = useState(null);
  const [search, setSearch] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState(null); // { items, error }
  const [editMode, setEditMode] = useState(false);
  const [recordPath, setRecordPath] = useState(null);
  const [message, setMessage] = useState(null);
  const [draft, setDraft] = useState(text);
  const [draftError, setDraftError] = useState(initial.ok ? null : initial);
  const indent = useMemo(() => indentOf(text), [text]);
  const format = initial.ok ? initial.format : 'json';

  // Nouveau document : tout repart de zéro.
  useEffect(() => {
    const t = setTimeout(() => {
      setData(initial.ok ? initial.value : undefined);
      setDraft(text);
      setDraftError(initial.ok ? null : initial);
      setDirty(false);
      setHistory({ past: [], future: [] });
      setTab(initial.ok ? 'tree' : 'text');
    }, 0);
    return () => clearTimeout(t);
  }, [initial, text]);

  const flash = (ok, text_) => {
    setMessage({ ok, text: text_ });
    setTimeout(() => setMessage(null), 2500);
  };

  const commit = useCallback(
    (next) => {
      setHistory((h) => ({ past: [...h.past.slice(-49), data], future: [] }));
      setData(next);
      setDirty(true);
    },
    [data]
  );
  const undo = () =>
    setHistory((h) => {
      if (!h.past.length) return h;
      setData(h.past[h.past.length - 1]);
      setDirty(true);
      return { past: h.past.slice(0, -1), future: [data, ...h.future] };
    });
  const redo = () =>
    setHistory((h) => {
      if (!h.future.length) return h;
      setData(h.future[0]);
      setDirty(true);
      return { past: [...h.past, data], future: h.future.slice(1) };
    });

  const serialize = useCallback(
    (v = data) => (format === 'jsonl' && Array.isArray(v) ? v.map((x) => JSON.stringify(x)).join('\n') + '\n' : `${JSON.stringify(v, null, indent)}\n`),
    [data, format, indent]
  );

  const save = async (asNew = false) => {
    // Depuis l'onglet Texte, c'est le texte saisi qu'on enregistre : il doit
    // d'abord être du JSON valide.
    let value = data;
    if (tab === 'text') {
      const r = parseJsonDocument(draft);
      if (!r.ok) {
        setDraftError(r);
        flash(false, 'Le texte contient une erreur : corrigez-la avant d’enregistrer');
        return;
      }
      value = r.value;
      setData(value);
    }
    const content = serialize(value);
    if (!asNew && doc.filePath) {
      const r = await window.electronAPI?.documents?.write({ path: doc.filePath, text: content });
      if (r?.ok) {
        setDirty(false);
        flash(true, 'Enregistré');
      } else flash(false, r?.detail || r?.reason || 'Échec de l’enregistrement');
      return;
    }
    const r = await window.electronAPI?.devFiles?.save({ defaultPath: doc.name || 'donnees.json', content, filters: [{ name: 'JSON', extensions: ['json', 'jsonl'] }] });
    if (r?.success) {
      setDirty(false);
      flash(true, `Enregistré : ${r.name}`);
    }
  };

  // --- Arbre ---
  const rows = useMemo(() => (data === undefined ? [] : flattenVisible(data, expanded, { showMore })), [data, expanded, showMore]);
  const hits = useMemo(() => (search.trim() && data !== undefined ? searchJson(data, search.trim()) : []), [data, search]);
  const hitKeys = useMemo(() => new Set(hits.map((h) => pathKey(h.path))), [hits]);
  const currentHit = hits.length ? pathKey(hits[Math.min(hitIndex, hits.length - 1)].path) : null;

  const reveal = useCallback((path) => {
    setExpanded((s) => {
      const next = new Set(s);
      for (const k of ancestorKeys(path)) next.add(k);
      return next;
    });
    setSelected(path);
    setScrollTo(pathKey(path));
    setTab('tree');
  }, []);

  const goHit = (delta) => {
    if (!hits.length) return;
    const i = (hitIndex + delta + hits.length) % hits.length;
    setHitIndex(i);
    reveal(hits[i].path);
  };

  const runQuery = (expr = query) => {
    if (!expr.trim()) {
      setQueryResult(null);
      return;
    }
    try {
      const items = queryJson(data, expr.trim());
      setQueryResult({ items, error: null });
    } catch (err) {
      setQueryResult({ items: [], error: err.message });
    }
  };

  const toggle = (row) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });

  const editValue = (path, raw) => {
    const old = getAt(data, path);
    const next = typeof old === 'string' ? raw : parseEditedValue(raw);
    if (JSON.stringify(next) !== JSON.stringify(old)) commit(setAt(data, path, next));
  };
  const rename = (path, key) => {
    try {
      commit(renameKey(data, path, key));
      setSelected([...path.slice(0, -1), key]);
    } catch (err) {
      flash(false, err.message);
    }
  };
  const remove = (path) => {
    commit(deleteAt(data, path));
    setSelected(path.slice(0, -1));
  };
  const add = (row) => {
    // Nouvelle clé au nom libre (« nouvelle_cle », « nouvelle_cle_2 »…) : on la
    // renomme ensuite d'un double-clic, comme le reste.
    let key = null;
    if (!Array.isArray(row.value)) {
      key = 'nouvelle_cle';
      for (let n = 2; Object.prototype.hasOwnProperty.call(row.value, key); n += 1) key = `nouvelle_cle_${n}`;
    }
    try {
      commit(addChild(data, row.path, key, ''));
      setExpanded((s) => new Set(s).add(row.id));
    } catch (err) {
      flash(false, err.message);
    }
  };

  // --- Tableaux d'objets ---
  const recordArrays = useMemo(() => (data === undefined ? [] : findRecordArrays(data)), [data]);
  const queryRecords = queryResult?.items?.length && queryResult.items.every((i) => isContainer(i.value) && !Array.isArray(i.value)) ? queryResult.items.map((i) => i.value) : null;
  const activeRecordPath = recordPath && Array.isArray(getAt(data, recordPath)) ? recordPath : recordArrays[0]?.path || null;
  const records = recordPath === 'query' && queryRecords ? queryRecords : activeRecordPath ? getAt(data, activeRecordPath) : null;
  const recordsLabel = recordPath === 'query' && queryRecords ? 'résultat de la requête' : activeRecordPath ? pathToJsonPath(activeRecordPath) : '';
  const recordPicker =
    recordArrays.length || queryRecords ? (
      <select
        className="input max-w-xs py-1 font-mono text-xs"
        value={recordPath === 'query' && queryRecords ? 'query' : pathKey(activeRecordPath || [])}
        onChange={(e) => setRecordPath(e.target.value === 'query' ? 'query' : JSON.parse(e.target.value))}
      >
        {queryRecords ? <option value="query">Résultat de la requête ({queryRecords.length})</option> : null}
        {recordArrays.map((a) => (
          <option key={pathKey(a.path)} value={pathKey(a.path)}>
            {pathToJsonPath(a.path)} ({a.count})
          </option>
        ))}
      </select>
    ) : null;

  const schema = useMemo(() => (tab === 'schema' && data !== undefined ? JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...inferSchema(data) }, null, 2) : ''), [tab, data]);

  // Raccourcis : Ctrl+Z / Ctrl+Maj+Z, Ctrl+S, Ctrl+F.
  const searchInput = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's' && dirty) {
        e.preventDefault();
        save(false);
      } else if (k === 'f') {
        e.preventDefault();
        searchInput.current?.focus();
      } else if (k === 'z' && tab !== 'text' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const applyDraft = (value) => {
    const r = parseJsonDocument(value);
    if (!r.ok) {
      setDraftError(r);
      return false;
    }
    setDraftError(null);
    commit(r.value);
    return true;
  };

  if (data === undefined && tab !== 'text') return null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-json-explorer>
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-elevated px-3 py-2">
        <div className="flex overflow-hidden rounded-lg border border-border">
          {TABS.map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              disabled={data === undefined && id !== 'text'}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs ${tab === id ? 'bg-accent-primary/15 font-medium text-accent-primary' : 'text-text-muted hover:bg-bg-hover disabled:opacity-40'}`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        {data !== undefined ? (
          <div className="flex min-w-[14rem] flex-1 items-center gap-1 rounded-lg border border-border bg-bg-primary px-2">
            <Search size={12} className="text-text-muted" />
            <input
              ref={searchInput}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setHitIndex(0);
              }}
              onKeyDown={(e) => e.key === 'Enter' && goHit(e.shiftKey ? -1 : 1)}
              placeholder="Rechercher clés et valeurs (Entrée : suivant)"
              className="min-w-0 flex-1 bg-transparent py-1 text-xs outline-none"
            />
            {search ? (
              <>
                <span className="text-[11px] tabular-nums text-text-muted">{hits.length ? `${Math.min(hitIndex + 1, hits.length)}/${hits.length}` : '0'}</span>
                <button className="btn-icon h-5 w-5" onClick={() => goHit(-1)} title="Précédent (Maj+Entrée)">
                  <ChevronUp size={12} />
                </button>
                <button className="btn-icon h-5 w-5" onClick={() => goHit(1)} title="Suivant (Entrée)">
                  <ChevronDown size={12} />
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {tab === 'tree' ? (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(new Set(containerPaths(data, 6)))} title="Tout déplier (6 niveaux)">
              Déplier
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(new Set())}>
              Replier
            </button>
            <button
              className={`btn btn-sm flex items-center gap-1 ${editMode ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setEditMode((v) => !v)}
              title="Double-clic sur une valeur ou une clé pour la modifier"
            >
              <Pencil size={12} /> {editMode ? 'Édition' : 'Modifier'}
            </button>
          </>
        ) : null}
        {history.past.length || history.future.length ? (
          <>
            <button className="btn-icon h-7 w-7" disabled={!history.past.length} onClick={undo} title="Annuler (Ctrl+Z)">
              <Undo2 size={14} />
            </button>
            <button className="btn-icon h-7 w-7" disabled={!history.future.length} onClick={redo} title="Rétablir (Ctrl+Maj+Z)">
              <Redo2 size={14} />
            </button>
          </>
        ) : null}
        {dirty ? (
          <>
            {doc.filePath ? (
              <button className="btn btn-primary btn-sm flex items-center gap-1" onClick={() => save(false)} title="Ctrl+S">
                <Save size={12} /> Enregistrer
              </button>
            ) : null}
            <button className="btn btn-secondary btn-sm" onClick={() => save(true)}>
              Enregistrer sous…
            </button>
          </>
        ) : null}
        {message ? (
          <span className={`flex items-center gap-1 text-xs ${message.ok ? 'text-success' : 'text-error'}`}>
            {message.ok ? <Check size={12} /> : <AlertTriangle size={12} />} {message.text}
          </span>
        ) : null}
      </div>

      {/* Requête JSONPath */}
      {data !== undefined && (tab === 'tree' || tab === 'table') ? (
        <div className="border-b border-border">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Filter size={12} className="flex-shrink-0 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runQuery()}
              placeholder="Requête JSONPath — ex. $.users[?(@.age > 30)].name   ·   $..email   ·   $.items[0:10]"
              className="min-w-0 flex-1 bg-transparent py-1 font-mono text-xs outline-none"
            />
            <button className="btn btn-secondary btn-sm flex items-center gap-1" onClick={() => runQuery()}>
              <Play size={11} /> Exécuter
            </button>
            {queryResult ? (
              <button className="btn-icon h-6 w-6" onClick={() => setQueryResult(null)} title="Fermer les résultats">
                <X size={12} />
              </button>
            ) : null}
          </div>
          {queryResult ? (
            <div className="max-h-48 overflow-auto border-t border-border bg-bg-secondary px-3 py-1.5">
              {queryResult.error ? (
                <div className="text-xs text-error">{queryResult.error}</div>
              ) : (
                <>
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-text-muted">
                    {queryResult.items.length.toLocaleString('fr-FR')} résultat(s)
                    <button className="hover:text-text-primary" onClick={() => copyText(JSON.stringify(queryResult.items.map((i) => i.value), null, 2))}>
                      Copier les valeurs
                    </button>
                    {queryRecords ? (
                      <button
                        className="text-accent-primary hover:underline"
                        onClick={() => {
                          setRecordPath('query');
                          setTab('table');
                        }}
                      >
                        Voir en tableau
                      </button>
                    ) : null}
                  </div>
                  {queryResult.items.slice(0, 200).map((it) => (
                    <button key={pathKey(it.path)} className="flex w-full gap-3 rounded px-1 py-0.5 text-left font-mono text-[11.5px] hover:bg-bg-hover" onClick={() => reveal(it.path)}>
                      <span className="w-72 flex-shrink-0 truncate text-text-muted">{pathToJsonPath(it.path)}</span>
                      <span className={`truncate ${TYPE_COLORS[typeOf(it.value)]}`}>{preview(it.value, 120)}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Vues. Chaque vue porte `min-w-0` : sans lui, un élément flex refuse
          d'être plus étroit que son contenu — un tableau de 30 colonnes
          élargissait toute la vue (8 000 px mesurés pour une fenêtre de
          1 400), son défilement horizontal ne se déclenchait jamais et les
          boutons CSV / Copier sortaient de l'écran. */}
      <div className="flex min-h-0 min-w-0 flex-1">
        {tab === 'tree' ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col">
              <VirtualTree
                rows={rows}
                scrollTo={scrollTo}
                selectedId={pathKey(selected)}
                hits={hitKeys}
                currentHit={currentHit}
                editMode={editMode}
                onToggle={toggle}
                onSelect={setSelected}
                onEditValue={editValue}
                onRename={rename}
                onDelete={remove}
                onAdd={add}
                onMore={(row) => setShowMore((m) => ({ ...m, [pathKey(row.path)]: (m[pathKey(row.path)] || 500) + 1000 }))}
              />
              {editMode ? (
                <div className="border-t border-border bg-bg-secondary px-3 py-1 text-[11px] text-text-muted">
                  Double-clic sur une valeur ou une clé pour la modifier (une valeur se saisit en JSON : 42, true, null, {'{"a":1}'}) · ＋ ajoute un enfant · 🗑 supprime.
                </div>
              ) : null}
            </div>
            <Inspector data={data} path={selected} onShowTable={(p) => (setRecordPath(p), setTab('table'))} onQuery={(q) => (setQuery(q), runQuery(q))} />
          </>
        ) : null}

        {tab === 'table' ? (
          records ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-text-muted">Liste affichée : {recordPicker}</div>
              <RecordsTable records={records} onSelectRow={(i) => recordPath !== 'query' && activeRecordPath && setSelected([...activeRecordPath, i])} />
            </div>
          ) : (
            <p className="p-4 text-sm text-text-muted">Aucune liste d’objets dans ce document. Sélectionnez un tableau dans l’arbre, ou faites une requête qui renvoie des objets.</p>
          )
        ) : null}

        {tab === 'analysis' ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {recordPicker ? <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-text-muted">Liste analysée : {recordPicker}</div> : null}
            <Analysis data={data} records={records} recordsLabel={recordsLabel} />
          </div>
        ) : null}

        {tab === 'chart' ? (
          records ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-text-muted">Liste tracée : {recordPicker}</div>
              <ChartView key={recordsLabel} records={records} recordsLabel={recordsLabel} />
            </div>
          ) : (
            <p className="p-4 text-sm text-text-muted">Les graphiques s’appliquent aux listes d’objets (ex. des ventes, des utilisateurs). Ce document n’en contient pas.</p>
          )
        ) : null}

        {tab === 'schema' ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-text-muted">
              <FileJson size={13} /> JSON Schema déduit du document (types, champs obligatoires, formats reconnus).
              <button className="btn btn-secondary btn-sm ml-auto" onClick={() => copyText(schema)}>
                Copier
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => window.electronAPI?.devFiles?.save({ defaultPath: 'schema.json', content: schema })}>
                Enregistrer…
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs text-text-secondary select-text">{schema}</pre>
          </div>
        ) : null}

        {tab === 'text' ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
              <button className="btn btn-secondary btn-sm" onClick={() => { const r = parseJsonDocument(draft); if (r.ok) { setDraft(serialize(r.value)); applyDraft(serialize(r.value)); } else setDraftError(r); }}>
                Formater
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => { const r = parseJsonDocument(draft); if (r.ok) { const m = JSON.stringify(r.value); setDraft(m); applyDraft(m); } else setDraftError(r); }}>
                Minifier
              </button>
              <button className="btn btn-secondary btn-sm flex items-center gap-1" onClick={() => { const r = parseJsonDocument(draft); if (r.ok) { const s = serialize(sortKeysDeep(r.value)); setDraft(s); applyDraft(s); } else setDraftError(r); }}>
                <SortAsc size={12} /> Trier les clés
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => applyDraft(draft) && flash(true, 'Texte valide, appliqué')}>
                Valider et appliquer
              </button>
              {draftError ? (
                <span className="flex min-w-0 items-center gap-1 text-xs text-error">
                  <AlertTriangle size={12} />
                  <span className="truncate">
                    {draftError.position ? `Ligne ${draftError.position.line}, colonne ${draftError.position.col} : ` : ''}
                    {draftError.error}
                  </span>
                </span>
              ) : null}
            </div>
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDirty(true);
              }}
              spellCheck={false}
              wrap={wrap ? 'soft' : 'off'}
              className="min-h-0 flex-1 resize-none bg-bg-primary p-4 font-mono text-xs leading-5 text-text-primary outline-none"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
