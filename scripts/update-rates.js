// ---------------------------------------------------------------------------
// Rafraîchit l'instantané des taux de change livré avec Orbit.
//
//   node scripts/update-rates.js            # écrit src/lib/ratesSnapshot.js
//   node scripts/update-rates.js --check    # sort en erreur si dépassé (CI)
//
// L'application n'utilise cet instantané QU'EN DERNIER RECOURS : réseau frais,
// puis cache local (même périmé), puis ces valeurs. Il doit donc être le plus
// récent possible sans jamais prétendre l'être : la date est écrite avec lui,
// et c'est elle que la palette affiche.
//
// Aucune clé, aucun compte : open.er-api.com rend les taux base USD. Le fichier
// produit est un module JavaScript et non un .json pour être également lisible
// par `node --test` sans attribut d'import.
// ---------------------------------------------------------------------------
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'lib', 'ratesSnapshot.js');
const URL_RATES = 'https://open.er-api.com/v6/latest/USD';

const check = process.argv.includes('--check');

async function main() {
  const res = await fetch(URL_RATES, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`l'API a répondu ${res.status}`);
  const json = await res.json();
  if (!json || json.result !== 'success' || !json.rates) {
    throw new Error('réponse inattendue de l’API');
  }

  // La date vient de l'API, pas de l'horloge locale : c'est la date DU RELEVÉ.
  const at = Number.isFinite(json.time_last_update_unix)
    ? new Date(json.time_last_update_unix * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // Taux triés : un diff ne bouge que là où un taux a bougé.
  const rates = {};
  for (const code of Object.keys(json.rates).sort()) {
    const v = json.rates[code];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) rates[code] = v;
  }

  const content = `// ---------------------------------------------------------------------------
// INSTANTANÉ DES TAUX DE CHANGE — fichier GÉNÉRÉ, ne pas éditer à la main.
//
// Régénéré par \`node scripts/update-rates.js\` (et chaque jour par
// .github/workflows/rates.yml). Base USD, comme l'API.
//
// Utilisé seulement si ni le réseau ni le cache local ne répondent : c'est ce
// qui permet à « 100 eur en mga » de fonctionner dès la première ouverture,
// hors ligne. La date ci-dessous est celle du relevé, et la palette l'affiche.
// ---------------------------------------------------------------------------
export const RATES_SNAPSHOT = {
  at: '${at}',
  base: 'USD',
  rates: ${JSON.stringify(rates, null, 2).replace(/\n/g, '\n  ')},
};
`;

  // `--check` : on compare au relevé actuel, sans réécrire le fichier.
  if (check) {
    const current = await readFile(OUT, 'utf8').catch(() => '');
    if (!current.includes(`at: '${at}'`)) {
      console.error(`Instantané périmé : le relevé du ${at} n'est pas encore embarqué.`);
      process.exit(1);
    }
    console.log(`Instantané à jour (${at}).`);
    return;
  }

  await writeFile(OUT, content, 'utf8');
  const count = Object.keys(rates).length;
  console.log(`${count} devise(s) — relevé du ${at} → src/lib/ratesSnapshot.js`);
}

main().catch((err) => {
  console.error(`Échec : ${err.message}`);
  process.exit(1);
});
