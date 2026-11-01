// ---------------------------------------------------------------------------
// Conversion d'une base KeePass (.kdbx) en lignes d'import — LOGIQUE PURE.
//
// Pourquoi lire le fichier plutôt que passer par KeePassXC :
//   • le protocole keepassxc-browser ne sait énumérer une base que depuis
//     KeePassXC 2.8 (`get-database-entries`) ; en dessous, il répond « action
//     incorrecte » ;
//   • même sur 2.8, il ne rend les mots de passe que SITE PAR SITE, donc une
//     entrée sans URL est irrécupérable ;
//   • et il faut que KeePassXC tourne, base déverrouillée, Orbit associé.
// Lire le .kdbx lève ces trois limites d'un coup : tout est importé, sans rien
// installer ni lancer.
//
// Ce module ne fait QUE la mise en forme : le déchiffrement vit dans
// electron/kdbx.js (il a besoin de kdbxweb). Garder la conversion ici la rend
// vérifiable sans `node_modules`, y compris sur les cas tordus d'une vraie
// base — champs protégés, corbeille, groupes imbriqués.
// ---------------------------------------------------------------------------

// Un champ de kdbxweb est soit une chaîne, soit une valeur protégée
// (`ProtectedValue`) qui expose `getText()`. Les traiter pareil ici évite
// d'oublier `.getText()` quelque part et d'écrire « [object Object] » dans un
// trousseau.
export function fieldText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value.getText === 'function') return value.getText();
  return String(value);
}

// Chemin du groupe, pour en faire une catégorie Orbit. La racine de la base
// porte le nom du fichier : elle n'apprend rien, on la laisse de côté.
export function groupPath(groupNames = []) {
  return groupNames.filter(Boolean).slice(1).join(' / ');
}

// Le TOTP de KeePassXC vit dans des champs personnalisés, sous deux formes
// concurrentes : l'URI complète `otpauth://…` (champ `otp`), ou la graine
// seule (`TOTP Seed`, écrite par l'ancien greffon KeeOtp). On accepte les
// deux, le coffre normalise ensuite.
export function totpOf(fields) {
  const otp = fieldText(fields?.get?.('otp') ?? fields?.otp);
  if (otp) return otp;
  const seed = fieldText(fields?.get?.('TOTP Seed') ?? fields?.['TOTP Seed']);
  return seed || '';
}

// Entrée kdbxweb → ligne d'import. `entry.fields` est une Map dans kdbxweb 2.x.
export function entryToRow(entry, groupNames = []) {
  const fields = entry?.fields;
  const get = (name) => fieldText(fields?.get?.(name) ?? fields?.[name]);
  return {
    title: get('Title'),
    url: get('URL'),
    username: get('UserName'),
    password: get('Password'),
    totp: totpOf(fields),
    notes: get('Notes'),
    category: groupPath(groupNames),
  };
}

// Une entrée vide (ni identifiant, ni mot de passe) n'apporte rien au coffre :
// une base contient souvent des notes ou des pièces jointes seules.
export function isUsableRow(row) {
  return Boolean(row && (row.username || row.password));
}

// Parcourt l'arbre des groupes et rend les lignes d'import.
//
// `recycleBinUuid` : la corbeille de KeePass. Importer ce que l'utilisateur a
// jeté serait une mauvaise surprise — et ressusciterait des mots de passe
// qu'il a justement voulu retirer.
export function collectRows(rootGroup, { recycleBinUuid = null } = {}) {
  const rows = [];
  const skipped = { empty: 0, recycled: 0 };

  const walk = (group, names) => {
    if (!group) return;
    const uuid = group.uuid?.id ?? group.uuid;
    const binId = recycleBinUuid?.id ?? recycleBinUuid;
    if (binId && uuid && String(uuid) === String(binId)) {
      skipped.recycled += countEntries(group);
      return;
    }
    const path = [...names, fieldText(group.name)];
    for (const entry of group.entries || []) {
      const row = entryToRow(entry, path);
      if (isUsableRow(row)) rows.push(row);
      else skipped.empty += 1;
    }
    for (const child of group.groups || []) walk(child, path);
  };

  walk(rootGroup, []);
  return { rows, skipped };
}

function countEntries(group) {
  if (!group) return 0;
  let n = (group.entries || []).length;
  for (const child of group.groups || []) n += countEntries(child);
  return n;
}

// Catégories à créer dans le trousseau : un groupe KeePass devient une
// catégorie Orbit, pour ne pas aplatir une base organisée en un seul tas.
export function categoriesFrom(rows) {
  const names = [...new Set(rows.map((r) => r.category).filter(Boolean))];
  return names.map((name) => ({ id: `kdbx-${slug(name)}`, name, color: '#6b7280' }));
}

function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
