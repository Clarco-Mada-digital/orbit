import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  KeyRound,
  Link2,
  Loader2,
  Locate,
  Maximize2,
  Network,
  RefreshCw,
  Search,
  Sparkles,
  Table2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  CARD_W,
  HEADER_H,
  ROW_H,
  CARD_PAD,
  MORE_H,
  autoLayout,
  bounds,
  cardHeight,
  columnAnchorY,
  edgePath,
  fitView,
  inferRelations,
  linkedColumns,
  relKey,
  tableKey,
  visibleColumns,
} from '../../lib/schemaLayout';
import { useDbUiStore } from '../../lib/devToolsStore';

// ---------------------------------------------------------------------------
// Diagramme entité-relation d'une base.
//
//   • chaque table est une carte (8 colonnes au plus, puis « +N ») ;
//   • les clés étrangères sont des liens ; les relations DÉDUITES des noms
//     (client_id → clients) sont en pointillés et peuvent être masquées ;
//   • glisser le fond déplace la vue, Ctrl/⌘ + molette (ou pincer) zoome
//     autour du curseur, la molette seule fait défiler ;
//   • glisser une carte la déplace — la disposition est mémorisée ;
//   • survoler une carte met en avant ses relations, un clic ouvre le détail.
// ---------------------------------------------------------------------------
const MIN_K = 0.15;
const MAX_K = 2.5;

function hue(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// --- Carte ------------------------------------------------------------------
const TableCard = memo(function TableCard({ table, pos, linked, fkCols, expanded, state, onPointerDown, onToggleExpand, onHover, onOpen }) {
  const { shown, hidden } = visibleColumns(table, linked, expanded);
  // Une teinte par table (stable d'une session à l'autre) : on repère une
  // table d'un coup d'œil, et la mini-carte reste lisible.
  const h = hue(table.name);
  const dim = state === 'dim';
  const focus = state === 'focus' || state === 'selected';
  return (
    <div
      data-card
      onPointerDown={onPointerDown}
      onPointerEnter={() => onHover(tableKey(table))}
      onPointerLeave={() => onHover(null)}
      onDoubleClick={() => onOpen(table)}
      className={`orbit-er-card absolute select-none rounded-xl border bg-bg-elevated transition-[opacity,box-shadow,border-color] duration-200 ${
        state === 'selected'
          ? 'border-accent-primary shadow-[0_0_0_3px_rgba(99,102,241,0.35),0_18px_40px_rgba(0,0,0,0.45)]'
          : focus
            ? 'border-accent-primary/60 shadow-[0_14px_34px_rgba(0,0,0,0.4)]'
            : 'border-border shadow-[0_6px_18px_rgba(0,0,0,0.28)]'
      } ${dim ? 'opacity-30' : 'opacity-100'}`}
      style={{ left: pos.x, top: pos.y, width: CARD_W, cursor: 'grab' }}
    >
      <div
        className="flex items-center gap-2 rounded-t-xl px-3"
        style={{
          height: HEADER_H,
          background: `linear-gradient(135deg, hsla(${h}, 70%, 55%, 0.28), hsla(${(h + 40) % 360}, 70%, 50%, 0.08))`,
          borderBottom: `1px solid hsla(${h}, 70%, 60%, 0.35)`,
        }}
      >
        {table.type === 'view' ? <Eye size={14} className="flex-shrink-0 opacity-80" /> : <Table2 size={14} className="flex-shrink-0 opacity-80" />}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={table.schema ? `${table.schema}.${table.name}` : table.name}>
          {table.name}
        </span>
        {table.schema && table.schema !== 'public' && table.schema !== 'dbo' ? (
          <span className="flex-shrink-0 rounded bg-black/20 px-1.5 text-[10px] text-text-secondary">{table.schema}</span>
        ) : null}
        <span className="flex-shrink-0 text-[10px] text-text-muted">{table.columns.length}</span>
      </div>
      <div style={{ padding: `${CARD_PAD}px 0` }}>
        {shown.map((c) => (
          <div key={c.name} className="flex items-center gap-1.5 px-3 font-mono text-[11.5px]" style={{ height: ROW_H }}>
            <span className="flex w-3.5 flex-shrink-0 justify-center">
              {c.pk ? <KeyRound size={11} className="text-yellow-500" /> : fkCols?.has(c.name) ? <Link2 size={11} className="text-accent-primary" /> : null}
            </span>
            <span className={`min-w-0 flex-1 truncate ${c.pk ? 'font-semibold' : ''}`}>{c.name}</span>
            <span className="max-w-[45%] flex-shrink-0 truncate text-[10.5px] text-text-muted">{c.type}</span>
          </div>
        ))}
        {hidden || (expanded && table.columns.length > 8) ? (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onToggleExpand(tableKey(table))}
            className="mx-2 flex w-[calc(100%-1rem)] items-center justify-center rounded-md text-[11px] font-medium text-accent-primary hover:bg-accent-primary/10"
            style={{ height: MORE_H - 4 }}
          >
            {hidden ? `+${hidden > 9 ? '9+' : hidden} colonne${hidden > 1 ? 's' : ''}` : 'Réduire'}
          </button>
        ) : null}
      </div>
    </div>
  );
});

