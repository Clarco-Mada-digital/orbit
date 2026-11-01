// ---------------------------------------------------------------------------
// Dépendances optionnelles dans les tests
//
// `npm test` doit tourner SANS `node_modules` (contrainte du projet) : c'est ce
// qui permet de vérifier une modification sans rien installer. Quelques tests
// ne peuvent pourtant pas s'en passer — ceux qui exercent une vraie chaîne de
// rendu React, ou le magasin zustand lui-même. Les simuler ne prouverait rien :
// on testerait notre imitation, pas la bibliothèque.
//
// Ces tests sont donc IGNORÉS proprement quand le paquet manque, avec une
// raison lisible, plutôt que de teindre la suite en rouge pour une absence
// connue. Avec `node_modules` installé (donc en CI), ils s'exécutent
// normalement.
// ---------------------------------------------------------------------------

// Importe un paquet s'il est là, rend `null` sinon.
//
// Un chemin RELATIF est refusé : `import()` le résoudrait depuis CE fichier
// (test/helpers/) et non depuis le test appelant, donc il ne serait jamais
// trouvé — le test s'ignorerait en annonçant une dépendance manquante qui ne
// l'est pas. Pour un module du dépôt, passer une URL absolue :
//   optionalImport(new URL('../src/x.js', import.meta.url).href)
export async function optionalImport(specifier) {
  if (/^\.{1,2}\//.test(String(specifier))) {
    throw new Error(
      `optionalImport("${specifier}") : chemin relatif refusé — passez ` +
        `new URL('${specifier}', import.meta.url).href depuis le test appelant`
    );
  }
  try {
    return await import(specifier);
  } catch (err) {
    // On ne masque que l'absence du paquet : une vraie erreur dans le module
    // (syntaxe, import cassé) doit rester visible, sinon ce helper
    // transformerait une régression en test silencieusement ignoré.
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
}

// Importe plusieurs paquets ; rend `null` dès que l'un manque.
export async function optionalImportAll(specifiers) {
  const mods = [];
  for (const specifier of specifiers) {
    const mod = await optionalImport(specifier);
    if (!mod) return null;
    mods.push(mod);
  }
  return mods;
}

// Raison à passer à `{ skip }` du runner de test.
export function missingDepsReason(names) {
  const list = Array.isArray(names) ? names.join(', ') : String(names);
  return `${list} absent — lancez « npm install » pour exécuter ce test`;
}
