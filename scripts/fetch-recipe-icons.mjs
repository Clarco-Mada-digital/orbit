#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Icônes de la boutique, EMBARQUÉES dans Orbit.
//
// Avant, chaque carte de la boutique demandait son icône à icon.horse puis à
// Google en direct : 166 requêtes d'un coup → icon.horse répond « 429 trop de
// requêtes » à près de la moitié, Google renvoie un globe générique pour une
// dizaine de sites (WhatsApp, Proton, AWS…), et les apps Google partagent
// toutes le même « G ». Résultat : des emojis et des icônes identiques.
//
// Ce script choisit, UNE fois, la meilleure icône de chaque recette et l'écrit
// dans public/recipe-icons/<id>.webp (96 px). La boutique s'affiche alors
// instantanément, hors ligne, sans révéler à un tiers la liste des apps.
//
// Ordre des candidats : icône de marque de la recette → icônes déclarées par
// le site (apple-touch-icon, <link rel=icon>, manifest) → icon.horse →
// Google s2. Une image IDENTIQUE pour plusieurs sites différents est un
// placeholder générique : écartée.
//
// Usage : node scripts/fetch-recipe-icons.mjs [id…]   (sans argument : tout)
//         --check : vérifie qu'il ne manque aucune icône (CI)
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { recipes } from '../src/lib/recipes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'recipe-icons');
const INDEX = path.join(ROOT, 'src', 'lib', 'recipeIconIndex.json');
const SIZE = 96;
const MIN = 32;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const args = process.argv.slice(2);
if (args.includes('--check')) {
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const missing = Object.keys(recipes).filter((id) => !index.includes(id) || !fs.existsSync(path.join(OUT, `${id}.webp`)));
  if (missing.length) {
    console.error(`✖ icônes manquantes : ${missing.join(', ')} — lancez node scripts/fetch-recipe-icons.mjs ${missing.join(' ')}`);
    process.exit(1);
  }
  console.log(`✔ ${index.length} icônes de recettes`);
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sources choisies à la main, vérifiées le 24/11/2026 : sites qui bloquent les
// robots, n'ont qu'un placeholder chez les services d'icônes, ou cachent leur
// icône dans du JavaScript. Elles passent en premier et ne sont jamais
// considérées comme génériques.
const OVERRIDES = {
  onedrive: 'https://commons.wikimedia.org/wiki/Special:FilePath/Microsoft_Office_OneDrive_(2019–present).svg',
  azure: 'https://commons.wikimedia.org/wiki/Special:FilePath/Microsoft_Azure.svg',
  m365: 'https://commons.wikimedia.org/wiki/Special:FilePath/Microsoft_365_(2022).svg',
  copilot: 'https://res.cdn.office.net/officehub/images/content/images/unauth-copilotcom/favicon-copilot-brand-refresh-23392c1f66.ico',
  npm: 'https://static-production.npmjs.com/58a19602036db1daee0d7863c94673a4.png',
  postman: 'https://voyager.postman.com/logo/postman-logo-icon-orange.svg',
  revolut: 'https://assets.revolut.com/assets/favicons/apple-touch-icon.png',
  arte: 'https://static-cdn.arte.tv/replay/favicons/favicon-194x194.png',
  books: 'https://www.gstatic.com/images/branding/product/2x/play_books_48dp.png',
  analytics: 'https://www.gstatic.com/images/branding/product/2x/analytics_48dp.png',
  gcp: 'https://www.gstatic.com/images/branding/product/2x/cloud_48dp.png',
  firebase: 'https://www.gstatic.com/images/branding/product/2x/firebase_48dp.png',
  windscribe: 'https://www.google.com/s2/favicons?domain=windscribe.com&sz=128',
};

// .ico : sharp ne le lit pas. Les .ico modernes contiennent des PNG — on
// extrait le plus grand.
function pngFromIco(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  let best = null;
  for (let i = 0; i < buf.readUInt16LE(4); i++) {
    const e = 6 + i * 16;
    if (e + 16 > buf.length) break;
    const size = buf.readUInt32LE(e + 8);
    const off = buf.readUInt32LE(e + 12);
    const w = buf[e] || 256;
    const data = buf.subarray(off, off + size);
    if (data[0] === 0x89 && data[1] === 0x50 && (!best || w > best.w)) best = { w, data };
  }
  return best?.data || null;
}

// Glyphe monochrome sur fond transparent (logo noir de GitHub, blanc de
// Grok…) : invisible dans l'un des deux thèmes. On le pose sur une tuile
// arrondie contrastée, comme le ferait l'icône d'une app mobile.
async function withContrastTile(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0;
  let lum = 0;
  let sat = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    opaque++;
    const [r, g, b] = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
  }
  const total = info.width * info.height;
  if (!opaque || opaque / total > 0.75) return null; // a déjà son propre fond
  lum /= opaque;
  sat /= opaque;
  if (sat > 0.18 || (lum > 0.22 && lum < 0.85)) return null; // coloré : lisible partout
  const fill = lum <= 0.22 ? '#ffffff' : '#18181b';
  const glyph = await sharp(png).resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const tile = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="22" fill="${fill}"/></svg>`);
  return sharp(tile).composite([{ input: glyph, left: 16, top: 16 }]).webp({ quality: 90 }).toBuffer();
}

async function fetchBuf(url, { accept = 'image/*,*/*;q=0.8' } = {}, attempt = 0) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(15000) });
    if (r.status === 429 && attempt < 3) {
      await sleep(4000 * (attempt + 1)); // trop de requêtes : on patiente
      return fetchBuf(url, { accept }, attempt + 1);
    }
    if (!r.ok) return null;
    return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || '', url: r.url };
  } catch {
    return null;
  }
}

// Icônes déclarées par la page (et son manifest), de la plus grande à la plus petite.
async function siteIcons(pageUrl) {
  const page = await fetchBuf(pageUrl, { accept: 'text/html' });
  if (!page || !/html/.test(page.type)) return [];
  const html = page.buf.toString('utf8').slice(0, 400000);
  const base = page.url;
  const found = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = /\brel=["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() || '';
    const href = /\bhref=["']?([^"' >]+)/i.exec(tag)?.[1];
    if (!href) continue;
    if (rel.includes('manifest')) {
      try {
        const m = await fetchBuf(new URL(href, base).href, { accept: 'application/json' });
        const json = m && JSON.parse(m.buf.toString('utf8'));
        for (const ic of json?.icons || []) {
          const size = Math.max(...String(ic.sizes || '0').split(/\s+/).map((s) => parseInt(s, 10) || 0));
          if (ic.src && !/maskable/.test(ic.purpose || '')) found.push({ url: new URL(ic.src, m.url).href, size: size || 1, how: 'manifest' });
        }
      } catch {
        /* manifest illisible */
      }
      continue;
    }
    if (!/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const size = parseInt(/\bsizes=["']?(\d+)/i.exec(tag)?.[1] || (rel.includes('apple') ? '180' : '0'), 10);
    found.push({ url: new URL(href, base).href, size: /\.svg(\?|$)/i.test(href) ? 512 : size || 16, how: rel });
  }
  return found.sort((a, b) => b.size - a.size).slice(0, 6);
}

// Image → WebP carré 96 px (null si illisible ou trop petite).
async function normalize(cand) {
  const got = await fetchBuf(cand.url);
  if (!got || got.buf.length < 100) return null;
  const raw = pngFromIco(got.buf) || got.buf;
  try {
    const img = sharp(raw, { density: 300 });
    const meta = await img.metadata();
    if (!meta.width || (meta.format !== 'svg' && Math.min(meta.width, meta.height) < MIN)) return null;
    const png = await img.resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const webp = (await withContrastTile(png)) || (await sharp(png).webp({ quality: 90 }).toBuffer());
    return { webp, hash: crypto.createHash('md5').update(got.buf).digest('hex'), src: cand.url, how: cand.how, width: meta.width };
  } catch {
    return null; // .ico et formats exotiques : sharp ne sait pas → candidat suivant
  }
}

const ids = args.length ? args.filter((a) => recipes[a]) : Object.keys(recipes);
const results = {};
for (const id of ids) {
  const r = recipes[id];
  const host = new URL(r.url).hostname;
  const origin = new URL(r.url).origin;
  const cands = [];
  if (OVERRIDES[id]) cands.push({ url: OVERRIDES[id], how: 'choisie' });
  if (r.brandIcon) cands.push({ url: r.brandIcon, how: 'marque' });
  const fromSite = [...(await siteIcons(r.url)), ...(r.url !== `${origin}/` ? await siteIcons(`${origin}/`) : [])];
  cands.push(...fromSite);
  cands.push({ url: `https://icon.horse/icon/${host}`, how: 'icon.horse' });
  cands.push({ url: `https://www.google.com/s2/favicons?domain=${host}&sz=128`, how: 'google' });
  const ok = [];
  for (const c of cands) {
    const n = await normalize(c);
    if (n) ok.push(n);
    if (c.how === 'icon.horse') await sleep(800); // pas de rafale : 429 sinon
    if (ok.length >= 3 || (n && c.how === 'choisie')) break;
  }
  results[id] = ok;
  process.stdout.write(`${ok[0] ? '·' : '✖'}`);
}
process.stdout.write('\n');

