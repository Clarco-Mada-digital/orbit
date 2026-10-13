// ---------------------------------------------------------------------------
// Intégration système : proposer Orbit dans la liste « Ouvrir avec ».
//
// Choix assumé : on ne PREND RIEN par défaut. Sur Linux, un bureau décide qui
// ouvre un type de fichier ou un schéma d'URL (`xdg-mime`) ; on se contente d'y
// FIGURER, en déposant une entrée de bureau utilisateur. L'utilisateur garde la
// main : rien ne change tant qu'il n'a pas cliqué, et « retirer » efface
// exactement ce qu'on a posé.
//
//   • Linux   : ~/.local/share/applications/orbit.desktop, avec les types MIME
//               qui nous intéressent. Les paquets livrés déclarent déjà ces
//               types (voir `linux.mimeTypes` dans package.json) — dans ce cas
//               il n'y a RIEN à faire et l'écran de réglages le dit.
//   • macOS   : déclaré dans l'Info.plist du paquet (CFBundleDocumentTypes /
//               CFBundleURLTypes). Le système affiche « Ouvrir avec » de
//               lui-même ; aucune application ne peut s'auto-désigner.
//   • Windows : Windows 10/11 refuse qu'un programme s'inscrive dans « Ouvrir
//               avec » sans devenir gestionnaire par défaut (UserChoice est
//               protégé par une empreinte). On ne touche donc PAS au registre :
//               l'utilisateur passe par « Ouvrir avec → Choisir une autre
//               application », où l'application installée figure.
//
// Ce module ne fait que des opérations FICHIER, sur un dossier passé en
// contexte : il est donc exécutable sous `node --test` (dossier temporaire),
// sans risque de modifier la machine de développement.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

// Nom du fichier que nous déposons (dans le dossier utilisateur).
export const DESKTOP_FILE = 'orbit.desktop';

// Marque qui distingue NOTRE fichier de celui, identique en apparence, d'un
// paquet installé : on n'écrase jamais un fichier qu'on n'a pas écrit.
const MARKER = 'X-Orbit-Managed=true';

// Ce qu'Orbit sait ouvrir : une page HTML locale, et un lien web.
// `x-scheme-handler/*` est la convention freedesktop pour les schémas d'URL.
export const LINUX_MIME_TYPES = [
  'text/html',
  'x-scheme-handler/http',
  'x-scheme-handler/https',
];

// Échappement des arguments d'un Exec de fichier .desktop : chaque argument est
// soit nu, soit entre guillemets doubles ; et « % » doit être doublé, sinon le
// bureau l'interprète comme un champ (%U, %f…) — un chemin contenant « % » est
// rare mais une association qui ne se lance pas est impossible à diagnostiquer.
function execArg(value) {
  const s = String(value || '').replace(/%/g, '%%');
  if (!s) return '';
  return /[\s"'\\<>~|&;$*?#()`]/.test(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
}

// Contenu du fichier .desktop (PUR : les tests le lisent tel quel).
// `%U` = liste d'URL, ce qui couvre AUSSI les fichiers (l'URL d'un fichier est
// un `file:` URL) : un seul chemin de code pour les liens et les .html.
export function desktopEntryText(ctx = {}) {
  const exec = [ctx.execPath, ...(ctx.execArgs || [])].map(execArg).filter(Boolean).join(' ');
  return (
    [
      '[Desktop Entry]',
      'Type=Application',
      'Version=1.0',
      `Name=${ctx.appName || 'Orbit'}`,
      'Comment=Ouvrir des liens et des pages HTML dans Orbit',
      `Exec=${exec} %U`,
      'Terminal=false',
      'Categories=Network;WebBrowser;Utility;',
      ...(ctx.iconPath ? [`Icon=${ctx.iconPath}`] : []),
      'StartupWMClass=orbit',
      `MimeType=${LINUX_MIME_TYPES.join(';')};`,
      MARKER,
      '',
    ].join('\n') + '\n'
  );
}

const targetPath = (ctx) => path.join(ctx.applicationsDir, DESKTOP_FILE);

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Notre fichier utilisateur est-il en place ?
export function isManaged(ctx = {}) {
  const text = readIfExists(targetPath(ctx));
  return typeof text === 'string' && text.includes(MARKER);
}

// Un fichier .desktop Orbit qui déclare nos types MIME est-il visible du
// système ? On regarde le dossier utilisateur ET les dossiers système : une
// version INSTALLÉE (deb, AppImage) suffit, et dans ce cas déposer notre propre
// fichier serait inutile.
function linuxProposals(ctx = {}) {
  const dirs = [ctx.applicationsDir, ...(ctx.systemApplicationsDirs || [])].filter(Boolean);
  let web = false;
  let html = false;
  for (const dir of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue; // dossier absent (fréquent) : ce n'est pas une erreur
    }
    for (const name of names) {
      if (!name.endsWith('.desktop') || !/orbit/i.test(name)) continue;
      const text = readIfExists(path.join(dir, name));
      if (!text) continue;
      const mime = (text.match(/^MimeType=(.*)$/im) || [])[1] || '';
      if (/x-scheme-handler\/https?/i.test(mime)) web = true;
      if (/text\/html/i.test(mime)) html = true;
    }
  }
  return { web, html };
}

