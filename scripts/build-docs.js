#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Construction de la documentation : Markdown → HTML → PDF.
//
// LA RÈGLE : `docs/guide-utilisateur.md` est la SEULE source. Le HTML et le PDF
// en sont dérivés, jamais édités à la main. Avant, les trois vivaient leur vie
// séparément : le Markdown avançait, le HTML restait en arrière, et le PDF
// datait d'une version encore antérieure — autrement dit, trois vérités
// différentes selon le fichier ouvert.
//
// Usage :
//   node scripts/build-docs.js            (HTML + PDF)
//   node scripts/build-docs.js --html     (HTML seul, sans Chromium)
//
// Le PDF passe par un Chromium en mode « headless ». S'il n'y en a pas sur la
// machine, le HTML est tout de même produit et le script le dit clairement au
// lieu d'échouer en silence.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseMarkdown, parseInline } from '../src/lib/markdown.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'docs', 'guide-utilisateur.md');
const HTML_OUT = path.join(ROOT, 'docs', 'guide-utilisateur.html');
const PDF_OUT = path.join(ROOT, 'docs', 'guide-utilisateur.pdf');

// --- Rendu HTML -------------------------------------------------------------

const escape = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// `parseInline` (src/lib/markdown.js) rend des nœuds : gras, italique, code,
// liens, images. On les transforme en HTML ici — la visionneuse d'Orbit, elle,
// en fait du React à partir des mêmes nœuds.
function renderInline(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      if (typeof node === 'string') return escape(node);
      switch (node.type) {
        case 'text':
          return escape(node.text);
        case 'strong':
          return `<strong>${renderInline(node.children)}</strong>`;
        case 'em':
          return `<em>${renderInline(node.children)}</em>`;
        case 'del':
          return `<del>${renderInline(node.children)}</del>`;
        case 'code':
          return `<code>${escape(node.text)}</code>`;
        case 'link':
          return node.href
            ? `<a href="${escape(node.href)}">${escape(node.text)}</a>`
            : escape(node.text);
        case 'image':
          // Une image dont le chemin a été refusé ne doit pas laisser une
          // balise vide : on garde son texte alternatif, visible.
          return node.href
            ? `<img src="${escape(node.href)}" alt="${escape(node.alt || '')}" />`
            : `<em>${escape(node.alt || '')}</em>`;
        case 'media':
          return node.href ? `<a href="${escape(node.href)}">${escape(node.alt || node.href)}</a>` : '';
        case 'math':
          return `<code>${escape(node.tex)}</code>`;
        case 'fnref':
          return `<sup>${escape(node.id)}</sup>`;
        default:
          return node.children ? renderInline(node.children) : escape(node.text || '');
      }
    })
    .join('');
}

// `allowRelative` : la documentation est écrite dans le dépôt, ses images
// (`images/…`) et ses liens entre pages doivent survivre au rendu. La
// visionneuse d'Orbit, elle, garde le réglage strict par défaut.
const inline = (text) => renderInline(parseInline(String(text ?? ''), { allowRelative: true }));

