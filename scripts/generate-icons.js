// Génère l'icône Orbit (PNG multi-tailles, ICO, SVG) SANS dépendance externe.
// Le logo est rasterisé en pur JavaScript (le même design que OrbitLogo.jsx),
// puis encodé en PNG via zlib + CRC32, et emballé en .ico (PNG-embedded).
//
// Usage : node scripts/generate-icons.js
import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Rasterisation du logo (espace 64×64, supersampling pour l'anti-aliasing)
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function renderLogo(size, ss = 4) {
  const big = size * ss;
  const buf = Buffer.alloc(big * big * 4);

  const S = 64; // système de coordonnées du logo
  const cx = 32, cy = 32, half = 31, rectRadius = 14;
  const ringR = 20, ringW = 2.6, ringAlpha = 0.92;
  const planetR = 5;
  const satX = 48.4, satY = 20.5, satR = 6.2;

  const gradC1 = [99, 102, 241]; // #6366f1 (haut-gauche)
  const gradC2 = [139, 92, 246]; // #8b5cf6 (bas-droite)
  const white = [255, 255, 255];
  const satColor = [199, 210, 254]; // #c7d2fe

  for (let py = 0; py < big; py++) {
    for (let px = 0; px < big; px++) {
      const x = ((px + 0.5) / big) * S;
      const y = ((py + 0.5) / big) * S;

      let r = 0, g = 0, b = 0, a = 0;

      // 1) Fond : rectangle arrondi en dégradé
      const qx = Math.abs(x - cx) - (half - rectRadius);
      const qy = Math.abs(y - cy) - (half - rectRadius);
      const outside =
        Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
        Math.min(Math.max(qx, qy), 0) -
        rectRadius;
      if (outside <= 0) {
        const t = (x + y) / (2 * S);
        r = gradC1[0] + (gradC2[0] - gradC1[0]) * t;
        g = gradC1[1] + (gradC2[1] - gradC1[1]) * t;
        b = gradC1[2] + (gradC2[2] - gradC1[2]) * t;
        a = 1;
      }

      const blend = (cr, cg, cb, ca) => {
        const na = ca + a * (1 - ca);
        if (na <= 0) return;
        r = (cr * ca + r * a * (1 - ca)) / na;
        g = (cg * ca + g * a * (1 - ca)) / na;
        b = (cb * ca + b * a * (1 - ca)) / na;
        a = na;
      };

      // 2) Anneau orbital (blanc semi-transparent)
      const dRing = Math.hypot(x - cx, y - cy);
      if (Math.abs(dRing - ringR) <= ringW / 2) {
        blend(white[0], white[1], white[2], ringAlpha);
      }

      // 3) Planète centrale
      if (Math.hypot(x - cx, y - cy) <= planetR) {
        blend(white[0], white[1], white[2], 1);
      }

      // 4) Satellite
      if (Math.hypot(x - satX, y - satY) <= satR) {
        blend(satColor[0], satColor[1], satColor[2], 1);
      }

      const i = (py * big + px) * 4;
      buf[i] = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = Math.round(a * 255);
    }
  }

  // Downsample (moyenne des blocs ss×ss) → anti-aliasing
  const out = Buffer.alloc(size * size * 4);
  const ss2 = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * big + (x * ss + sx)) * 4;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
          a += buf[i + 3];
        }
      }
      const j = (y * size + x) * 4;
      out[j] = Math.round(r / ss2);
      out[j + 1] = Math.round(g / ss2);
      out[j + 2] = Math.round(b / ss2);
      out[j + 3] = Math.round(a / ss2);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Encodeur PNG minimal (RGBA, 8 bits)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // couleur : RGBA
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0; // filtre "None"
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// Encodeur ICO (images PNG embarquées — compatible Windows Vista+)
// ---------------------------------------------------------------------------

function encodeICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // réservé
  header.writeUInt16LE(1, 2); // type : icône
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  const blobs = [];
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0; // palette
    e[3] = 0; // réservé
    e.writeUInt16LE(1, 4); // plans
    e.writeUInt16LE(32, 6); // bits par pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    blobs.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

// ---------------------------------------------------------------------------
// SVG source (même design que le composant React)
// ---------------------------------------------------------------------------

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512">
  <defs>
    <linearGradient id="orbit-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="62" height="62" rx="14" fill="url(#orbit-bg)"/>
  <circle cx="32" cy="32" r="20" fill="none" stroke="rgba(255,255,255,0.92)" stroke-width="2.6"/>
  <circle cx="32" cy="32" r="5" fill="#ffffff"/>
  <circle cx="48.4" cy="20.5" r="6.2" fill="#c7d2fe"/>
</svg>
`;

// ---------------------------------------------------------------------------
// Génération
// ---------------------------------------------------------------------------

const buildDir = join(ROOT, 'build');
const iconsDir = join(buildDir, 'icons');
const publicIconsDir = join(ROOT, 'public', 'icons');
mkdirSync(iconsDir, { recursive: true });
mkdirSync(publicIconsDir, { recursive: true });

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

console.log('Rasterisation du logo…');
const pngs = new Map();
for (const size of SIZES) {
  pngs.set(size, encodePNG(size, size, renderLogo(size)));
}

console.log('Écriture des fichiers…');
// PNG principal (1024) + PNG multi-tailles
writeFileSync(join(buildDir, 'icon.png'), pngs.get(1024));
for (const size of SIZES) {
  writeFileSync(join(iconsDir, `icon-${size}.png`), pngs.get(size));
}

// Favicons pour le web (index.html)
writeFileSync(join(publicIconsDir, 'icon-16.png'), pngs.get(16));
writeFileSync(join(publicIconsDir, 'icon-32.png'), pngs.get(32));
writeFileSync(join(publicIconsDir, 'icon.svg'), SVG);

// ICO Windows (PNG-embedded)
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ico = encodeICO(
  ICO_SIZES.map((size) => ({
    size,
    png: pngs.get(size) || encodePNG(size, size, renderLogo(size)),
  }))
);
writeFileSync(join(buildDir, 'icon.ico'), ico);

// SVG source
writeFileSync(join(buildDir, 'icon.svg'), SVG);

console.log(`✓ Icônes générées dans ${join('build')} et ${join('public', 'icons')}`);
