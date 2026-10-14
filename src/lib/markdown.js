// ---------------------------------------------------------------------------
// Markdown → BLOCS DE DONNÉES — LOGIQUE PURE, sans dépendance ni HTML.
//
// POURQUOI PAS UNE BIBLIOTHÈQUE, ET POURQUOI PAS D'HTML
//
// Le rendu doit afficher des documents qu'on n'a PAS écrits (un README
// téléchargé, un fichier servi par un NAS). Or markdown accepte du HTML brut :
// la recette habituelle — convertir en HTML puis l'injecter via
// `dangerouslySetInnerHTML` — transformerait un document reçu en script exécuté
// dans l'interface, donc avec accès au pont Electron de la fenêtre (KeePassXC,
// trousseaux, sessions). Inacceptable, même avec un assainisseur : le seul
// rendu vraiment sûr est de NE JAMAIS produire de HTML.
//
// On renvoie donc des structures de données que le composant transforme en JSX
// (React échappe le texte par construction). C'est aussi ce qui permet de
// couper les fonctionnalités risquées : les images distantes ne sont PAS
// chargées (un document distant pourrait espionner la lecture via une URL
// unique) — elles deviennent une simple pastille cliquable.
//
// Périmètre assumé : titres, paragraphes, emphases/graisse/code inline, code
// en bloc, listes (imbriquées, à cases), citations, tableaux, filets, liens.
// ---------------------------------------------------------------------------

// Délimiteurs de bloc, du plus spécifique au plus général.
const FENCE = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const UL = /^(\s*)([-*+])\s+(.*)$/;
const OL = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

