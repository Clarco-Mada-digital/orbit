// Gabarits de disposition de l'écran partagé (3 et 4 apps).
//
// Chaque gabarit s'appuie sur `grid-template-areas` : les zones a, b, c, d sont
// occupées par les panneaux dans l'ordre de `splitView.appIds` (a = app 0…).
// Le rendu (App.jsx) applique cols/rows/areas au conteneur et `grid-area` à
// chaque panneau ; la même définition sert aux vignettes du menu.
//
// À 2 apps, on garde le mode flex redimensionnable (direction row/col) — pas de
// gabarit ici.

export const SPLIT_LAYOUTS = {
  3: [
    { id: 'master-left', cols: '1.3fr 1fr', rows: '1fr 1fr', areas: '"a b" "a c"' },
    { id: 'master-right', cols: '1fr 1.3fr', rows: '1fr 1fr', areas: '"b a" "c a"' },
    { id: 'master-top', cols: '1fr 1fr', rows: '1.3fr 1fr', areas: '"a a" "b c"' },
    { id: 'master-bottom', cols: '1fr 1fr', rows: '1fr 1.3fr', areas: '"b c" "a a"' },
    { id: 'cols', cols: '1fr 1fr 1fr', rows: '1fr', areas: '"a b c"' },
    { id: 'rows', cols: '1fr', rows: '1fr 1fr 1fr', areas: '"a" "b" "c"' },
  ],
  4: [
    { id: 'grid', cols: '1fr 1fr', rows: '1fr 1fr', areas: '"a b" "c d"' },
    { id: 'master-left', cols: '1.5fr 1fr', rows: '1fr 1fr 1fr', areas: '"a b" "a c" "a d"' },
    { id: 'master-right', cols: '1fr 1.5fr', rows: '1fr 1fr 1fr', areas: '"b a" "c a" "d a"' },
    { id: 'cols', cols: '1fr 1fr 1fr 1fr', rows: '1fr', areas: '"a b c d"' },
    { id: 'rows', cols: '1fr', rows: '1fr 1fr 1fr 1fr', areas: '"a" "b" "c" "d"' },
  ],
};

const AREA = ['a', 'b', 'c', 'd'];
export const areaLetter = (i) => AREA[i];

export function layoutsFor(count) {
  // On filtre les gabarits qui exposent exactement `count` zones.
  return (SPLIT_LAYOUTS[count] || []).filter((l) => {
    const used = new Set((l.areas.match(/[a-d]/g) || []));
    return used.size === count;
  });
}

export function layoutFor(count, id) {
  const list = layoutsFor(count);
  return list.find((l) => l.id === id) || list[0] || null;
}

export function defaultLayoutId(count) {
  return layoutsFor(count)[0]?.id;
}