// --- Diagramme --------------------------------------------------------------
export default function SchemaDiagram({ conn, onOpenTable, onQuery }) {
  const [data, setData] = useState({ loading: true });
  const savedLayout = useDbUiStore.getState().layouts?.[conn.id];
  const setLayout = useDbUiStore((s) => s.setLayout);
  const [positions, setPositions] = useState(savedLayout?.positions || {});
  const [view, setView] = useState(savedLayout?.view || null);
  const [expanded, setExpanded] = useState(savedLayout?.expanded || {});
  const [showInferred, setShowInferred] = useState(savedLayout?.showInferred ?? true);
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const viewport = useRef(null);
  const viewRef = useRef(view);
  const [size, setSize] = useState({ w: 1, h: 1 });
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const load = useCallback(async () => {
    setData((d) => ({ ...d, loading: true, error: null }));
    const res = await window.electronAPI?.database?.schema(conn.id);
    setData(res?.success ? { loading: false, ...res } : { loading: false, error: res?.error || 'Lecture du schéma impossible' });
  }, [conn.id]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Taille de la zone d'affichage (mini-carte, centrage) : suivie par
  // observation plutôt que lue pendant le rendu.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth || 1, h: el.offsetHeight || 1 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data.loading, data.error]);

  const tables = useMemo(() => data.tables || [], [data.tables]);
  const declared = useMemo(() => data.relations || [], [data.relations]);
  const inferred = useMemo(() => inferRelations(tables, declared), [tables, declared]);
  const relations = useMemo(() => (showInferred ? [...declared, ...inferred] : declared), [declared, inferred, showInferred]);
  const linked = useMemo(() => linkedColumns(relations), [relations]);
  const fkByTable = useMemo(() => {
    const m = new Map();
    for (const r of relations) {
      const k = `${r.from.schema}.${r.from.table}`;
      if (!m.has(k)) m.set(k, new Set());
      for (const c of r.from.columns) m.get(k).add(c);
    }
    return m;
  }, [relations]);
  const byKey = useMemo(() => new Map(tables.map((t) => [tableKey(t), t])), [tables]);
  const sizes = useMemo(() => {
    const s = {};
    for (const t of tables) {
      const k = tableKey(t);
      s[k] = { w: CARD_W, h: cardHeight(t, linked.get(k), expanded[k]) };
    }
    return s;
  }, [tables, linked, expanded]);

  const cssZoom = () => {
    const el = viewport.current;
    return el && el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
  };

  const fit = useCallback(
    (pos = positions) => {
      const el = viewport.current;
      if (!el) return;
      setView(fitView(bounds(pos, sizes), el.offsetWidth, el.offsetHeight));
    },
    [positions, sizes]
  );

  // Premières positions : disposition automatique pour les tables qui n'en
  // ont pas encore (nouvelle base, ou tables ajoutées depuis).
  useEffect(() => {
    if (!tables.length) return undefined;
    const missing = tables.some((t) => !positions[tableKey(t)]);
    if (!missing) {
      if (view) return undefined;
      const t = setTimeout(() => fit(), 0);
      return () => clearTimeout(t);
    }
    const auto = autoLayout(tables, relations, { expanded });
    const known = Object.keys(positions).length > 0;
    let next = { ...auto, ...positions };
    if (known) {
      // Les nouvelles tables arrivent sous le schéma existant, sans bousculer
      // ce que l'utilisateur a rangé.
      const box = bounds(positions, sizes);
      let x = box.x;
      for (const t of tables) {
        const k = tableKey(t);
        if (positions[k]) continue;
        next[k] = { x, y: box.y + box.h + 120 };
        x += CARD_W + 60;
      }
    }
    const t = setTimeout(() => {
      setPositions(next);
      if (!view) fit(next);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables]);

  // Mémorisation (différée : un glissement produit des dizaines d'états).
  useEffect(() => {
    if (!tables.length) return undefined;
    const t = setTimeout(() => setLayout(conn.id, { positions, view, expanded, showInferred }), 400);
    return () => clearTimeout(t);
  }, [positions, view, expanded, showInferred, conn.id, setLayout, tables.length]);

  // --- Zoom et défilement ---------------------------------------------------
  const zoomAt = useCallback((factor, sx, sy) => {
    setView((v) => {
      if (!v) return v;
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
      const wx = (sx - v.x) / v.k;
      const wy = (sy - v.y) / v.k;
      return { k, x: sx - wx * k, y: sy - wy * k };
    });
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const z = cssZoom();
      const rect = el.getBoundingClientRect();
      const sx = (e.clientX - rect.left) / z;
      const sy = (e.clientY - rect.top) / z;
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.0022), sx, sy);
      } else {
        setView((v) => (v ? { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY } : v));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, data.loading]);

  // --- Glisser (fond = déplacer la vue, carte = déplacer la carte) ----------
  const startPan = (e) => {
    if (e.button !== 0 || e.target.closest('[data-card],[data-ui]')) return;
    const start = { x: e.clientX, y: e.clientY, v: viewRef.current };
    const z = cssZoom();
    let moved = false;
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / z;
      const dy = (ev.clientY - start.y) / z;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      setView({ ...start.v, x: start.v.x + dx, y: start.v.y + dy });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) setSelected(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startDrag = useCallback((key) => (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const z = cssZoom();
    const k = viewRef.current?.k || 1;
    const start = { x: e.clientX, y: e.clientY };
    let origin = null;
    let moved = false;
    let frame = 0;
    let last = null;
    setPositions((p) => {
      origin = p[key];
      return p;
    });
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / z / k;
      const dy = (ev.clientY - start.y) / z / k;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / k) return;
      moved = true;
      last = { dx, dy };
      if (frame) return;
      // Une mise à jour par image : un glissement reste fluide même avec
      // des centaines de cartes.
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!origin || !last) return;
        setPositions((p) => ({ ...p, [key]: { x: origin.x + last.dx, y: origin.y + last.dy } }));
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) setSelected((s) => (s === key ? null : key));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  const toggleExpand = useCallback((key) => setExpanded((x) => ({ ...x, [key]: !x[key] })), []);

  const centerOn = (key) => {
    const p = positions[key];
    const s = sizes[key];
    const el = viewport.current;
    if (!p || !s || !el) return;
    setView((v) => {
      const k = Math.max(v?.k || 1, 0.8);
      return { k, x: el.offsetWidth / 2 - (p.x + s.w / 2) * k, y: el.offsetHeight / 2 - (p.y + s.h / 2) * k };
    });
    setSelected(key);
  };

  const relayout = () => {
    const next = autoLayout(tables, relations, { expanded });
    setPositions(next);
    setTimeout(() => fit(next), 0);
  };

  // --- Mise en avant --------------------------------------------------------
  const focusKey = hover || selected;
  const neighbors = useMemo(() => {
    if (!focusKey) return null;
    const set = new Set([focusKey]);
    for (const r of relations) {
      const a = `${r.from.schema}.${r.from.table}`;
      const b = `${r.to.schema}.${r.to.table}`;
      if (a === focusKey) set.add(b);
      if (b === focusKey) set.add(a);
    }
    return set;
  }, [focusKey, relations]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return tables.filter((t) => t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase() === q)).map(tableKey);
  }, [search, tables]);

  // --- Rendu ----------------------------------------------------------------
  if (data.loading && !tables.length) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-text-muted">
        <Loader2 size={16} className="animate-spin" /> Lecture du schéma…
      </div>
    );
  }
  if (data.error) {
    return <div className="m-4 rounded-lg bg-error/10 p-3 font-mono text-xs text-error">{data.error}</div>;
  }
  if (!tables.length) {
    return <div className="flex flex-1 items-center justify-center text-sm text-text-muted">Aucune table dans cette base.</div>;
  }

  const v = view || { x: 0, y: 0, k: 1 };
  const edges = relations
    .map((r) => {
      const fk = `${r.from.schema}.${r.from.table}`;
      const tk = `${r.to.schema}.${r.to.table}`;
      const fp = positions[fk];
      const tp = positions[tk];
      const ft = byKey.get(fk);
      const tt = byKey.get(tk);
      if (!fp || !tp || !ft || !tt) return null;
      const fy = fp.y + columnAnchorY(ft, r.from.columns[0], linked.get(fk), expanded[fk]);
      const ty = tp.y + columnAnchorY(tt, r.to.columns[0], linked.get(tk), expanded[tk]);
      const d = edgePath({ x: fp.x, y: fy, w: CARD_W, self: fk === tk }, { x: tp.x, y: ty, w: CARD_W });
      const active = focusKey && (fk === focusKey || tk === focusKey);
      return { key: relKey(r) + (r.inferred ? '~' : ''), d, r, active, dim: focusKey && !active };
    })
    .filter(Boolean);

  const box = bounds(positions, sizes);
  const vw = size.w;
  const vh = size.h;
  const mm = { w: 200, h: 130 };
  const mmScale = Math.min(mm.w / (box.w + 200), mm.h / (box.h + 200));
  const mmX = (x) => (x - box.x + 100) * mmScale;
  const mmY = (y) => (y - box.y + 100) * mmScale;
  const sel = selected ? byKey.get(selected) : null;

  return (
    <div className="flex min-h-0 flex-1">
      <div
        ref={viewport}
        data-own-zoom
        onPointerDown={startPan}
        className="relative min-w-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        style={{
          backgroundColor: 'var(--color-bg-primary, #0b0b10)',
          backgroundImage:
            'radial-gradient(circle, rgba(148,163,184,0.18) 1px, transparent 1.2px), radial-gradient(ellipse at 50% 40%, rgba(99,102,241,0.10), transparent 65%)',
          backgroundSize: `${22 * v.k}px ${22 * v.k}px, 100% 100%`,
          backgroundPosition: `${v.x}px ${v.y}px, 0 0`,
        }}
      >
        <style>{`
          @keyframes orbit-er-flow { to { stroke-dashoffset: -24; } }
          .orbit-er-flow { stroke-dasharray: 8 6; animation: orbit-er-flow 0.9s linear infinite; }
          .orbit-er-card:hover { transform: translateY(-2px); }
        `}</style>
        <div className="absolute left-0 top-0" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})`, transformOrigin: '0 0' }}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            <defs>
              <marker id="er-one" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="currentColor" />
              </marker>
            </defs>
            {edges.map((e) => (
              <g key={e.key} className={e.active ? 'text-accent-primary' : 'text-text-muted'} style={{ opacity: e.dim ? 0.12 : e.r.inferred ? 0.55 : 0.8 }}>
                {e.active ? <path d={e.d} fill="none" stroke="currentColor" strokeWidth={8} strokeOpacity={0.18} /> : null}
                <path
                  d={e.d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={e.active ? 2.2 : 1.4}
                  strokeDasharray={e.r.inferred && !e.active ? '5 5' : undefined}
                  className={e.active ? 'orbit-er-flow' : ''}
                  markerEnd="url(#er-one)"
                />
              </g>
            ))}
          </svg>
          {tables.map((t) => {
            const k = tableKey(t);
            const pos = positions[k];
            if (!pos) return null;
            const state = selected === k ? 'selected' : neighbors ? (neighbors.has(k) ? 'focus' : 'dim') : matches.length ? (matches.includes(k) ? 'focus' : 'dim') : 'normal';
            return (
              <TableCard
                key={k}
                table={t}
                pos={pos}
                linked={linked.get(k)}
                fkCols={fkByTable.get(k)}
                expanded={Boolean(expanded[k])}
                state={state}
                onPointerDown={startDrag(k)}
                onToggleExpand={toggleExpand}
                onHover={setHover}
                onOpen={onOpenTable}
              />
            );
          })}
        </div>

        {/* Barre d'outils */}
        <div data-ui className="absolute left-3 top-3 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-bg-elevated/90 p-1 shadow-lg backdrop-blur">
          <div className="flex items-center gap-1 rounded-lg bg-bg-primary px-2">
            <Search size={12} className="text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches[0]) centerOn(matches[0]);
              }}
              placeholder="Trouver une table…"
              className="w-36 bg-transparent py-1 text-xs outline-none"
            />
            {search ? <span className="text-[10px] text-text-muted">{matches.length}</span> : null}
          </div>
          <button className="btn-icon h-7 w-7" title="Zoom arrière" onClick={() => zoomAt(1 / 1.2, vw / 2, vh / 2)}>
            <ZoomOut size={14} />
          </button>
          <span className="w-10 text-center text-[11px] text-text-muted">{Math.round(v.k * 100)} %</span>
          <button className="btn-icon h-7 w-7" title="Zoom avant (Ctrl + molette)" onClick={() => zoomAt(1.2, vw / 2, vh / 2)}>
            <ZoomIn size={14} />
          </button>
          <button className="btn-icon h-7 w-7" title="Tout afficher" onClick={() => fit()}>
            <Maximize2 size={14} />
          </button>
          <button className="btn-icon h-7 w-7" title="Réorganiser automatiquement" onClick={relayout}>
            <Wand2 size={14} />
          </button>
          <button className="btn-icon h-7 w-7" title="Relire le schéma" onClick={load}>
            {data.loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button
            className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] ${showInferred ? 'bg-accent-primary/15 text-accent-primary' : 'text-text-muted hover:bg-bg-hover'}`}
            title="Relations déduites des noms de colonnes (client_id → clients), quand la base ne déclare pas ses clés étrangères"
            onClick={() => setShowInferred((x) => !x)}
          >
            <Sparkles size={12} /> Déduites ({inferred.length})
          </button>
        </div>

        {/* Légende */}
        <div data-ui className="absolute bottom-3 left-3 flex items-center gap-3 rounded-lg border border-border bg-bg-elevated/90 px-3 py-1.5 text-[11px] text-text-muted shadow-lg backdrop-blur">
          <span className="flex items-center gap-1">
            <Network size={12} /> {tables.length} tables{data.truncated ? ` (sur ${data.totalTables})` : ''} · {declared.length} relations
          </span>
          <span className="flex items-center gap-1">
            <KeyRound size={11} className="text-yellow-500" /> clé primaire
          </span>
          <span className="flex items-center gap-1">
            <Link2 size={11} className="text-accent-primary" /> clé étrangère
          </span>
          <span className="flex items-center gap-1">
            <svg width="22" height="6">
              <line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeDasharray="4 3" />
            </svg>
            déduite
          </span>
        </div>

        {/* Mini-carte */}
        <svg
          data-ui
          width={mm.w}
          height={mm.h}
          className="absolute bottom-3 right-3 cursor-pointer rounded-lg border border-border bg-bg-elevated/90 shadow-lg backdrop-blur"
          onPointerDown={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            const z = cssZoom();
            const wx = ((e.clientX - r.left) / z) / mmScale + box.x - 100;
            const wy = ((e.clientY - r.top) / z) / mmScale + box.y - 100;
            setView((cur) => ({ ...(cur || v), x: vw / 2 - wx * (cur || v).k, y: vh / 2 - wy * (cur || v).k }));
          }}
        >
          {tables.map((t) => {
            const k = tableKey(t);
            const p = positions[k];
            if (!p) return null;
            return (
              <rect
                key={k}
                x={mmX(p.x)}
                y={mmY(p.y)}
                width={Math.max(2, CARD_W * mmScale)}
                height={Math.max(2, sizes[k].h * mmScale)}
                rx={1.5}
                fill={k === selected ? 'rgb(99,102,241)' : `hsla(${hue(t.name)}, 60%, 60%, 0.55)`}
              />
            );
          })}
          <rect
            x={mmX(-v.x / v.k)}
            y={mmY(-v.y / v.k)}
            width={(vw / v.k) * mmScale}
            height={(vh / v.k) * mmScale}
            fill="rgba(99,102,241,0.08)"
            stroke="rgb(99,102,241)"
            strokeWidth={1}
          />
        </svg>
      </div>

      {/* Détail de la table sélectionnée */}
      {sel ? (
        <aside className="flex w-80 flex-shrink-0 flex-col border-l border-border bg-bg-secondary">
          <div className="flex items-start gap-2 border-b border-border p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                {sel.type === 'view' ? <Eye size={14} /> : <Table2 size={14} />}
                <span className="truncate">{sel.name}</span>
              </div>
              <div className="text-[11px] text-text-muted">
                {sel.schema ? `${sel.schema} · ` : ''}
                {sel.type === 'view' ? 'vue' : 'table'} · {sel.columns.length} colonnes
              </div>
            </div>
            <button className="btn-icon h-6 w-6" onClick={() => centerOn(selected)} title="Centrer">
              <Locate size={13} />
            </button>
            <button className="btn-icon h-6 w-6" onClick={() => setSelected(null)}>
              <X size={13} />
            </button>
          </div>
          <div className="flex gap-1.5 border-b border-border p-2">
            <button className="btn btn-primary btn-sm flex-1" onClick={() => onOpenTable(sel)}>
              Ouvrir les données
            </button>
            <button
              className="btn btn-secondary btn-sm flex-1"
              onClick={() => {
                const q = (n) => (conn.driver === 'mysql' ? `\`${n}\`` : conn.driver === 'mssql' ? `[${n}]` : `"${n}"`);
                const target = sel.schema && conn.driver !== 'sqlite' ? `${q(sel.schema)}.${q(sel.name)}` : q(sel.name);
                const cols = sel.columns.map((c) => q(c.name)).join(', ');
                onQuery(
                  conn.driver === 'mssql'
                    ? `SELECT TOP 100 ${cols}\nFROM ${target};`
                    : conn.driver === 'oracle'
                      ? `SELECT ${cols}\nFROM ${target}\nFETCH FIRST 100 ROWS ONLY;`
                      : `SELECT ${cols}\nFROM ${target}\nLIMIT 100;`
                );
              }}
            >
              Requête SELECT
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Colonnes</div>
            {sel.columns.map((c) => (
              <div key={c.name} className="flex items-center gap-1.5 rounded px-1.5 py-1 font-mono text-xs hover:bg-bg-hover">
                <span className="flex w-3.5 justify-center">
                  {c.pk ? <KeyRound size={11} className="text-yellow-500" /> : fkByTable.get(selected)?.has(c.name) ? <Link2 size={11} className="text-accent-primary" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="truncate text-[10.5px] text-text-muted">{c.type}</span>
                {!c.nullable ? <span className="text-[9px] text-text-muted" title="NOT NULL">NN</span> : null}
              </div>
            ))}
            {(() => {
              const out = relations.filter((r) => `${r.from.schema}.${r.from.table}` === selected);
              const inc = relations.filter((r) => `${r.to.schema}.${r.to.table}` === selected);
              const row = (r, dir) => {
                const other = dir === 'out' ? `${r.to.schema}.${r.to.table}` : `${r.from.schema}.${r.from.table}`;
                return (
                  <button
                    key={relKey(r) + dir}
                    onClick={() => centerOn(other)}
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono text-[11px] hover:bg-bg-hover"
                    title={r.inferred ? 'Relation déduite du nom de la colonne' : r.name}
                  >
                    <span className={r.inferred ? 'text-text-muted' : 'text-accent-primary'}>{dir === 'out' ? '→' : '←'}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {dir === 'out' ? `${r.from.columns.join(', ')} → ${r.to.table}.${r.to.columns.join(', ')}` : `${r.from.table}.${r.from.columns.join(', ')}`}
                    </span>
                    {r.inferred ? <Sparkles size={10} className="flex-shrink-0 text-text-muted" /> : null}
                  </button>
                );
              };
              return (
                <>
                  <div className="mb-1 mt-3 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Référence ({out.length})</div>
                  {out.length ? out.map((r) => row(r, 'out')) : <div className="px-1.5 text-[11px] text-text-muted">Aucune</div>}
                  <div className="mb-1 mt-3 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Référencée par ({inc.length})</div>
                  {inc.length ? inc.map((r) => row(r, 'in')) : <div className="px-1.5 text-[11px] text-text-muted">Aucune</div>}
                </>
              );
            })()}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