// Ancre d'un titre : accents retirés, espaces en tirets. Elle sert au sommaire
// ET aux liens profonds du site publié — elle doit donc être stable.
function slugify(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function renderBlocks(blocks, headings) {
  const html = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const text = block.text ?? '';
        const id = slugify(text);
        if (block.level <= 3) headings.push({ level: block.level, text, id });
        html.push(`<h${block.level} id="${id}">${inline(text)}</h${block.level}>`);
        break;
      }
      case 'paragraph':
        html.push(`<p>${inline(block.text)}</p>`);
        break;
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        const start = block.ordered && block.start > 1 ? ` start="${block.start}"` : '';
        const items = (block.items || [])
          .map((item) => {
            const content = typeof item === 'string' ? item : item.text;
            const checkbox =
              typeof item === 'object' && item.checked !== null && item.checked !== undefined
                ? `<input type="checkbox" disabled ${item.checked ? 'checked' : ''} /> `
                : '';
            // Listes imbriquées : les enfants sont des blocs à part entière.
            const children = item?.children?.length ? renderBlocks(item.children, headings) : '';
            return `<li>${checkbox}${inline(content)}${children}</li>`;
          })
          .join('');
        html.push(`<${tag}${start}>${items}</${tag}>`);
        break;
      }
      case 'code':
        html.push(`<pre><code>${escape(block.text ?? '')}</code></pre>`);
        break;
      case 'quote':
        html.push(
          `<blockquote>${block.blocks ? renderBlocks(block.blocks, headings) : inline(block.text ?? '')}</blockquote>`
        );
        break;
      case 'math':
        html.push(`<pre><code>${escape(block.tex ?? '')}</code></pre>`);
        break;
      case 'table': {
        const head = (block.header || [])
          .map((cell) => `<th>${inline(cell)}</th>`)
          .join('');
        const rows = (block.rows || [])
          .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
          .join('');
        html.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`);
        break;
      }
      case 'hr':
        html.push('<hr />');
        break;
      case 'image':
        html.push(
          `<figure><img src="${escape(block.src)}" alt="${escape(block.alt || '')}" />` +
            (block.alt ? `<figcaption>${inline(block.alt)}</figcaption>` : '') +
            '</figure>'
        );
        break;
      default:
        if (block.text) html.push(`<p>${inline(block.text)}</p>`);
    }
  }
  return html.join('\n');
}

// Sommaire cliquable : sur 40 pages de PDF, c'est ce qui rend le document
// utilisable.
function renderToc(headings) {
  const items = headings
    .filter((heading) => heading.level === 2 || heading.level === 3)
    .map(
      (heading) =>
        `<li class="toc-${heading.level}"><a href="#${heading.id}">${inline(heading.text)}</a></li>`
    )
    .join('');
  return items ? `<nav class="toc"><h2>Sommaire</h2><ul>${items}</ul></nav>` : '';
}

// --- Couverture -------------------------------------------------------------

// Le logo est INCORPORÉ en base64 : le HTML reste autonome (GitHub Pages, envoi
// par courriel) et le PDF ne dépend pas d'un chemin de fichier au moment de
// l'impression.
function logoDataUri() {
  try {
    const png = fs.readFileSync(path.join(ROOT, 'build', 'icon.png'));
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

const AUTHOR = 'Clarco RAHERINANDRASANA';

function renderCover(version, date) {
  const logo = logoDataUri();
  return `<section class="cover">
  <div class="cover-glow" aria-hidden="true"></div>
  ${logo ? `<img class="cover-logo" src="${logo}" alt="Logo Orbit" />` : ''}
  <h1 class="cover-title">Orbit</h1>
  <p class="cover-tagline">Toutes vos applications web dans une seule fenêtre</p>
  <p class="cover-kind">Guide utilisateur complet</p>
  <div class="cover-rule" aria-hidden="true"></div>
  <dl class="cover-meta">
    <div><dt>Auteur</dt><dd>${escape(AUTHOR)}</dd></div>
    <div><dt>Version</dt><dd>Orbit ${escape(version)}</dd></div>
    <div><dt>Édition</dt><dd>${escape(date)}</dd></div>
  </dl>
</section>`;
}

const COVER_STYLE = `
  /* Hauteur = zone IMPRIMABLE d'une A4 (297mm moins les marges de page), pas
     la feuille entière : une page nommée sans marge n'est pas appliquée par
     tous les moteurs d'impression, et le fond débordait alors d'une bande sur
     la page suivante. Attention aussi aux accents graves dans ce commentaire :
     il vit dans un gabarit de chaîne, ils la fermeraient. */
  .cover {
    position: relative;
    height: 264mm;
    margin: 0;
    padding: 0 18mm;
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: #f8fafc;
    background: #0b1020;
    background-image:
      radial-gradient(circle at 18% 12%, rgba(99, 102, 241, 0.55), transparent 48%),
      radial-gradient(circle at 82% 78%, rgba(14, 165, 233, 0.42), transparent 52%),
      linear-gradient(160deg, #0b1020 0%, #131a33 55%, #0b1020 100%);
    overflow: hidden;
    page-break-after: always;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Halo discret : il donne de la profondeur sans charger la page. */
  .cover-glow {
    position: absolute;
    inset: -30% -10% auto -10%;
    height: 70%;
    background: radial-gradient(ellipse at center, rgba(165, 180, 252, 0.18), transparent 70%);
  }
  .cover-logo {
    width: 128px;
    height: 128px;
    border: none;
    border-radius: 28px;
    box-shadow: 0 24px 60px rgba(2, 6, 23, 0.6);
    position: relative;
  }
  .cover-title {
    margin: 26px 0 0;
    font-size: 64px;
    font-weight: 700;
    letter-spacing: -2px;
    position: relative;
  }
  .cover-tagline {
    margin: 10px 0 0;
    font-size: 18px;
    color: #c7d2fe;
    position: relative;
  }
  .cover-kind {
    margin: 30px 0 0;
    font-size: 15px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #94a3b8;
    position: relative;
  }
  .cover-rule {
    width: 90px;
    height: 3px;
    margin: 22px 0 28px;
    border-radius: 999px;
    background: linear-gradient(90deg, #6366f1, #38bdf8);
    position: relative;
  }
  .cover-meta {
    display: flex;
    gap: 42px;
    margin: 0;
    position: relative;
  }
  .cover-meta div { text-align: center; }
  .cover-meta dt {
    font-size: 11px;
    letter-spacing: 1.6px;
    text-transform: uppercase;
    color: #8da2c0;
  }
  .cover-meta dd {
    margin: 5px 0 0;
    font-size: 15px;
    font-weight: 600;
    color: #e2e8f0;
  }
`;

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto;
    padding: 0;
    max-width: 960px;
    font: 15px/1.65 system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #111827;
    background: #ffffff;
  }
  /* Le rembourrage vit ICI et non sur <body> : la couverture doit pouvoir
     aller jusqu'au bord du papier sans marges négatives. */
  .page { padding: 40px 48px 64px; }
  h1 { font-size: 30px; margin: 0 0 8px; letter-spacing: -0.4px; }
  h2 {
    font-size: 22px;
    margin: 42px 0 12px;
    padding-bottom: 6px;
    border-bottom: 2px solid #e5e7eb;
    page-break-after: avoid;
  }
  h3 { font-size: 17px; margin: 26px 0 8px; page-break-after: avoid; }
  h4 { font-size: 15px; margin: 20px 0 6px; color: #374151; page-break-after: avoid; }
  p { margin: 10px 0; }
  ul, ol { margin: 10px 0; padding-left: 24px; }
  li { margin: 4px 0; }
  a { color: #4f46e5; text-decoration: none; }
  code {
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 5px;
    padding: 1px 5px;
    font: 13px/1.4 ui-monospace, 'SFMono-Regular', Menlo, monospace;
  }
  pre {
    background: #0f172a;
    color: #e2e8f0;
    padding: 14px 16px;
    border-radius: 10px;
    overflow-x: auto;
    page-break-inside: avoid;
  }
  pre code { background: none; border: none; color: inherit; padding: 0; }
  blockquote {
    margin: 14px 0;
    padding: 10px 16px;
    border-left: 4px solid #6366f1;
    background: #eef2ff;
    border-radius: 0 8px 8px 0;
  }
  table { width: 100%; border-collapse: collapse; margin: 14px 0; page-break-inside: avoid; }
  th, td { border: 1px solid #e5e7eb; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f9fafb; font-weight: 600; }
  figure { margin: 18px 0; page-break-inside: avoid; }
  img { max-width: 100%; border-radius: 10px; border: 1px solid #e5e7eb; }
  figcaption { margin-top: 6px; font-size: 13px; color: #6b7280; text-align: center; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 32px 0; }
  .toc {
    margin: 28px 0 36px;
    padding: 18px 22px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    page-break-after: always;
  }
  .toc h2 { margin: 0 0 10px; font-size: 17px; border: none; padding: 0; }
  .toc ul { list-style: none; padding: 0; margin: 0; }
  .toc li.toc-3 { padding-left: 18px; font-size: 14px; color: #4b5563; }
  .built {
    margin-top: 48px;
    padding-top: 14px;
    border-top: 1px solid #e5e7eb;
    font-size: 12px;
    color: #9ca3af;
  }
  /* Format DÉCLARÉ : sans lui, Chromium imprime en Letter (279mm) selon la
     locale, et une couverture calculée pour une A4 déborde d'une bande sur la
     page suivante. */
  @page { size: A4; margin: 16mm 14mm; }
`;

function buildHtml(markdown, version) {
  // `parseMarkdown` rend directement le tableau de blocs.
  const blocks = parseMarkdown(markdown);
  const headings = [];
  const body = renderBlocks(blocks, headings);
  const title = headings.find((heading) => heading.level === 1)?.text || 'Orbit — guide utilisateur';
  const built = new Date().toISOString().slice(0, 10);
  const edition = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(title)}</title>
<meta name="author" content="${escape(AUTHOR)}" />
<meta name="description" content="Guide utilisateur complet d'Orbit — ${escape(version)}" />
<!-- Fichier GÉNÉRÉ par scripts/build-docs.js à partir de docs/guide-utilisateur.md.
     Toute modification faite ici serait perdue à la prochaine génération. -->
<style>${COVER_STYLE}${STYLE}</style>
</head>
<body>
${renderCover(version, edition)}
<main class="page">
${renderToc(headings)}
${body}
<p class="built">Orbit ${escape(version)} · ${escape(AUTHOR)} · document généré le ${built} à partir de
<code>docs/guide-utilisateur.md</code> (<code>npm run docs</code>).</p>
</main>
</body>
</html>
`;
}

// --- PDF --------------------------------------------------------------------

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (candidate.includes(path.sep) || candidate.includes('/')) {
        if (fs.existsSync(candidate)) return candidate;
        continue;
      }
      const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [candidate], {
        encoding: 'utf8',
      });
      if (probe.status === 0 && probe.stdout.trim()) return candidate;
    } catch {
      /* candidat suivant */
    }
  }
  return null;
}

function buildPdf(htmlPath) {
  const chrome = findChrome();
  if (!chrome) {
    console.warn(
      '⚠ PDF non régénéré : aucun Chrome/Chromium trouvé.\n' +
        '  Installez-en un, ou indiquez-le par CHROME_BIN=/chemin/vers/chrome npm run docs'
    );
    return false;
  }
  // Profil jetable : sans ça, Chrome refuse de démarrer si une session est
  // déjà ouverte avec le profil par défaut.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-docs-'));
  try {
    execFileSync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-pdf-header-footer',
        `--user-data-dir=${profile}`,
        `--print-to-pdf=${PDF_OUT}`,
        `file://${htmlPath}`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 }
    );
    return true;
  } catch (err) {
    console.warn(`⚠ PDF non régénéré : ${err.stderr?.toString().trim() || err.message}`);
    return false;
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

// --- Entrée -----------------------------------------------------------------

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`Source introuvable : ${path.relative(ROOT, SOURCE)}`);
    process.exit(1);
  }
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const markdown = fs.readFileSync(SOURCE, 'utf8');
  const html = buildHtml(markdown, version);
  fs.writeFileSync(HTML_OUT, html);
  console.log(`✔ HTML : ${path.relative(ROOT, HTML_OUT)} (${(html.length / 1024).toFixed(1)} Ko)`);

  if (process.argv.includes('--html')) return;
  if (buildPdf(HTML_OUT)) {
    const size = fs.statSync(PDF_OUT).size;
    console.log(`✔ PDF  : ${path.relative(ROOT, PDF_OUT)} (${(size / 1024).toFixed(0)} Ko)`);
  }
}

main();
