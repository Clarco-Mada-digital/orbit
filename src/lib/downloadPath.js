// ---------------------------------------------------------------------------
// Où enregistrer un téléchargement — LOGIQUE PURE (sans fs, sans Electron).
//
// Le processus principal décide à chaque téléchargement : soit il enregistre
// tout seul dans le dossier réglé par l'utilisateur, soit il ouvre la boîte
// d'enregistrement du système. Cette décision vit ici pour être testable sous
// `node --test` : elle touche le disque et le système d'exploitation, deux
// choses qu'on ne peut pas exercer dans un test.
// ---------------------------------------------------------------------------

// Nom de fichier sûr. `item.getFilename()` vient du SERVEUR : il peut contenir
// des séparateurs de chemin, voire des montées de dossier
// (« ../../.config/autre/fichier »). `path.join` les résoudrait, et le
// fichier atterrirait hors du dossier de téléchargement — au mieux un
// échec, au pire une écriture là où personne ne l'attendait. On ne garde que
// la dernière composante, et on retire les caractères de contrôle.
export function safeFileName(name) {
  const s = String(name || '')
    .replace(/[\r\n\t]/g, ' ')
    // Séparateurs Unix ET Windows : quoi que dise le navigateur, le nom reçu
    // n'est jamais un chemin.
    .split(/[\\/]/)
    .pop();
  // Un nom vide ou réduit à des points n'a aucun sens : on propose un nom neutre.
  const trimmed = s.trim().replace(/^\.+$/, '');
  return trimmed || 'fichier';
}

// Dossier de destination effectif : celui réglé par l'utilisateur, sinon le
// dossier Téléchargements du système. Une chaîne vide — ou composée
// uniquement d'espaces — signifie « je n'ai rien choisi », et c'est le repli
// qui s'applique (le réglage ne doit jamais bloquer un téléchargement).
export function downloadTargetDir(configuredDir, systemDir) {
  const configured = String(configuredDir || '').trim();
  return configured || String(systemDir || '').trim();
}

// Chemin libre : « photo.png » → « photo (1).png » si le fichier existe déjà.
//
// `exists` est un prédicat (fs.existsSync côté principal) : la fonction reste
// pure et teste sans toucher au disque. `sep` donne le séparateur de la
// plateforme (path.sep) — on ne devine rien d'ici, on assemble seulement.
export function uniqueDownloadPath(dir, filename, exists = () => false, { sep = '/' } = {}) {
  const name = safeFileName(filename);
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  // On retient un seul séparateur en fin de dossier : « /dl » et « /dl/ »
  // doivent donner le même chemin.
  const join = (d, n) => `${String(d).replace(/[\\/]+$/, '')}${sep}${n}`;
  let candidate = join(dir, name);
  let i = 1;
  while (exists(candidate)) {
    candidate = join(dir, `${base} (${i})${ext}`);
    i += 1;
  }
  return candidate;
}

// Décision complète pour UN téléchargement.
//
//   mustAsk  → il faut ouvrir la boîte d'enregistrement du système ;
//              `defaultPath` est alors le point de départ proposée.
//   sinon    → on enregistre directement à `savePath`.
//
// `ask` est l'interrupteur « demander à chaque téléchargement ». Quand il est
// activé, on propose le DOSSIER RÉGLÉ (pas celui du système) : sinon la
// question serait posée à chaque fois toujours au même endroit, ce qui rend
// le réglage inutile.
export function savePlan({ configuredDir, systemDir, filename, ask = false, exists, sep = '/' }) {
  const dir = downloadTargetDir(configuredDir, systemDir);
  const name = safeFileName(filename);
  const savePath = uniqueDownloadPath(dir, name, exists, { sep });
  return {
    mustAsk: Boolean(ask),
    dir,
    defaultPath: savePath,
    savePath,
    filename: name,
  };
}
