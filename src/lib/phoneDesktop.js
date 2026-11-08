// ---------------------------------------------------------------------------
// Le bureau du Téléphone : catalogue de widgets et disposition — LOGIQUE PURE.
//
// Deux publics à servir sans en trahir un : celui qui veut un bureau nu (un
// fond d'écran, ses applications, rien d'autre) et celui qui veut tout sous la
// main. D'où un bureau où CHAQUE carte s'ajoute et s'enlève, et deux
// dispositions prêtes à l'emploi comme points de départ.
//
// La disposition est une LISTE ORDONNÉE, pas des coordonnées. Une grille
// `auto-fill` place ensuite les cartes selon la largeur disponible : la même
// disposition tient sur une fenêtre étroite et sur un écran large, sans
// chevauchement possible et sans calcul de collision. Déplacer, c'est
// réordonner ; redimensionner, c'est changer la taille d'une carte.
// ---------------------------------------------------------------------------

// Largeurs en colonnes de la grille, et hauteur en rangées. « sm » tient à
// quatre de front sur un grand écran, « lg » prend la moitié.
export const WIDGET_SIZES = {
  sm: { cols: 1, rows: 1, label: 'Petit' },
  md: { cols: 2, rows: 1, label: 'Moyen' },
  lg: { cols: 2, rows: 2, label: 'Grand' },
  wide: { cols: 4, rows: 1, label: 'Large' },
};

export const WIDGET_SIZE_ORDER = ['sm', 'md', 'lg', 'wide'];

// Catalogue. `sizes` énumère ce qui a du sens pour CE widget : un aperçu
// d'écran minuscule ne sert à rien, une horloge géante non plus.
//
// `needs` dit de quelle source dépend le widget, ce qui permet de ne pas
// interroger le téléphone pour une donnée qu'aucune carte n'affiche.
export const WIDGET_CATALOG = [
  {
    type: 'clock',
    label: 'Horloge',
    hint: 'Heure et date du bureau',
    icon: 'clock',
    sizes: ['sm', 'md', 'lg'],
    defaultSize: 'md',
    needs: null,
  },
  {
    type: 'device',
    label: 'Appareil',
    hint: 'Modèle, version d’Android et batterie',
    icon: 'smartphone',
    sizes: ['sm', 'md'],
    defaultSize: 'md',
    needs: null,
  },
  {
    type: 'screen',
    label: 'Écran vivant',
    hint: 'Aperçu de l’écran du téléphone, rafraîchi ; ouvre le miroir',
    icon: 'monitor',
    sizes: ['md', 'lg'],
    defaultSize: 'lg',
    needs: 'screen',
  },
  {
    type: 'calendar',
    label: 'Agenda',
    hint: 'Prochains évènements lus dans l’agenda du téléphone',
    icon: 'calendar',
    sizes: ['md', 'lg'],
    defaultSize: 'lg',
    needs: 'calendar',
  },
  {
    type: 'media',
    label: 'Lecture en cours',
    hint: 'Titre joué sur le téléphone, avec les commandes',
    icon: 'music',
    sizes: ['md', 'wide'],
    defaultSize: 'md',
    needs: 'media',
  },
  {
    type: 'storage',
    label: 'Stockage',
    hint: 'Espace occupé sur le téléphone',
    icon: 'database',
    sizes: ['sm', 'md'],
    defaultSize: 'sm',
    needs: 'storage',
  },
  {
    type: 'notifications',
    label: 'Notifications',
    hint: 'Les notifications du téléphone',
    icon: 'bell',
    sizes: ['md', 'lg', 'wide'],
    defaultSize: 'lg',
    needs: null,
  },
  {
    type: 'calls',
    label: 'Appels récents',
    hint: 'Qui a appelé, et de quoi rappeler',
    icon: 'phone',
    sizes: ['md', 'lg'],
    defaultSize: 'lg',
    needs: 'calls',
  },
  {
    type: 'favorites',
    label: 'Favoris',
    hint: 'Les applications marquées d’une étoile',
    icon: 'star',
    sizes: ['md', 'lg', 'wide'],
    defaultSize: 'wide',
    needs: null,
  },
  {
    type: 'recent',
    label: 'Récemment ouvertes',
    hint: 'Les dernières applications lancées',
    icon: 'history',
    sizes: ['md', 'wide'],
    defaultSize: 'md',
    needs: null,
  },
  {
    // La tuile VIVANTE : le pont entre une icône et un widget. Elle porte une
    // application précise (`package`) et affiche ce qui lui arrive.
    type: 'apptile',
    label: 'Tuile d’application',
    hint: 'Une application, son compteur et sa dernière notification',
    icon: 'layout',
    sizes: ['sm', 'md'],
    defaultSize: 'md',
    needs: null,
    requiresPackage: true,
  },
];

export const WIDGET_TYPES = new Set(WIDGET_CATALOG.map((w) => w.type));

export function widgetDefinition(type) {
  return WIDGET_CATALOG.find((w) => w.type === type) || null;
}

