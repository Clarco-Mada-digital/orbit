// QR Code Generator — encodeur QR minimaliste 100 % local (aucune dépendance,
// aucune requête réseau).
//
// Implémentation compacte et fidèle à l'algorithme standard (ISO/IEC 18004) :
// - Mode BYTE (UTF-8), versions 1→6, correction d'erreur L
//   (capacité max 134 caractères — largement suffisant pour des URLs ;
//   au-delà, une erreur explicite est levée).
// - Reed-Solomon sur GF(256). v1-v5 : 1 bloc ; v6 : 2 blocs entrelacés
//   (structure de blocs conforme à la table standard du niveau L).
// - Masque choisi automatiquement (règles de pénalité N1-N4).
//
// API : window.OrbitQR.generate(text) → { size, get(x,y), toCanvas(canvas, scale, dark, light) }
// ---------------------------------------------------------------------------

(() => {
  'use strict';

  // ── Corps de Galois GF(256) (polynôme primitif 0x11d) ──────────────────────

  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  // ── Reed-Solomon ───────────────────────────────────────────────────────────

  // Polynôme générateur de degré n (coeffs : index 0 = degré le plus haut)
  function rsGenPoly(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        ng[j] ^= g[j]; // × x
        ng[j + 1] ^= gmul(g[j], EXP[i]); // × (x + α^i)
      }
      g = ng;
    }
    return g;
  }

  function rsEncode(dataWords, ecLen) {
    const g = rsGenPoly(ecLen);
    const res = new Uint8Array(ecLen);
    for (const b of dataWords) {
      const factor = b ^ res[0];
      res.copyWithin(0, 1);
      res[ecLen - 1] = 0;
      if (factor) {
        for (let i = 0; i < ecLen; i++) res[i] ^= gmul(g[i + 1], factor);
      }
    }
    return res;
  }

  // ── Tables par version (1..6, niveau L) ────────────────────────────────────

  const DATA_WORDS = [19, 34, 55, 80, 108, 136]; // codewords de données (total)
  const EC_PER_BLOCK = [7, 10, 15, 20, 26, 18]; // codewords EC PAR bloc
  const NUM_BLOCKS = [1, 1, 1, 1, 1, 2]; // nombre de blocs (v6-L = 2 blocs)
  const DATA_PER_BLOCK = [19, 34, 55, 80, 108, 68]; // data par bloc
  const BYTE_CAP = [17, 32, 53, 78, 106, 134]; // capacité octets (byte mode, L)
  const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]]; // centres alignement

  // ── Encodage des données ───────────────────────────────────────────────────

  function encodeData(text) {
    const bytes = new TextEncoder().encode(String(text));
    let ver = -1;
    for (let v = 1; v <= 6; v++) {
      if (bytes.length <= BYTE_CAP[v - 1]) { ver = v; break; }
    }
    if (ver < 0) {
      throw new Error('Texte trop long pour un QR (max 134 caractères en niveau L).');
    }

    const bits = [];
    const push = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    };

    push(4, 4); // mode BYTE
    push(bytes.length, 8); // nombre de caractères (v1-9 : 8 bits)
    for (const b of bytes) push(b, 8);

    const maxBits = DATA_WORDS[ver - 1] * 8;
    push(0, Math.min(4, maxBits - bits.length)); // terminateur
    while (bits.length % 8) bits.push(0); // octet aligné

    // Remplissage 0xEC / 0x11 alternés
    const words = [];
    let bi = 0;
    let pad = 0;
    for (let i = 0; i < DATA_WORDS[ver - 1]; i++) {
      if (bi + 8 <= bits.length) {
        let w = 0;
        for (let j = 0; j < 8; j++) w = (w << 1) | bits[bi++];
        words.push(w);
      } else {
        words.push(pad++ % 2 ? 0x11 : 0xec);
      }
    }

    // Reed-Solomon PAR bloc + entrelacement (v6 : 2 blocs de 68+18 ; v1-5 : 1 bloc)
    const nb = NUM_BLOCKS[ver - 1];
    const dpb = DATA_PER_BLOCK[ver - 1];
    const ecl = EC_PER_BLOCK[ver - 1];
    const dataBlocks = [];
    const ecBlocks = [];
    for (let b = 0; b < nb; b++) {
      const blk = words.slice(b * dpb, (b + 1) * dpb);
      dataBlocks.push(blk);
      ecBlocks.push(rsEncode(blk, ecl));
    }
    // Entrelacement des données puis des EC (identité pour 1 bloc)
    const final = [];
    for (let i = 0; i < dpb; i++) {
      for (const blk of dataBlocks) final.push(blk[i]);
    }
    for (let i = 0; i < ecl; i++) {
      for (const blk of ecBlocks) final.push(blk[i]);
    }
    return { ver, words: final };
  }

  // ── Construction de la matrice ─────────────────────────────────────────────

  function buildMatrix(ver, words, maskId) {
    const size = 17 + 4 * ver;
    const m = Array.from({ length: size }, () => new Uint8Array(size));
    const reserved = Array.from({ length: size }, () => new Uint8Array(size));

    const set = (x, y, v) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      m[y][x] = v ? 1 : 0;
    };
    const reserve = (x, y) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      reserved[y][x] = 1;
    };

    // Motifs de recherche (finders) + séparateurs
    const drawFinder = (ox, oy) => {
      for (let dy = -1; dy <= 7; dy++) {
        for (let dx = -1; dx <= 7; dx++) {
          const x = ox + dx, y = oy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const inRing =
            dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 &&
            (dx === 0 || dx === 6 || dy === 0 || dy === 6);
          const inCore = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
          set(x, y, inRing || inCore ? 1 : 0);
          reserve(x, y);
        }
      }
    };
    drawFinder(0, 0);
    drawFinder(size - 7, 0);
    drawFinder(0, size - 7);

    // Motifs de synchronisation (timing)
    for (let i = 8; i < size - 8; i++) {
      const v = i % 2 === 0 ? 1 : 0;
      set(i, 6, v); reserve(i, 6);
      set(6, i, v); reserve(6, i);
    }

    // Motifs d'alignement (v2+)
    const centers = ALIGN[ver - 1];
    for (const cy of centers) {
      for (const cx of centers) {
        // Pas dans les coins occupés par les finders
        if (
          (cx <= 8 && cy <= 8) ||
          (cx >= size - 9 && cy <= 8) ||
          (cx <= 8 && cy >= size - 9)
        ) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const inRing = Math.abs(dx) === 2 || Math.abs(dy) === 2;
            const inCore = dx === 0 && dy === 0;
            set(cx + dx, cy + dy, inRing || inCore ? 1 : 0);
            reserve(cx + dx, cy + dy);
          }
        }
      }
    }

    // Zone des informations de format
    for (let i = 0; i < 9; i++) { reserve(i, 8); reserve(8, i); }
    for (let i = 0; i < 8; i++) { reserve(size - 1 - i, 8); reserve(8, size - 1 - i); }

    // Module sombre fixe
    set(8, size - 8, 1); reserve(8, size - 8);

    // Informations de format (niveau L = 01, masque)
    const fmt = (() => {
      const data = (1 << 3) | maskId; // bits format : EC(L)=01, masque
      let rem = data << 10;
      const g = 0b10100110111;
      for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= g << (i - 10);
      return ((data << 10) | rem) ^ 0b101010000010010;
    })();
    const fbit = (i) => (fmt >> i) & 1;
    for (let i = 0; i <= 5; i++) { set(8, i, fbit(i)); set(i, 8, fbit(14 - i)); }
    set(8, 7, fbit(6)); set(8, 8, fbit(7)); set(7, 8, fbit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, fbit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, fbit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, fbit(i));

    // Placement des données en zigzag (2 colonnes à la fois, en évitant la col. 6)
    let bitIdx = 0;
    const totalBits = words.length * 8;
    const bitAt = (i) => (i < totalBits ? (words[i >> 3] >> (7 - (i & 7))) & 1 : 0);

    let col = size - 1;
    let upward = true;
    while (col > 0) {
      if (col === 6) col--; // colonne de timing : sautée
      for (let i = 0; i < size; i++) {
        const y = upward ? size - 1 - i : i;
        for (const c of [col, col - 1]) {
          if (reserved[y][c]) continue;
          const bit = bitAt(bitIdx++);
          let v = bit;
          // Application du masque
          if (maskBit(maskId, c, y)) v = bit ? 0 : 1;
          set(c, y, v);
        }
      }
      upward = !upward;
      col -= 2;
    }

    return m;
  }

  function maskBit(id, x, y) {
    switch (id) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return false;
    }
  }

  // ── Pénalités (choix du masque) ────────────────────────────────────────────

  function penalty(m) {
    const size = m.length;
    let score = 0;

    // N1 : séries de 5+ modules identiques (lignes + colonnes)
    const runs = (line) => {
      let s = 0;
      let run = 1;
      for (let i = 1; i < line.length; i++) {
        if (line[i] === line[i - 1]) run++;
        else { if (run >= 5) s += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) s += 3 + (run - 5);
      return s;
    };
    for (let y = 0; y < size; y++) score += runs(m[y]);
    for (let x = 0; x < size; x++) {
      const col = m.map((row) => row[x]);
      score += runs(col);
    }

    // N2 : blocs 2×2 uniformes
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const v = m[y][x];
        if (m[y][x + 1] === v && m[y + 1][x] === v && m[y + 1][x + 1] === v) score += 3;
      }
    }

    // N3 : motifs type « 1011101 » avec 4 modules clairs d'un côté
    const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const match = (line) => {
      let s = 0;
      for (let i = 0; i + 11 <= line.length; i++) {
        let ok1 = true, ok2 = true;
        for (let j = 0; j < 11; j++) {
          if (line[i + j] !== P1[j]) ok1 = false;
          if (line[i + j] !== P2[j]) ok2 = false;
        }
        if (ok1 || ok2) s += 40;
      }
      return s;
    };
    for (let y = 0; y < size; y++) score += match(m[y]);
    for (let x = 0; x < size; x++) score += match(m.map((row) => row[x]));

    // N4 : proportion de modules sombres
    let dark = 0;
    for (const row of m) for (const v of row) dark += v;
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
  }

  // ── API publique ───────────────────────────────────────────────────────────

  function generate(text) {
    const { ver, words } = encodeData(text);
    let best = null;
    let bestScore = Infinity;
    let bestMask = 0;
    for (let mask = 0; mask < 8; mask++) {
      const m = buildMatrix(ver, words, mask);
      const s = penalty(m);
      if (s < bestScore) { bestScore = s; best = m; bestMask = mask; }
    }

    const size = best.length;
    return {
      size,
      mask: bestMask,
      version: ver,
      get: (x, y) => !!best[y][x],
      toCanvas(canvas, scale = 8, dark = '#111827', light = '#ffffff') {
        canvas.width = size * scale;
        canvas.height = size * scale;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = light;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = dark;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            if (best[y][x]) ctx.fillRect(x * scale, y * scale, scale, scale);
          }
        }
        return canvas;
      },
    };
  }

  window.OrbitQR = { generate };
})();