// État courant, pour l'écran de réglages.
// `probes` : { webDefault, htmlDefault } — ce que le bureau répond pour
// « qui ouvre ce type ? » (renseigné par main.js, qui seul peut lancer
// `xdg-mime`). Sert uniquement à INFORMER : on ne défait jamais un choix.
export function status(ctx = {}, probes = {}) {
  const platform = ctx.platform || process.platform;
  const defaults = (value) => path.basename(String(value || '')) === DESKTOP_FILE;

  if (platform === 'linux') {
    const { web, html } = linuxProposals(ctx);
    return {
      platform,
      packaged: ctx.packaged !== false,
      canManage: true,
      managed: isManaged(ctx),
      web: { proposed: web, isDefault: defaults(probes.webDefault) },
      html: { proposed: html, isDefault: defaults(probes.htmlDefault) },
      note: 'xdg',
    };
  }

  if (platform === 'darwin') {
    return {
      platform,
      packaged: ctx.packaged !== false,
      canManage: false,
      managed: false,
      web: { proposed: null, isDefault: false },
      html: { proposed: null, isDefault: false },
      note: 'bundled',
    };
  }

  return {
    platform,
    packaged: ctx.packaged !== false,
    canManage: false,
    managed: false,
    web: { proposed: null, isDefault: false },
    html: { proposed: null, isDefault: false },
    note: 'installer',
  };
}

// Propose Orbit dans « Ouvrir avec » (Linux). Ne définit RIEN par défaut.
export function propose(ctx = {}) {
  if ((ctx.platform || process.platform) === 'darwin') {
    return { success: true, changed: false, note: 'bundled' };
  }
  if ((ctx.platform || process.platform) !== 'linux') {
    return { success: false, error: 'unsupported-platform' };
  }

  const target = targetPath(ctx);
  const existing = readIfExists(target);
  // Un fichier qui n'est pas le nôtre (installation faite autrement) n'est
  // jamais écrasé : on le signale, l'utilisateur décide.
  if (existing !== null && !existing.includes(MARKER)) {
    return { success: false, error: 'file-exists' };
  }

  try {
    fs.mkdirSync(ctx.applicationsDir, { recursive: true });
    fs.writeFileSync(target, desktopEntryText(ctx), { mode: 0o644 });
    return { success: true, changed: true };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

// Retire ce que NOUS avons posé. Le fichier d'un paquet installé (dossier
// système, ou fichier utilisateur sans notre marque) n'est pas touché.
export function unpropose(ctx = {}) {
  if ((ctx.platform || process.platform) !== 'linux') {
    return { success: true, changed: false };
  }
  if (!isManaged(ctx)) return { success: true, changed: false };
  try {
    fs.rmSync(targetPath(ctx), { force: true });
    return { success: true, changed: true };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}
