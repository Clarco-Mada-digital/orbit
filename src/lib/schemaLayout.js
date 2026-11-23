// ---------------------------------------------------------------------------
// Diagramme entité-relation — logique pure (mise en page, liens, déductions).
//
// Aucune dépendance graphique : tout est calculable et testable sous Node.
// Le composant SchemaDiagram ne fait que dessiner ce que ce module décide.
// ---------------------------------------------------------------------------

export const CARD_W = 248;
export const HEADER_H = 40;
export const ROW_H = 22;
export const MORE_H = 24;
export const CARD_PAD = 6;
export const MAX_VISIBLE = 8;
const GAP_X = 140;
const GAP_Y = 48;
const WRAP_WIDTH = 3600;

export const tableKey = (t) => `${t.schema || ''}.${t.name ?? t.table}`;
export const relKey = (r) => `${r.from.schema}.${r.from.table}(${r.from.columns.join(',')})→${r.to.schema}.${r.to.table}`;

// Colonnes impliquées dans une relation, par table : elles restent visibles
// même quand la carte est repliée (sinon un lien pointerait dans le vide).
export function linkedColumns(relations) {
  const map = new Map();
  const add = (schema, table, cols) => {
    const k = `${schema || ''}.${table}`;
    if (!map.has(k)) map.set(k, new Set());
    for (const c of cols) if (c) map.get(k).add(c);
  };
  for (const r of relations) {
    add(r.from.schema, r.from.table, r.from.columns);
    add(r.to.schema, r.to.table, r.to.columns);
  }
  return map;
}

// Colonnes affichées sur la carte : clés primaires, puis colonnes reliées,
// puis les autres dans l'ordre, jusqu'à MAX_VISIBLE ; le reste devient « +N ».
export function visibleColumns(table, linked = new Set(), expanded = false) {
  const cols = table.columns || [];
  if (expanded || cols.length <= MAX_VISIBLE) return { shown: cols, hidden: 0 };
  const rank = (c) => (c.pk ? 0 : linked.has(c.name) ? 1 : 2);
  const chosen = new Set(
    [...cols]
      .map((c, i) => ({ c, i }))
      .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
      .slice(0, MAX_VISIBLE)
      .map((x) => x.c.name)
  );
  // On garde l'ordre réel de la table pour la lecture.
  const shown = cols.filter((c) => chosen.has(c.name));
  return { shown, hidden: cols.length - shown.length };
}

export function cardHeight(table, linked, expanded) {
  const { shown, hidden } = visibleColumns(table, linked, expanded);
  return HEADER_H + shown.length * ROW_H + (hidden ? MORE_H : 0) + CARD_PAD * 2;
}

// Ordonnée (dans la carte) de la ligne d'une colonne ; une colonne masquée
// se raccroche à la ligne « +N », ou à l'en-tête à défaut.
export function columnAnchorY(table, column, linked, expanded) {
  const { shown, hidden } = visibleColumns(table, linked, expanded);
  const i = shown.findIndex((c) => c.name === column);
  if (i >= 0) return HEADER_H + CARD_PAD + i * ROW_H + ROW_H / 2;
  if (hidden) return HEADER_H + CARD_PAD + shown.length * ROW_H + MORE_H / 2;
  return HEADER_H / 2;
}

// ---------------------------------------------------------------------------
// Relations déduites des noms (client_id → clients.id)
// ---------------------------------------------------------------------------
function plurals(base) {
  const b = base.toLowerCase();
  const out = [b, `${b}s`, `${b}es`];
  if (b.endsWith('y')) out.push(`${b.slice(0, -1)}ies`);
  if (b.endsWith('s')) out.push(b.slice(0, -1));
  return out;
}

