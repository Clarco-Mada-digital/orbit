// ---------------------------------------------------------------------------
// Édition d'une prise vidéo — LOGIQUE PURE, sans Electron ni ffmpeg.
//
// Le studio laisse choisir :
//   • une plage à garder (début / fin) ;
//   • des portions à supprimer À L'INTÉRIEUR de cette plage (les « coupes »).
//
// Ce module transforme ce choix en segments à CONSERVER. Le processus
// principal s'en sert pour construire la commande ffmpeg, et l'interface pour
// annoncer la durée finale. Une seule vérité, donc : ce que l'aperçu annonce
// est exactement ce que le fichier contiendra.
// ---------------------------------------------------------------------------

const MIN_SEGMENT = 0.05; // s — en dessous, ffmpeg produit des images isolées

function seconds(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Normalise et fusionne les coupes : deux portions qui se chevauchent (ou se
// touchent) n'en font qu'une. Sans ça, ffmpeg recevrait des segments vides ou
// négatifs, et la vidéo finale sauterait un passage sans prévenir.
export function normalizeCuts(cuts = [], start = 0, end = 0) {
  const list = (Array.isArray(cuts) ? cuts : [])
    .map((cut) => ({
      start: Math.max(start, seconds(cut?.start, start)),
      end: Math.max(start, seconds(cut?.end, start)),
    }))
    // Une coupe doit avoir une durée réelle. `end === 0` signifie « jusqu'à la
    // fin » dans les données brutes : on la garde telle quelle, elle sera
    // bornée par la plage.
    .map((cut) => (end > 0 ? { start: Math.min(cut.start, end), end: Math.min(cut.end, end) } : cut))
    .filter((cut) => cut.end - cut.start > MIN_SEGMENT)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged = [];
  for (const cut of list) {
    const last = merged[merged.length - 1];
    if (last && cut.start <= last.end + MIN_SEGMENT) {
      last.end = Math.max(last.end, cut.end);
    } else {
      merged.push({ ...cut });
    }
  }
  return merged;
}

// Segments de la vidéo d'origine à recopier, dans l'ordre.
// `end` à 0 = jusqu'à la fin connue (`duration` si elle est fournie).
export function keepSegments({ start = 0, end = 0, cuts = [], duration = 0 } = {}) {
  const from = Math.max(0, seconds(start));
  const limit = end > 0 ? Math.max(from, seconds(end)) : Math.max(from, seconds(duration));
  if (!(limit > from)) return [];

  const merged = normalizeCuts(cuts, from, limit);
  const segments = [];
  let cursor = from;
  for (const cut of merged) {
    if (cut.start > cursor + MIN_SEGMENT) {
      segments.push({ start: cursor, end: Math.min(cut.start, limit) });
    }
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < limit - MIN_SEGMENT) segments.push({ start: cursor, end: limit });

  return segments.filter((segment) => segment.end - segment.start > MIN_SEGMENT);
}

// Durée finale annoncée dans l'éditeur. `Infinity` tant que la durée de la
// vidéo n'est pas connue : l'appelant affiche alors les temps bruts.
export function keptDuration(options = {}) {
  return keepSegments(options).reduce((total, segment) => total + (segment.end - segment.start), 0);
}
