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
// Périmètre assumé : titres (dièses et soulignés), paragraphes,
// emphases/graisse/barré/code inline, échappements, code en bloc, listes
// (imbriquées, à cases), citations, alertes GFM, tableaux, filets, liens et
// autoliens, images, MÉDIAS audio/vidéo, FORMULES mathématiques (TeX) et NOTES
// DE BAS DE PAGE.
//
// Les formules sortent en TeX brut (`{ type: 'math', tex }`) : la mise en forme
// est faite par KaTeX dans le composant, à partir du TeX — jamais à partir de
// HTML trouvé dans le document. Les médias ne sont pas chargés tant que le
// lecteur ne le demande pas, pour la même raison que les images.
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
// Formule isolée sur ses propres lignes : $$…$$ ou \[…\]
const MATH_OPEN = /^\s{0,3}(\$\$|\\\[)\s*(.*)$/;
// Définition d'une note de bas de page : [^clé]: le texte
const FOOTNOTE_DEF = /^\s{0,3}\[\^([^\]\s]+)\]:\s*(.*)$/;
// Titre « souligné » (setext) : la ligne de dessous ne contient que = ou -
const SETEXT_H1 = /^\s{0,3}=+\s*$/;
const SETEXT_H2 = /^\s{0,3}-+\s*$/;
// Alertes GFM : « > [!NOTE] », « > [!WARNING] »… très répandues dans les README
const ALERT = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;