// Placeholder générique : même image pour des recettes de domaines différents.
const domainOf = (id) => new URL(recipes[id].url).hostname.split('.').slice(-2).join('.');
const owners = new Map();
for (const [id, list] of Object.entries(results)) for (const n of list) {
  if (!owners.has(n.hash)) owners.set(n.hash, new Set());
  owners.get(n.hash).add(domainOf(id));
}

fs.mkdirSync(OUT, { recursive: true });
let index = [];
try {
  index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
} catch {
  /* première fois */
}
const report = [];
for (const [id, list] of Object.entries(results)) {
  const best = list.find((n) => n.how === 'choisie' || n.how === 'marque' || owners.get(n.hash).size === 1);
  if (!best) {
    report.push(`✖ ${id} : aucune icône fiable (l'emoji restera)`);
    index = index.filter((x) => x !== id);
    fs.rmSync(path.join(OUT, `${id}.webp`), { force: true });
    continue;
  }
  fs.writeFileSync(path.join(OUT, `${id}.webp`), best.webp);
  if (!index.includes(id)) index.push(id);
  report.push(`✔ ${id.padEnd(16)} ${best.how.padEnd(18)} ${String(best.width).padStart(4)}px  ${best.src.slice(0, 90)}`);
}
index = index.filter((id) => recipes[id]).sort();
fs.writeFileSync(INDEX, `${JSON.stringify(index)}\n`);
console.log(report.join('\n'));
console.log(`\n${index.length}/${Object.keys(recipes).length} icônes embarquées`);
