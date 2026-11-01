// ---------------------------------------------------------------------------
// Catégories importées — LOGIQUE PURE, sans Electron.
//
// Une base KeePass est organisée en GROUPES, un coffre Orbit en CATÉGORIES.
// Les lignes d'import portent un NOM de groupe ; le coffre, lui, range les
// entrées par identifiant de catégorie. Sans cette traduction, une base bien
// rangée arriverait entièrement dans « Sans catégorie ».
//
// Vit à part pour être vérifiable sans `node_modules` : c'est de la logique
// d'appariement, l'endroit exact où un doublon ou un mauvais identifiant passe
// inaperçu jusqu'à ce qu'un utilisateur retrouve son coffre en vrac.
// ---------------------------------------------------------------------------

const key = (name) => String(name || '').trim().toLowerCase();

// Ajoute les catégories absentes à `existing`, en comparant par NOM :
// réimporter la même base ne doit pas empiler « Banque », « Banque »…
// Rend la nouvelle liste ET le nombre d'ajouts (l'écran l'annonce).
export function mergeCategories(existing = [], incoming = [], makeId = () => null) {
  const list = [...existing];
  const known = new Set(list.map((c) => key(c.name)));
  let added = 0;
  for (const category of incoming) {
    const name = String(category?.name || '').trim();
    if (!name || known.has(key(name))) continue;
    known.add(key(name));
    list.push({
      id: category.id || makeId() || `c_${key(name).replace(/[^a-z0-9]+/g, '-')}`,
      name,
      color: category.color || '#6b7280',
    });
    added += 1;
  }
  return { categories: list, added };
}

// Remplace le NOM de catégorie de chaque ligne par l'identifiant correspondant.
// Un nom inconnu retombe sur « aucune catégorie » plutôt que d'écrire un
// identifiant fantôme, qui afficherait une catégorie vide dans l'interface.
export function applyCategoryIds(rows = [], categories = []) {
  const byName = new Map(categories.map((c) => [key(c.name), c.id]));
  return rows.map((row) =>
    row?.category ? { ...row, category: byName.get(key(row.category)) || '' } : row
  );
}
