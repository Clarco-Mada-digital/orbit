// ---------------------------------------------------------------------------
// Recherche d'identifiants dans la palette (Alt+K) — LOGIQUE PURE.
//
// Le geste le plus fréquent avec un gestionnaire de mots de passe est « copie
// celui de ce site ». Il imposait d'ouvrir les réglages, de trouver l'onglet
// Mots de passe et de dérouler le trousseau. Ce module classe les entrées
// pour que la palette le fasse en deux frappes.
//
// Ce qu'il voit : titre, nom d'utilisateur, URL — la vue « publique » que le
// coffre rend au renderer. Aucun mot de passe n'arrive jamais jusqu'ici, et la
// copie elle-même est faite par le processus principal.
// ---------------------------------------------------------------------------
import { matchScore, normalize, hostLabel } from './historySearch.js';

// Seuil volontaire : en dessous de deux caractères, on n'affiche RIEN. Lister
// les comptes dès l'ouverture de la palette exposerait le contenu du coffre
// sur un écran laissé sans surveillance.
export const MIN_QUERY = 2;

// Le titre pèse plus que l'hôte, qui pèse plus que le nom d'utilisateur :
// taper « amazon » doit remonter l'entrée « Amazon » avant un compte dont
// l'identifiant contient « amazon » par accident.
export function scoreEntry(entry, query) {
  if (!entry) return 0;
  const host = hostLabel(entry.url) || '';
  return Math.max(
    matchScore(entry.title, query),
    matchScore(host, query) * 0.9,
    matchScore(entry.url, query) * 0.7,
    matchScore(entry.username, query) * 0.6
  );
}

export function searchVaultEntries(entries, query, { limit = 4 } = {}) {
  const q = String(query || '').trim();
  if (normalize(q).length < MIN_QUERY) return [];
  return (entries || [])
    .filter((e) => e && e.id)
    .map((entry) => ({ entry, score: scoreEntry(entry, q) }))
    .filter((r) => r.score > 0)
    // À score égal, les favoris d'abord : ce sont les comptes qu'on utilise.
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(Boolean(b.entry.favorite)) - Number(Boolean(a.entry.favorite)) ||
        String(a.entry.title).localeCompare(String(b.entry.title))
    )
    .slice(0, limit)
    .map((r) => r.entry);
}
