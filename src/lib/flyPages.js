// ---------------------------------------------------------------------------
// Pages volantes : construction d'une page — LOGIQUE PURE, sans zustand.
//
// Une page volante est un « lien libre » : une adresse de passage, ou un
// document local ouvert via « Ouvrir avec ». Elle n'appartient à aucun profil,
// ne touche à aucun compte, et disparaît à la fermeture.
//
// Ce module ne décide QUE de la forme de l'objet (nom affiché, icône, couleur,
// nature, partition jetable). Le magasin garde ce qui lui revient : savoir si
// la page existe déjà, la rendre active, purger sa session à la fermeture.
//
// Vit ici, et pas dans le magasin, pour être vérifiable sans `node_modules` :
// zustand n'est pas installé pendant `npm test` (contrainte du projet). C'est
// aussi la partie où une erreur est la plus visible — une icône ou une nature
// fausse envoie le document au mauvais moteur d'affichage.
// ---------------------------------------------------------------------------
import { KIND } from './fileTypes.js';

// Apparence par nature de document. Le globe est réservé aux adresses web :
// un fichier local reste un document, même quand c'est du HTML.
export const FLY_PAGE_LOOKS = {
  page: { icon: '🌐', color: '#64748b' },
  markdown: { icon: '📝', color: '#8b5cf6' },
  json: { icon: '🧾', color: '#f59e0b' },
  csv: { icon: '📊', color: '#10b981' },
  code: { icon: '💻', color: '#06b6d4' },
  text: { icon: '📄', color: '#64748b' },
  pdf: { icon: '📕', color: '#ef4444' },
  image: { icon: '🖼️', color: '#0ea5e9' },
  media: { icon: '🎬', color: '#f97316' },
};

export function flyPageIcon(target, isPrivate) {
  if (isPrivate) return '🕶️';
  // Une page HTML LOCALE est un document, pas un site.
  if (target.local && target.kind === KIND.page) return '📄';
  return FLY_PAGE_LOOKS[target.kind]?.icon || (target.local ? '📄' : '🌐');
}

export function flyPageColor(target, isPrivate) {
  if (isPrivate) return '#7c3aed';
  return FLY_PAGE_LOOKS[target.kind]?.color || '#64748b';
}

// `target` vient de `flyPageTarget()` (lib/urls.js) : { url, name, kind, local }.
export function buildFlyPage({ id, target, isPrivate = false, filePath = null, order = 0, now = Date.now() }) {
  const prefix = isPrivate ? 'priv' : 'fly';
  return {
    id,
    // Portée « tous les profils » : une page volante n'est pas une
    // application, elle n'appartient à aucun profil. La montrer dans chaque
    // profil est la seule chose cohérente — sinon basculer de profil faisait
    // disparaître une page qu'on est en train de lire.
    scope: 'all',
    // Partition jetable, distincte de toute app : consulter un lien ne doit
    // pas toucher aux cookies d'un compte connecté.
    sessionKey: `${prefix}:${id}`,
    ephemeral: true,
    private: isPrivate,
    // NATURE du document : elle décide de l'affichage — visionneuse Orbit pour
    // les formats texte, <webview> pour le reste.
    kind: target.kind,
    // Chemin réel d'un fichier local (null pour une adresse web).
    filePath: target.local ? filePath || null : null,
    name: target.name,
    url: target.url,
    homeUrl: target.url,
    icon: flyPageIcon(target, isPrivate),
    color: flyPageColor(target, isPrivate),
    unread: 0,
    sleeping: false,
    zoom: 1,
    order,
    createdAt: now,
  };
}

// Nom AFFICHÉ dans la barre latérale.
//
// Une page volante n'a pas de nom choisi par l'utilisateur : `name` n'est que
// le domaine (ou le fichier), calculé avant tout chargement. Dès que le moteur
// connaît le titre de la page (`page-title-updated`, déjà enregistré dans
// `title`), c'est lui qu'on montre — comme un onglet de navigateur. Un
// document local, lui, garde son nom de fichier : le titre de son contenu
// (« Rapport annuel ») ne dit pas quel fichier est ouvert.
export function flyPageLabel(page) {
  const name = String(page?.name || '').trim();
  if (!page?.ephemeral || page.filePath) return name;
  const title = String(page?.title || '').replace(/\s+/g, ' ').trim();
  return title || name;
}

// Identifiant d'une page volante.
//
// L'horodatage ne suffit PAS : le système peut passer plusieurs fichiers d'un
// coup dans les arguments de lancement, donc plusieurs pages naissent dans la
// même milliseconde. Deux pages de même identifiant se fermeraient ensemble,
// casseraient les clés React et doubleraient les lignes du menu — d'où le
// compteur, que l'appelant fait avancer.
export function flyPageId(isPrivate, seq, now = Date.now()) {
  return `${isPrivate ? 'priv' : 'fly'}-${now}-${seq}`;
}