// Analyse un texte inline : renvoie des nœuds { type, … } que le composant
// rend en JSX. Ordre des règles = priorité (le code inline d'abord, sinon ses
// astérisques seraient vus comme de l'emphase).
export function parseInline(text) {
  const out = [];
  let rest = String(text ?? '');
  // Motifs, dans l'ordre : code `…`, image ![alt](src), lien [txt](href),
  // autolien <http…>, graisse **…**, italique *…*, barré ~~…~~.
  const RULES = [
    { re: /`([^`]+)`/, type: 'code' },
    { re: /!\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/, type: 'image' },
    { re: /\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/, type: 'link' },
    { re: /<(https?:\/\/[^>\s]+)>/, type: 'autolink' },
    { re: /\*\*([^*]+)\*\*/, type: 'strong' },
    { re: /__([^_]+)__/, type: 'strong' },
    { re: /\*([^*\n]+)\*/, type: 'em' },
    { re: /_([^_\n]+)_/, type: 'em' },
    { re: /~~([^~]+)~~/, type: 'del' },
  ];

  while (rest) {
    let best = null;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (m && (best === null || m.index < best.m.index)) best = { rule, m };
    }
    if (!best) {
      out.push({ type: 'text', text: rest });
      break;
    }
    const { rule, m } = best;
    if (m.index > 0) out.push({ type: 'text', text: rest.slice(0, m.index) });
    if (rule.type === 'link') {
      out.push({ type: 'link', text: m[1] || m[2], href: safeHref(m[2]) });
    } else if (rule.type === 'image') {
      // Image NON chargée : on garde l'alternative, affichée comme une pastille.
      out.push({ type: 'image', alt: m[1] || m[2], href: safeHref(m[2]) });
    } else if (rule.type === 'autolink') {
      out.push({ type: 'link', text: m[1], href: safeHref(m[1]) });
    } else if (rule.type === 'code') {
      // Contenu PRIS AU PIED DE LA LETTRE : on ne re-analyse pas le markdown
      // à l'intérieur d'un `code` inline.
      out.push({ type: 'code', text: m[1] });
    } else {
      out.push({ type: rule.type, text: m[1], children: parseInline(m[1]) });
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

// Seuls http(s), mailto et les ancres internes sont des liens. Tout le reste
// (javascript:, data:, file:…) est neutralisé — un document reçu ne doit pas
// pouvoir faire exécuter du code ni lire un fichier local par un clic.
export function safeHref(href) {
  const s = String(href || '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^mailto:[^\s]+$/i.test(s)) return s;
  if (/^#[\w-]*$/.test(s)) return s;
  return null;
}

const isTableSeparator = (line) => TABLE_SEP.test(line) && line.includes('-');

function splitTableRow(line) {
  const m = TABLE_ROW.exec(line);
  const body = (m ? m[1] : line).trim();
  return body.split('|').map((c) => c.trim());
}

function alignmentsOf(sepLine) {
  const m = TABLE_ROW.exec(sepLine);
  const cells = (m ? m[1] : sepLine).split('|').map((c) => c.trim());
  return cells.map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

// Liste à puces ou numérotée, avec imbrication par indentation. `depth` borne
// la récursion : un fichier malformé ne doit pas faire exploser la pile.
function parseList(lines, start, depth) {
  const first = lines[start];
  const ordered = OL.test(first) && !UL.test(first);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // Une ligne vide suivie d'une ligne non indentée termine la liste.
      const next = lines[i + 1];
      if (next && !next.trim()) {
        i += 1;
        continue;
      }
      if (next && /^\s+\S/.test(next)) {
        i += 1;
        continue;
      }
      break;
    }
    const m = ordered ? OL.exec(line) : UL.exec(line);
    if (!m) {
      // Ligne de continuation d'un item (texte enroulé).
      if (items.length && /^\s+\S/.test(line)) {
        items[items.length - 1].lines.push(line.trim());
        i += 1;
        continue;
      }
      break;
    }
    const indent = m[1].length;
    const body = m[3];
    // Item d'un même niveau : nouvelle puce. Plus indenté : sous-liste.
    if (indent > 0 && items.length) {
      const sub = parseList(lines, i, depth + 1);
      items[items.length - 1].children.push(sub);
      i = sub.end;
      continue;
    }
    const task = TASK.exec(body);
    items.push({
      text: task ? task[2] : body,
      checked: task ? task[1].toLowerCase() === 'x' : null,
      lines: [],
      children: [],
    });
    i += 1;
  }

  return {
    block: {
      type: 'list',
      ordered,
      start: ordered ? Number(OL.exec(first)[2]) : null,
      items: items.map((it) => ({
        text: [it.text, ...it.lines].join(' '),
        checked: it.checked,
        children: it.children.map((c) => c.block),
      })),
    },
    end: i,
  };
}

// Découpe un document markdown en blocs. Aucune chaîne HTML n'est produite.
export function parseMarkdown(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2] || '';
      const closing = new RegExp(`^\\s*${marker}\\s*$`);
      const body = [];
      i += 1;
      while (i < lines.length && !closing.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      const closed = i < lines.length;
      if (closed) {
        i += 1; // la ligne de fermeture
      } else {
        // Filet jamais fermé (fichier tronqué) : le saut de ligne final du
        // fichier ne fait pas partie du code affiché.
        while (body.length && body[body.length - 1] === '') body.pop();
      }
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // Tableau : une ligne de cellules suivie d'une ligne de séparation.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line);
      const align = alignmentsOf(lines[i + 1]);
      const rows = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', header, align, rows });
      continue;
    }

    if (QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && (QUOTE.test(lines[i]) || (inner.length && lines[i].trim()))) {
        const m = QUOTE.exec(lines[i]);
        inner.push(m ? m[1] : lines[i]);
        i += 1;
      }
      blocks.push({ type: 'quote', blocks: parseMarkdown(inner.join('\n')) });
      continue;
    }

    if (UL.test(line) || OL.test(line)) {
      const res = parseList(lines, i, 0);
      blocks.push(res.block);
      i = res.end;
      continue;
    }

    // Paragraphe : lignes consécutives jusqu'à une ligne vide ou un nouveau
    // bloc. Deux espaces en fin de ligne = saut de ligne forcé.
    const para = [];
    while (i < lines.length && lines[i].trim() && !startsBlockAt(lines, i)) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({
      type: 'paragraph',
      breaks: para.map((l) => / {2,}$/.test(l)),
      text: para.join('\n'),
    });
  }

  return blocks;
}

// Une ligne commence-t-elle un nouveau bloc ? (sert à arrêter les paragraphes)
// Le tableau demande DEUX lignes (cellules + séparation) pour être reconnu :
// un paragraphe qui contient un simple « | » ne doit pas être coupé en deux.
function startsBlockAt(lines, i) {
  const line = lines[i];
  if (FENCE.test(line) || HEADING.test(line) || HR.test(line)) return true;
  if (QUOTE.test(line) || UL.test(line) || OL.test(line)) return true;
  return TABLE_ROW.test(line) && isTableSeparator(lines[i + 1] || '');
}

// Statistiques simples, affichées dans l'en-tête de la visionneuse.
export function markdownStats(source) {
  const text = String(source ?? '');
  const lines = text ? text.split('\n').length : 0;
  const words = (text.match(/\S+/g) || []).length;
  return { lines, words, chars: text.length };
}