export function inferRelations(tables, existing = []) {
  const declared = new Set(existing.map((r) => `${r.from.schema}.${r.from.table}.${r.from.columns.join(',')}`));
  const byName = new Map();
  for (const t of tables) {
    if (t.type === 'view') continue;
    const n = t.name.toLowerCase();
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(t);
  }
  const out = [];
  for (const t of tables) {
    if (t.type === 'view') continue;
    for (const c of t.columns || []) {
      const m = /^(.+?)_?id$/i.exec(c.name);
      if (!m || c.name.toLowerCase() === 'id' || !m[1]) continue;
      if (declared.has(`${t.schema}.${t.name}.${c.name}`)) continue;
      const base = m[1].replace(/_$/, '');
      let target = null;
      for (const cand of plurals(base)) {
        const list = byName.get(cand);
        if (list) {
          target = list.find((x) => x.schema === t.schema) || list[0];
          break;
        }
      }
      if (!target || target === t) continue;
      const pk = (target.columns || []).filter((x) => x.pk);
      const toCol = pk.length === 1 ? pk[0].name : (target.columns || []).find((x) => x.name.toLowerCase() === 'id')?.name;
      if (!toCol) continue;
      out.push({
        name: `${t.name}.${c.name} (déduite)`,
        inferred: true,
        from: { schema: t.schema || '', table: t.name, columns: [c.name] },
        to: { schema: target.schema || '', table: target.name, columns: [toCol] },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Placement automatique
//
// Par composante connexe : la table la plus reliée au centre de sa colonne,
// ses voisines dans la colonne suivante, etc. (parcours en largeur), avec un
// passage de « barycentre » pour limiter les croisements. Les composantes sont
// rangées en étagères ; les tables isolées en grille à la fin.
// ---------------------------------------------------------------------------
export function autoLayout(tables, relations, { expanded = {} } = {}) {
  const linked = linkedColumns(relations);
  const keys = tables.map(tableKey);
  const byKey = new Map(tables.map((t) => [tableKey(t), t]));
  const adj = new Map(keys.map((k) => [k, new Set()]));
  for (const r of relations) {
    const a = `${r.from.schema}.${r.from.table}`;
    const b = `${r.to.schema}.${r.to.table}`;
    if (a === b || !adj.has(a) || !adj.has(b)) continue;
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  const height = (k) => cardHeight(byKey.get(k), linked.get(k), expanded[k]);

  const seen = new Set();
  const components = [];
  const singles = [];
  for (const k of keys) {
    if (seen.has(k)) continue;
    if (adj.get(k).size === 0) {
      seen.add(k);
      singles.push(k);
      continue;
    }
    const comp = [];
    const stack = [k];
    seen.add(k);
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      for (const n of adj.get(cur)) if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
    components.push(comp);
  }
  components.sort((a, b) => b.length - a.length);

  const pos = {};
  let shelfX = 0;
  let shelfY = 0;
  let shelfH = 0;

  for (const comp of components) {
    const root = comp.reduce((best, k) => (adj.get(k).size > adj.get(best).size ? k : best), comp[0]);
    const level = new Map([[root, 0]]);
    const queue = [root];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of [...adj.get(cur)].sort((a, b) => adj.get(b).size - adj.get(a).size)) {
        if (!level.has(n)) {
          level.set(n, level.get(cur) + 1);
          queue.push(n);
        }
      }
    }
    const columns = [];
    for (const [k, l] of level) (columns[l] ||= []).push(k);
    // Barycentre : chaque table se range près de ses voisines de la colonne
    // précédente.
    for (let l = 1; l < columns.length; l += 1) {
      const prev = new Map(columns[l - 1].map((k, i) => [k, i]));
      const score = (k) => {
        const idx = [...adj.get(k)].filter((n) => prev.has(n)).map((n) => prev.get(n));
        return idx.length ? idx.reduce((a, b) => a + b, 0) / idx.length : Infinity;
      };
      columns[l].sort((a, b) => score(a) - score(b));
    }
    const colHeights = columns.map((col) => col.reduce((sum, k) => sum + height(k) + GAP_Y, -GAP_Y));
    const compH = Math.max(...colHeights);
    const compW = columns.length * (CARD_W + GAP_X) - GAP_X;
    if (shelfX > 0 && shelfX + compW > WRAP_WIDTH) {
      shelfX = 0;
      shelfY += shelfH + GAP_Y * 2;
      shelfH = 0;
    }
    columns.forEach((col, l) => {
      // Colonnes centrées verticalement : la table pivot reste au milieu.
      let y = shelfY + (compH - colHeights[l]) / 2;
      for (const k of col) {
        pos[k] = { x: shelfX + l * (CARD_W + GAP_X), y };
        y += height(k) + GAP_Y;
      }
    });
    shelfX += compW + GAP_X * 1.5;
    shelfH = Math.max(shelfH, compH);
  }

  if (singles.length) {
    const startY = components.length ? shelfY + shelfH + GAP_Y * 2 : 0;
    const perRow = Math.max(3, Math.min(8, Math.ceil(Math.sqrt(singles.length * 1.6))));
    let rowY = startY;
    for (let i = 0; i < singles.length; i += perRow) {
      const row = singles.slice(i, i + perRow);
      let rowH = 0;
      row.forEach((k, j) => {
        pos[k] = { x: j * (CARD_W + GAP_X / 2), y: rowY };
        rowH = Math.max(rowH, height(k));
      });
      rowY += rowH + GAP_Y;
    }
  }
  return pos;
}

// ---------------------------------------------------------------------------
// Tracé d'un lien : courbe de Bézier entre le bord droit/gauche des cartes,
// à la hauteur des colonnes concernées. Auto-référence : boucle à droite.
// ---------------------------------------------------------------------------
export function edgePath(from, to) {
  // from/to : { x, y (ancre absolue), w }
  if (from.self) {
    const x = from.x + from.w;
    const r = 46;
    return `M ${x} ${from.y} C ${x + r} ${from.y}, ${x + r} ${to.y}, ${x} ${to.y}`;
  }
  const fromCenter = from.x + from.w / 2;
  const toCenter = to.x + to.w / 2;
  const rightward = toCenter >= fromCenter;
  const sx = rightward ? from.x + from.w : from.x;
  const ex = rightward ? to.x : to.x + to.w;
  // Cartes superposées horizontalement : on sort et on rentre du même côté.
  const overlap = Math.abs(fromCenter - toCenter) < from.w * 0.6;
  if (overlap) {
    const x1 = from.x + from.w;
    const x2 = to.x + to.w;
    const bend = Math.max(x1, x2) + 60;
    return `M ${x1} ${from.y} C ${bend} ${from.y}, ${bend} ${to.y}, ${x2} ${to.y}`;
  }
  const dx = Math.max(50, Math.abs(ex - sx) * 0.45);
  const c1 = rightward ? sx + dx : sx - dx;
  const c2 = rightward ? ex - dx : ex + dx;
  return `M ${sx} ${from.y} C ${c1} ${from.y}, ${c2} ${to.y}, ${ex} ${to.y}`;
}

// Cadre englobant de toutes les cartes (pour « Ajuster à l'écran »).
export function bounds(positions, sizes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [k, p] of Object.entries(positions)) {
    const s = sizes[k];
    if (!s) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.w);
    maxY = Math.max(maxY, p.y + s.h);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Vue qui fait tenir `box` dans un cadre `vw × vh`, avec une marge.
export function fitView(box, vw, vh, margin = 60, maxScale = 1.2) {
  const k = Math.max(0.1, Math.min(maxScale, Math.min((vw - margin * 2) / box.w, (vh - margin * 2) / box.h)));
  return { k, x: vw / 2 - (box.x + box.w / 2) * k, y: vh / 2 - (box.y + box.h / 2) * k };
}
