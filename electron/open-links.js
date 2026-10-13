// ---------------------------------------------------------------------------
// Liens et fichiers ouverts DEPUIS L'EXTÉRIEUR d'Orbit.
//
// Quand l'utilisateur choisit Orbit dans la liste « Ouvrir avec » de son
// système (ou double-clique un .html associé, ou glisse un lien sur l'icône),
// c'est le SYSTÈME qui lance le programme — avec l'URL ou le CHEMIN DU FICHIER
// en argument de ligne de commande. Sur macOS, la même information arrive par
// l'événement `open-url`.
//
// Ce module ne garde QUE ce qu'on sait ouvrir, et il est PUR (aucune
// dépendance à Electron) : la décision « qu'est-ce qu'un lien ouvrable ? » est
// celle qui, si elle est fausse, ouvre n'importe quoi — elle se teste donc sous
// `node --test`, comme shields-rules.js.
// ---------------------------------------------------------------------------
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Adresse web. Volontairement strict : http/https seulement — ni javascript:,
// ni mailto:, ni chrome:// (une page volante les chargerait dans un <webview>).
const WEB_LINK = /^https?:\/\/[^\s]+$/i;

// Extensions considérées comme des pages : ouvrir un .pdf ou un .zip « comme un
// document » n'aurait aucun sens ici (Orbit n'est pas une visionneuse).
export const PAGE_EXTENSIONS = new Set(['.html', '.htm', '.xhtml']);

export function isWebLink(value) {
  return WEB_LINK.test(String(value || '').trim());
}

const pageExtension = (p) => PAGE_EXTENSIONS.has(path.extname(String(p || '')).toLowerCase());

// Transforme UN argument en lien ouvrable, ou null.
//   { kind: 'url'  | 'file', url, path? }
// `cwd` : répertoire de travail du processus (les systèmes passent souvent un
// chemin relatif ; on le résout avant de le convertir en URL `file:`).
export function toOpenable(arg, { cwd = process.cwd() } = {}) {
  let raw = String(arg ?? '').trim();
  if (!raw) return null;
  // Certaines entrées de bureau citent le chemin : « "C:\Dossier\page.html" ».
  if (raw.length > 1 && raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);

  if (WEB_LINK.test(raw)) return { kind: 'url', url: raw };

  if (/^file:/i.test(raw)) {
    try {
      const u = new URL(raw);
      if (!pageExtension(u.pathname)) return null;
      return { kind: 'file', url: u.href, path: decodeURIComponent(u.pathname) };
    } catch {
      return null;
    }
  }

  // Un chemin local : c'est ce que le système passe pour un fichier associé.
  if (!pageExtension(raw)) return null;
  const abs = path.resolve(cwd, raw);
  return { kind: 'file', url: pathToFileURL(abs).href, path: abs };
}

// Arguments de la ligne de commande → liens ouvrables, sans doublon.
// `ignore` : URL à ne pas traiter (le serveur de dev en mode développement).
export function extractOpenables(argv, { cwd = process.cwd(), ignore = [] } = {}) {
  const skip = new Set((ignore || []).filter(Boolean));
  const out = [];
  const seen = new Set();
  for (const arg of argv || []) {
    const item = toOpenable(arg, { cwd });
    if (!item || skip.has(item.url) || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}
