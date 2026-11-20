// ---------------------------------------------------------------------------
// Rafraîchit le catalogue de raccourcis de recherche (« bangs ») livré avec
// Orbit.
//
//   node scripts/update-bangs.js     # écrit src/lib/bangsData.js
//
// Source : https://services.helium.imput.net/bangs.json (Helium, dérivé de la
// liste de Kagi — licence MIT, reproduite dans le fichier généré). Chaque
// entrée est vérifiée et compactée par src/lib/bangs.js : https uniquement,
// un seul emplacement pour les termes, raccourcis lisibles par la palette.
//
// Le fichier produit est un module JavaScript et non un .json : Vite le
// découpe en morceau séparé (chargé seulement quand on tape « @ »), et
// `node --test` peut le lire sans attribut d'import.
// ---------------------------------------------------------------------------
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBangsSource, compactBangs } from '../src/lib/bangs.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'lib', 'bangsData.js');
const SOURCE = 'https://services.helium.imput.net/bangs.json';

// En dessous, la source est sans doute tronquée ou cassée : on garde
// l'instantané précédent plutôt que d'en livrer un vide.
const MIN_ENTRIES = 5000;

async function main() {
  const res = await fetch(SOURCE, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`la source a répondu ${res.status}`);
  const text = await res.text();
  const generated = (text.match(/Generated at (\S+)/) || [])[1] || '';
  const data = compactBangs(parseBangsSource(text));
  if (data.length < MIN_ENTRIES) {
    throw new Error(`seulement ${data.length} raccourcis valides — instantané conservé`);
  }

  const lines = data.map((entry) => `  ${JSON.stringify(entry)},`).join('\n');
  const content = `// ---------------------------------------------------------------------------
// CATALOGUE DE RACCOURCIS DE RECHERCHE — fichier GÉNÉRÉ, ne pas éditer.
//
// Régénéré par \`node scripts/update-bangs.js\`. Format : [nom, url, [raccourcis]]
// (voir src/lib/bangs.js). Source : ${SOURCE}
// (relevé ${generated || 'sans date'}).
//
// MIT License — Copyright (c) 2024 Kagi Search, 2026 imput
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// ---------------------------------------------------------------------------
export const BANGS_GENERATED_AT = ${JSON.stringify(generated)};

export const BANGS = [
${lines}
];
`;
  await writeFile(OUT, content);
  console.log(`[bangs] ${data.length} raccourcis écrits dans ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error('[bangs] échec :', err.message);
  process.exit(1);
});
