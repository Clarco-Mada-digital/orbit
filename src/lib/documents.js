// ---------------------------------------------------------------------------
// Lecture des documents texte — LOGIQUE PURE (CSV/TSV, JSON, statistiques,
// détection de contenu binaire).
//
// Ces fonctions tournent dans l'interface ET (pour la détection binaire) dans
// le processus principal, qui refuse de servir un fichier binaire à la
// visionneuse : afficher 4 Mo de NUL ne rend service à personne.
// ---------------------------------------------------------------------------

// Détection d'un contenu binaire déguisé en texte. Deux signaux, dans cet
// ordre : un octet NUL (jamais légitime dans du texte) ou une proportion
// élevée de caractères de contrôle. On ne se fie PAS à l'extension : un .txt
// peut très bien être une image renommée.
export function hasBinaryContent(text) {
  const s = String(text || '');
  if (!s) return false;
  if (s.includes('\u0000')) return true;
  // On échantillonne : inutile de parcourir 4 Mo pour trancher.
  const sample = s.length > 20000 ? s.slice(0, 20000) : s;
  let control = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    // Tabulation, saut de ligne et retour chariot sont du texte normal.
    if (code === 9 || code === 10 || code === 13) continue;
    // Caractères de remplacement (décodage raté) et de contrôle bas.
    if (code === 0xfffd || (code < 32 && code > 0)) control += 1;
  }
  return control / sample.length > 0.02;
}

// Sépare une ligne CSV en respectant les guillemets (le séparateur à
// l'intérieur d'un champ cité ne coupe pas la cellule, et « "" » = un
// guillemet littéral).
function splitRow(line, delimiter) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

// Délimiteur le plus probable : celui qui découpe le plus de colonnes sur la
// première ligne non vide. Tabulation prioritaire en cas d'égalité (un .tsv
// qui contient aussi des virgules reste un .tsv).
export function detectDelimiter(text) {
  const first = String(text || '')
    .split('\n')
    .find((l) => l.trim() !== '');
  if (!first) return ',';
  const counts = [
    ['\t', (first.match(/\t/g) || []).length],
    [',', (first.match(/,/g) || []).length],
    [';', (first.match(/;/g) || []).length],
    ['|', (first.match(/\|/g) || []).length],
  ].sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

// Grille de cellules + délimiteur retenu. Les lignes vides de fin sont
// ignorées (un fichier exporté se termine presque toujours par un saut).
export function parseDelimited(text, { delimiter, maxRows = 2000 } = {}) {
  const sep = delimiter || detectDelimiter(text);
  const lines = String(text || '').split(/\r?\n/);
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const truncated = lines.length > maxRows;
  const rows = lines.slice(0, maxRows).map((line) => splitRow(line, sep));
  const columns = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return { rows, delimiter: sep, columns, truncated };
}

// Indentation d'un JSON valide ; en cas d'erreur on renvoie le message plutôt
// qu'une exception — un JSON tronqué est fréquent et n'est pas un bug.
export function prettyJson(text) {
  const raw = String(text || '');
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(raw), null, 2) };
  } catch (err) {
    return { ok: false, text: raw, error: String(err?.message || err) };
  }
}

// Statistiques affichées dans l'en-tête de la visionneuse. `bytes` vient du
// processus principal (taille réelle sur disque ou sur le réseau), pas d'ici.
export function textStats(text) {
  const s = String(text || '');
  return {
    lines: s ? s.split('\n').length : 0,
    words: (s.match(/\S+/g) || []).length,
    chars: s.length,
  };
}

// Taille lisible (« 1,2 Mo »). `formatBytes` vit ici parce que la visionneuse
// et la fenêtre principale l'affichent toutes les deux.
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}