// Extensions reconnues comme média. Liste explicite plutôt que « tout ce qui
// n'est pas une image » : un lecteur ne doit s'ouvrir que sur un format qu'on
// sait lire, pas sur un .exe déguisé.
const VIDEO_EXT = /\.(mp4|webm|ogv|m4v|mov)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|flac|opus|aac)(\?|#|$)/i;

export function mediaKind(href) {
  const s = String(href || '');
  if (VIDEO_EXT.test(s)) return 'video';
  if (AUDIO_EXT.test(s)) return 'audio';
  return null;
}

// Analyse un texte inline : renvoie des nœuds { type, … } que le composant
// rend en JSX. Ordre des règles = priorité (le code inline d'abord, sinon ses
// astérisques seraient vus comme de l'emphase).
export function parseInline(text, options = {}) {
  const out = [];
  // `options` est transmis tel quel aux liens et aux images (voir safeHref).
  let rest = String(text ?? '');
  // Motifs, dans l'ordre : code `…`, image ![alt](src), lien [txt](href),
  // autolien <http…>, graisse **…**, italique *…*, barré ~~…~~.
  const RULES = [
    // Formules délimitées à la LaTeX. Elles passent avant l'échappement :
    // « \( » ouvre une formule, ce n'est pas une parenthèse échappée — c'est la
    // notation que produisent la plupart des modèles de langage.
    { re: /\\\[([\s\S]+?)\\\]/, type: 'mathDisplay' },
    { re: /\\\(([^\n]+?)\\\)/, type: 'math' },
    // L'échappement passe avant le reste : « \* » doit rester une étoile, pas
    // ouvrir une emphase. Même raison pour « \$ » dans un texte qui parle
    // d'argent au milieu d'un document à formules.
    { re: /\\([\\`*_{}[\]()#+\-.!>~$])/, type: 'escape' },
    { re: /`([^`]+)`/, type: 'code' },
    // Formules à dollars. Le $ simple exige de ne pas coller un espace à
    // l'intérieur (« $x$ » oui, « $5 et $6 » non) : sans ça, deux prix dans la
    // même phrase deviendraient une formule.
    { re: /\$\$([^$]+)\$\$/, type: 'mathDisplay' },
    { re: /\$(?!\s)([^$\n]+?)(?<!\s)\$/, type: 'math' },
    { re: /!\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/, type: 'image' },
    { re: /\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/, type: 'link' },
    // Renvoi de note de bas de page : [^1]. Après le lien, pour que
    // « [^1]: définition » ne soit pas pris pour un lien.
    { re: /\[\^([^\]\s]+)\]/, type: 'fnref' },
    { re: /<(https?:\/\/[^>\s]+)>/, type: 'autolink' },
    // URL écrite telle quelle, sans crochets : fréquent dans les README et les
    // messages collés. La ponctuation finale est rendue au texte.
    { re: /https?:\/\/[^\s<>()[\]]+/, type: 'bareLink' },
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
    if (rule.type === 'escape') {
      out.push({ type: 'text', text: m[1] });
    } else if (rule.type === 'link') {
      out.push({ type: 'link', text: m[1] || m[2], href: safeHref(m[2], options) });
    } else if (rule.type === 'image') {
      const kind = mediaKind(m[2]);
      if (kind) {
        // Audio/vidéo : un lecteur, pas une pastille d'image. Comme les
        // images, la source n'est PAS chargée tant que le lecteur ne clique
        // pas (une URL unique suffirait sinon à signaler la lecture).
        out.push({ type: 'media', kind, alt: m[1] || '', href: safeHref(m[2], options) });
      } else {
        // Image NON chargée : on garde l'alternative, affichée comme une pastille.
        out.push({ type: 'image', alt: m[1] || m[2], href: safeHref(m[2], options) });
      }
    } else if (rule.type === 'mathDisplay' || rule.type === 'math') {
      // TeX conservé tel quel : c'est KaTeX, dans le composant, qui le met en
      // forme. Le document n'a aucun moyen d'injecter du balisage par ici.
      out.push({ type: 'math', tex: m[1].trim(), display: rule.type === 'mathDisplay' });
    } else if (rule.type === 'fnref') {
      out.push({ type: 'fnref', id: m[1] });
    } else if (rule.type === 'bareLink') {
      // « …voir https://exemple.test/page. » → le point final appartient à la
      // phrase, pas à l'adresse.
      const raw = m[0].replace(/[.,;:!?»"']+$/, '');
      out.push({ type: 'link', text: raw, href: safeHref(raw, options) });
      rest = rest.slice(m.index + raw.length);
      continue;
    } else if (rule.type === 'autolink') {
      out.push({ type: 'link', text: m[1], href: safeHref(m[1], options) });
    } else if (rule.type === 'code') {
      // Contenu PRIS AU PIED DE LA LETTRE : on ne re-analyse pas le markdown
      // à l'intérieur d'un `code` inline.
      out.push({ type: 'code', text: m[1] });
    } else {
      out.push({ type: rule.type, text: m[1], children: parseInline(m[1], options) });
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

// Seuls http(s), mailto et les ancres internes sont des liens. Tout le reste
// (javascript:, data:, file:…) est neutralisé — un document reçu ne doit pas
// pouvoir faire exécuter du code ni lire un fichier local par un clic.
export function safeHref(href, { allowRelative = false } = {}) {
  const s = String(href || '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^mailto:[^\s]+$/i.test(s)) return s;
  if (/^#[\w-]*$/.test(s)) return s;
  // `allowRelative` n'est JAMAIS activé pour un document reçu : il sert à la
  // documentation du dépôt, écrite par nous, qui a besoin de ses images
  // locales (`images/capture.png`) et de ses liens entre pages. Les remontées
  // de dossier et les chemins absolus restent refusés dans tous les cas.
  if (allowRelative && /^[\w.][\w./-]*$/.test(s) && !s.includes('..')) return s;
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
  // Notes de bas de page : les définitions sont retirées du flux et regroupées
  // en fin de document, comme dans un livre — c'est leur intérêt, sinon elles
  // s'intercaleraient au milieu du texte là où l'auteur les a écrites.
  const notes = [];
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

    // Formule en bloc : $$…$$ ou \[…\], sur une ou plusieurs lignes.
    const mathOpen = MATH_OPEN.exec(line);
    if (mathOpen) {
      const closing = mathOpen[1] === '$$' ? /\$\$\s*$/ : /\\\]\s*$/;
      const body = [];
      // Formule tenant sur une seule ligne ($$ x = 1 $$)
      const sameLine = mathOpen[2] || '';
      if (closing.test(sameLine)) {
        blocks.push({
          type: 'math',
          display: true,
          tex: sameLine.replace(closing, '').trim(),
        });
        i += 1;
        continue;
      }
      if (sameLine) body.push(sameLine);
      i += 1;
      while (i < lines.length && !closing.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        const last = lines[i].replace(closing, '');
        if (last.trim()) body.push(last);
        i += 1; // la ligne de fermeture
      }
      blocks.push({ type: 'math', display: true, tex: body.join('\n').trim() });
      continue;
    }

    // Définition d'une note de bas de page. Les lignes indentées qui suivent
    // la prolongent — c'est ainsi qu'on écrit une note de deux phrases.
    const note = FOOTNOTE_DEF.exec(line);
    if (note) {
      const body = [note[2]];
      i += 1;
      while (i < lines.length && /^\s+\S/.test(lines[i]) && !FOOTNOTE_DEF.test(lines[i])) {
        body.push(lines[i].trim());
        i += 1;
      }
      notes.push({ id: note[1], text: body.join('\n').trim() });
      continue;
    }

    // Titre souligné (setext) : « Titre » suivi d'une ligne de = (niveau 1) ou
    // de - (niveau 2). Vérifié AVANT le filet horizontal, sinon « Titre\n--- »
    // donnerait un paragraphe suivi d'un trait.
    // Seul un PARAGRAPHE peut être souligné : « - item » suivi de « --- » est
    // une liste puis un filet, pas un titre.
    const under = lines[i + 1];
    if (
      under &&
      !startsBlockAt(lines, i) &&
      !FOOTNOTE_DEF.test(line) &&
      (SETEXT_H1.test(under) || SETEXT_H2.test(under))
    ) {
      blocks.push({
        type: 'heading',
        level: SETEXT_H1.test(under) ? 1 : 2,
        text: line.trim(),
      });
      i += 2;
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
      // Alerte GFM : la première ligne de la citation est « [!NOTE] » & co.
      // On la retire du corps et on garde la nature de l'encadré, que le
      // composant colore et titre.
      const alert = ALERT.exec(inner[0] || '');
      if (alert) {
        blocks.push({
          type: 'quote',
          variant: alert[1].toLowerCase(),
          blocks: parseMarkdown(inner.slice(1).join('\n')),
        });
        continue;
      }
      blocks.push({ type: 'quote', variant: null, blocks: parseMarkdown(inner.join('\n')) });
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

  // Les notes closent le document, numérotées dans leur ordre de définition.
  // Le libellé est calculé ICI parce que c'est le seul endroit qui voit tout
  // le document : `parseInline`, qui rencontre les renvois, n'en sait rien.
  if (notes.length) {
    blocks.push({
      type: 'footnotes',
      items: notes.map((n, index) => ({ id: n.id, label: String(index + 1), text: n.text })),
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
  if (MATH_OPEN.test(line) || FOOTNOTE_DEF.test(line)) return true;
  return TABLE_ROW.test(line) && isTableSeparator(lines[i + 1] || '');
}

// Table des renvois : { id → libellé affiché }. Le composant s'en sert pour
// qu'un « [^note] » croisé au fil du texte affiche le même numéro que l'entrée
// de bas de page correspondante.
export function footnoteLabels(blocks) {
  const map = new Map();
  for (const block of blocks || []) {
    if (block?.type !== 'footnotes') continue;
    for (const item of block.items || []) map.set(item.id, item.label);
  }
  return map;
}

// Statistiques simples, affichées dans l'en-tête de la visionneuse.
export function markdownStats(source) {
  const text = String(source ?? '');
  const lines = text ? text.split('\n').length : 0;
  const words = (text.match(/\S+/g) || []).length;
  return { lines, words, chars: text.length };
}