// Dispositions de départ. « Sobre » tient la promesse d'un bureau qui respire :
// l'heure, et les applications. Le reste s'ajoute à la demande.
export const DESKTOP_PRESETS = {
  sobre: ['clock', 'favorites'],
  complet: [
    'clock',
    'device',
    'screen',
    'calendar',
    'media',
    'storage',
    'notifications',
    'calls',
    'favorites',
    'recent',
  ],
};

export function presetLayout(name = 'sobre') {
  const types = DESKTOP_PRESETS[name] || DESKTOP_PRESETS.sobre;
  return types.map((type, index) => ({
    id: `${type}-${index + 1}`,
    type,
    size: widgetDefinition(type)?.defaultSize || 'md',
  }));
}

function sizeFor(type, wanted) {
  const def = widgetDefinition(type);
  if (!def) return 'md';
  return def.sizes.includes(wanted) ? wanted : def.defaultSize;
}

// Normalise une disposition venue des réglages.
//
// Accepte AUSSI l'ancienne forme — un objet de booléens
// (`{ clock: true, calls: false }`) — parce que c'est ce qui est enregistré
// chez les gens qui utilisent déjà le Téléphone : leur bureau ne doit pas se
// vider au premier lancement de la nouvelle version.
export function normalizeDesktopLayout(raw) {
  if (raw && !Array.isArray(raw) && typeof raw === 'object') {
    const kept = DESKTOP_PRESETS.complet.filter((type) => raw[type] !== false);
    // L'ancien réglage n'avait pas ces widgets : les ajouter d'office
    // remplirait le bureau de quelqu'un qui ne les a jamais demandés.
    const legacy = kept.filter((type) => !['screen', 'calendar', 'media', 'storage'].includes(type));
    return legacy.map((type, index) => ({
      id: `${type}-${index + 1}`,
      type,
      size: widgetDefinition(type)?.defaultSize || 'md',
    }));
  }

  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const layout = [];
  for (const entry of list) {
    const type = String(entry?.type || '');
    if (!WIDGET_TYPES.has(type)) continue;
    const def = widgetDefinition(type);
    const pkg = typeof entry?.package === 'string' ? entry.package : '';
    if (def.requiresPackage && !pkg) continue;
    // Un identifiant unique : c'est lui qui sert de clé de rendu et de cible
    // de déplacement. Deux cartes qui le partageraient se marcheraient dessus.
    let id = String(entry?.id || '') || `${type}-${layout.length + 1}`;
    while (seen.has(id)) id = `${type}-${layout.length + 1}-${seen.size}`;
    seen.add(id);
    layout.push({
      id,
      type,
      size: sizeFor(type, entry?.size),
      ...(pkg ? { package: pkg } : {}),
    });
  }
  return layout.slice(0, 24);
}

// Ajout. Un widget sans état propre ne se met qu'une fois : deux horloges
// côte à côte n'apprennent rien. Les tuiles d'application, elles, se
// multiplient — une par application suivie.
export function addWidget(layout, type, { package: pkg = '', size } = {}) {
  const def = widgetDefinition(type);
  if (!def) return layout;
  if (def.requiresPackage && !pkg) return layout;
  if (!def.requiresPackage && layout.some((w) => w.type === type)) return layout;
  if (def.requiresPackage && layout.some((w) => w.type === type && w.package === pkg)) return layout;
  const used = new Set(layout.map((w) => w.id));
  let id = `${type}-${layout.length + 1}`;
  while (used.has(id)) id += '+';
  return [
    ...layout,
    { id, type, size: sizeFor(type, size || def.defaultSize), ...(pkg ? { package: pkg } : {}) },
  ];
}

export function removeWidget(layout, id) {
  return layout.filter((widget) => widget.id !== id);
}

// Taille suivante parmi celles qui ont du sens pour ce widget. Un seul bouton
// qui fait le tour, plutôt qu'une poignée à attraper au pixel.
export function cycleWidgetSize(layout, id) {
  return layout.map((widget) => {
    if (widget.id !== id) return widget;
    const def = widgetDefinition(widget.type);
    const allowed = def?.sizes?.length ? def.sizes : WIDGET_SIZE_ORDER;
    const next = allowed[(allowed.indexOf(widget.size) + 1) % allowed.length];
    return { ...widget, size: next };
  });
}

// Déplacement : la carte saisie vient prendre la place de la carte visée.
export function moveWidget(layout, fromId, toId) {
  if (fromId === toId) return layout;
  const from = layout.findIndex((w) => w.id === fromId);
  const to = layout.findIndex((w) => w.id === toId);
  if (from < 0 || to < 0) return layout;
  const next = [...layout];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// Les sources à interroger pour la disposition courante. Sans ça, le bureau
// réclamerait l'agenda et une capture d'écran à un téléphone dont personne
// n'affiche ni l'un ni l'autre.
export function neededSources(layout) {
  const needs = new Set();
  for (const widget of Array.isArray(layout) ? layout : []) {
    const def = widgetDefinition(widget.type);
    if (def?.needs) needs.add(def.needs);
  }
  return needs;
}
