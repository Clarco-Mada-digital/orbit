// Chargement paresseux du catalogue de raccourcis (bangs.js).
//
// L'instantané pèse ~1 Mo : il vit dans son propre morceau de bundle et n'est
// chargé qu'à la première saisie de « @ » ou « ! » (ou à l'ouverture des
// réglages qui le parcourent). Une fois chargé, il reste en mémoire pour
// toute la session : un seul index, partagé par tous les composants.
import { useEffect, useState } from 'react';
import { buildBangIndex } from './bangs.js';

let cache = null; // { data, index, generatedAt }
let pending = null;

export function loadBangCatalog() {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = import('./bangsData.js')
      .then(({ BANGS, BANGS_GENERATED_AT }) => {
        cache = { data: BANGS, index: buildBangIndex(BANGS), generatedAt: BANGS_GENERATED_AT };
        return cache;
      })
      .catch((err) => {
        pending = null; // on retentera à la prochaine demande
        console.error('[orbit] catalogue de raccourcis indisponible :', err);
        return null;
      });
  }
  return pending;
}

// `needed` : ne déclenche le chargement que lorsqu'il sert vraiment.
export function useBangCatalog(needed = true) {
  const [catalog, setCatalog] = useState(cache);
  useEffect(() => {
    if (!needed || catalog) return undefined;
    let alive = true;
    loadBangCatalog().then((c) => {
      if (alive && c) setCatalog(c);
    });
    return () => {
      alive = false;
    };
  }, [needed, catalog]);
  return catalog;
}

// Le texte appelle-t-il le catalogue ? « @… » ou « !… » en tête.
export const wantsBangs = (text) => /^\s*[@!]/.test(String(text || ''));
