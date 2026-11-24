// ---------------------------------------------------------------------------
// Visionneuse markdown — logique pure (sans React ni DOM).
//
// Le rendu lui-même passe par react-markdown (remark → rehype → éléments
// React) : AUCUNE chaîne HTML n'est injectée. Le HTML brut des README
// (`<div align="center">`, `<details>`, `<kbd>`, `<table>`…) est analysé en
// arbre, puis NETTOYÉ par le schéma ci-dessous avant de devenir des éléments
// React : scripts, styles, gestionnaires d'événements, `javascript:` et
// iframes disparaissent ; ce que GitHub affiche, Orbit l'affiche.
// ---------------------------------------------------------------------------
import { defaultSchema } from 'hast-util-sanitize';

// Schéma de GitHub, plus :
//   • les classes produites par remark-math (`math-inline`, `math-display`),
//     que rehype-katex met en forme APRÈS le nettoyage ;
//   • `className` « language-* » sur <code> (coloration) — déjà admis ;
//   • `align`, `width`, `height`, `valign` : déjà admis sur tout élément.
export const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
    span: [...(defaultSchema.attributes.span || []), ['className', 'math-inline', 'math-display']],
    div: [...(defaultSchema.attributes.div || []), ['className', 'math-display']],
    blockquote: [...(defaultSchema.attributes.blockquote || []), ['className', 'markdown-alert', /^markdown-alert-(note|tip|important|warning|caution)$/]],
  },
};

// Alertes GitHub : « > [!NOTE] », « > [!WARNING] »… Pas dans GFM standard,
// mais omniprésentes dans les README. Plugin remark : la citation reçoit les
// classes `markdown-alert markdown-alert-<type>` et perd son marqueur ; le
// composant la titre et la colore.
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(\r?\n)?/i;

export function remarkAlerts() {
  const walk = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (child.type === 'blockquote') {
        const para = child.children?.[0];
        const first = para?.type === 'paragraph' ? para.children?.[0] : null;
        const m = first?.type === 'text' ? ALERT_RE.exec(first.value) : null;
        if (m) {
          const kind = m[1].toLowerCase();
          first.value = first.value.slice(m[0].length);
          if (!first.value) para.children.shift();
          if (!para.children.length) child.children.shift();
          child.data = { ...(child.data || {}), hProperties: { className: ['markdown-alert', `markdown-alert-${kind}`] } };
        }
      }
      walk(child);
    }
  };
  return (tree) => walk(tree);
}

// En-tête YAML (« front matter ») : `---` en toute première ligne, puis des
// lignes `clé: valeur`, puis `---`. Courant dans les docs (Jekyll, Hugo,
// Docusaurus, Obsidian). Affiché comme une fiche, pas comme un filet suivi
// d'un paragraphe illisible.
export function extractFrontMatter(source) {
  const text = String(source ?? '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: [], body: text };
  const data = [];
  let current = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      current = [kv[1], kv[2].replace(/^["']|["']$/g, '')];
      data.push(current);
    } else if (current && /^\s+-\s*/.test(line)) {
      // Liste YAML sous une clé : « tags:\n  - a\n  - b »
      const item = line.replace(/^\s+-\s*/, '').replace(/^["']|["']$/g, '');
      current[1] = current[1] ? `${current[1]}, ${item}` : item;
    }
  }
  return { data, body: text.slice(m[0].length) };
}

// Nature d'un lien du document.
//   anchor   : #section (dans le document)
//   web      : http(s), mailto → navigateur du système
//   relative : chemin relatif (docs/guide.md, ../LICENSE)
//   blocked  : javascript:, data:, file:… → neutralisé
export function linkKind(href) {
  const s = String(href || '').trim();
  if (!s) return 'blocked';
  if (s.startsWith('#')) return 'anchor';
  if (/^(https?:\/\/|mailto:)/i.test(s)) return 'web';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) return 'blocked';
  return 'relative';
}

// Adresse absolue d'un lien relatif d'un document DISTANT.
export function resolveAgainst(href, baseUrl) {
  try {
    const u = new URL(String(href), String(baseUrl));
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

// Images distantes du document (pour le bandeau « afficher les images »).
// Compte les ![](http…) markdown et les <img src="http…"> HTML.
export function countRemoteImages(source) {
  const text = String(source ?? '');
  const md = text.match(/!\[[^\]]*\]\(\s*https?:\/\/[^)\s]+/g) || [];
  const html = text.match(/<img\b[^>]*\bsrc\s*=\s*["']?https?:\/\//gi) || [];
  return md.length + html.length;
}
