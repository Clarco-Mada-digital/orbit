// ---------------------------------------------------------------------------
// Recherche transverse — LOGIQUE PURE, aucune dépendance.
//
// Alt+K sait retrouver une app par son nom. Il lui manquait « cette page vue
// hier », quand on ne sait plus DANS QUELLE app on l'a ouverte. Ce module
// classe deux sources :
//   • les pages OUVERTES en ce moment (titre courant de chaque webview)
//   • l'HISTORIQUE de navigation de toutes les apps
//
// Le classement n'est pas un simple « contient » : sur un historique de
// plusieurs centaines d'entrées, tout se ressemble. On combine donc la qualité
// de la correspondance (début de mot > milieu), la fraîcheur et le nombre de
// visites — c'est ce qui fait remonter la bonne page en premier.
// ---------------------------------------------------------------------------

import { isLoginPageUrl, isTokenUrl } from './urls.js';

// Faut-il consigner cette page dans l'historique ?
//
// Vit ici plutôt que dans historyStore.js pour rester importable sans zustand
// (la suite de tests du projet tourne sans `node_modules`). C'est aussi un
// garde-fou de confidentialité : ce que cette fonction laisse passer finit
// écrit en clair dans le stockage local.
export function shouldRecord(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  // Pages de connexion : sans intérêt à retrouver, et souvent porteuses de
  // jetons à usage unique.
  if (isLoginPageUrl(url)) return false;
  // URL à jeton : les écrire en clair serait une fuite, et elles seront
  // périmées de toute façon.
  if (isTokenUrl(url)) return false;
  return true;
}

// Retire accents et casse : « Réunion » doit se trouver en tapant « reunion ».
export function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Hôte lisible d'une URL (sans « www. »), pour l'affichage et la recherche.
export function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Qualité d'une correspondance, de 0 (absente) à 1 (exacte).
// L'échelle est volontairement grossière : elle sert à départager, pas à
// mesurer finement.
export function matchScore(haystack, needle) {
  if (!needle) return 0;
  const h = normalize(haystack);
  const n = normalize(needle);
  if (!h || !n) return 0;
  const at = h.indexOf(n);
  if (at === -1) return 0;
  if (h === n) return 1; // égalité parfaite
  if (at === 0) return 0.9; // commence par le terme
  // Début d'un mot (après espace, tiret, slash, point) : bien meilleur qu'un
  // fragment perdu au milieu d'un identifiant.
  if (/[\s\-_/.]/.test(h[at - 1])) return 0.75;
  return 0.5;
}

// Décroissance de fraîcheur : 1 aujourd'hui, ~0.5 après une semaine, ~0.2
// après un mois. Une page vue il y a une heure doit battre la même page vue
// il y a trois semaines.
const WEEK = 7 * 24 * 3600 * 1000;
export function recencyScore(at, now = Date.now()) {
  if (!at) return 0;
  const age = Math.max(0, now - at);
  return 1 / (1 + age / WEEK);
}

// Score final d'une entrée d'historique.
// Le titre pèse plus que l'URL : on se souvient d'un intitulé, rarement d'un
// chemin. Les visites répétées sont plafonnées pour qu'un site consulté cent
// fois n'écrase pas une page pertinente vue deux fois.
export function scoreEntry(entry, query, now = Date.now()) {
  const title = matchScore(entry.title, query);
  const url = matchScore(entry.url, query);
  const host = matchScore(hostLabel(entry.url), query);
  const best = Math.max(title, url * 0.8, host * 0.85);
  if (best === 0) return 0;

  const visits = Math.min(entry.visits || 1, 10) / 10;
  return best * 0.65 + recencyScore(entry.at, now) * 0.25 + visits * 0.1;
}

// Plusieurs entrées peuvent pointer la même page (rechargements, ancres
// différentes). On ne garde que la plus récente, en cumulant les visites —
// sinon la liste de résultats se remplit de dix fois la même chose.
export function dedupe(entries) {
  const byUrl = new Map();
  for (const e of entries) {
    if (!e || !e.url) continue;
    const key = e.url;
    const prev = byUrl.get(key);
    if (!prev) {
      byUrl.set(key, { ...e });
    } else {
      prev.visits = (prev.visits || 1) + (e.visits || 1);
      if ((e.at || 0) > (prev.at || 0)) {
        prev.at = e.at;
        prev.title = e.title || prev.title;
        prev.appId = e.appId;
      }
    }
  }
  return [...byUrl.values()];
}

// Recherche dans l'historique. `limit` borne l'affichage : au-delà de quelques
// résultats la palette devient illisible.
export function searchHistory(entries, query, { limit = 6, now = Date.now() } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return []; // une seule lettre ramènerait tout
  return dedupe(entries || [])
    .map((e) => ({ entry: e, score: scoreEntry(e, q, now) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (b.entry.at || 0) - (a.entry.at || 0))
    .slice(0, limit)
    .map((r) => r.entry);
}

// Pages ouvertes en ce moment : on cherche dans le TITRE courant de chaque app,
// pas seulement dans son nom. C'est ce qui permet de retrouver « la facture »
// ouverte dans un onglet Drive dont le nom d'app est juste « Drive ».
//
// Les apps dont le nom correspond déjà sont écartées : la palette les propose
// dans sa section « applications », les répéter ici ferait doublon.
export function searchOpenPages(apps, query, { limit = 5 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  return (apps || [])
    .filter((a) => a && a.title && !a.sleeping)
    .filter((a) => matchScore(a.name, q) === 0)
    .map((a) => ({ app: a, score: Math.max(matchScore(a.title, q), matchScore(a.url, q) * 0.8) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.app);
}
