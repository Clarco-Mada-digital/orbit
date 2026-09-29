// ---------------------------------------------------------------------------
// « Résultats instantanés » de la palette Alt+K : calcul, conversions, bases,
// couleurs, dates, devises et détection d'URL.
//
// Le hook renvoie une liste de cartes prêtes à afficher. Tout est synchrone
// sauf les devises (taux récupérés en ligne) qui arrivent dans un second
// rendu — la palette reste donc instantanée.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import { evaluate, formatNumber } from './calc.js';
import {
  convertUnits,
  convertBase,
  convertColor,
  convertTime,
  parseCurrencyQuery,
  fetchRates,
  convertCurrency,
} from './convert';

// `detectUrl` vit dans urls.js (module sans dépendance, donc testable) ; on le
// ré-exporte ici pour que la palette garde un point d'entrée unique.
export { detectUrl } from './urls.js';

export function useSmartResults(query, locale = 'fr-FR') {
  const trimmed = String(query || '').trim();

  // Devises : la requête est reconnue tout de suite, les taux arrivent après
  const fxQuery = useMemo(() => parseCurrencyQuery(trimmed), [trimmed]);
  const [rates, setRates] = useState(null);

  useEffect(() => {
    if (!fxQuery || rates) return;
    let alive = true;
    fetchRates().then((r) => {
      if (alive && r) setRates(r);
    });
    return () => {
      alive = false;
    };
  }, [fxQuery, rates]);

  return useMemo(() => {
    if (!trimmed) return [];
    const cards = [];

    // 1. Conversion d'unités (avant le calcul : « 10 km en mi » n'est pas un calcul)
    const unit = convertUnits(trimmed, locale);
    if (unit) {
      cards.push({
        id: 'smart-unit',
        kind: 'unit',
        title: unit.text,
        subtitle: `${unit.detail} — conversion (${unit.family})`,
        copy: String(Number(unit.value.toPrecision(12))),
      });
    }

    // 2. Devises
    if (fxQuery) {
      const fx = convertCurrency(fxQuery, rates, locale);
      cards.push(
        fx
          ? {
              id: 'smart-fx',
              kind: 'currency',
              title: fx.text,
              subtitle: `${fxQuery.amount} ${fxQuery.from.toUpperCase()} — ${fx.detail}`,
              copy: String(Number(fx.value.toFixed(2))),
            }
          : {
              id: 'smart-fx',
              kind: 'currency',
              title: '…',
              subtitle: rates === null ? 'Récupération des taux de change…' : 'Taux indisponibles (hors ligne ?)',
              disabled: true,
            }
      );
    }

    // 3. Calcul
    if (!unit) {
      const value = evaluate(trimmed);
      if (value !== null) {
        cards.push({
          id: 'smart-calc',
          kind: 'calc',
          title: formatNumber(value, locale),
          subtitle: `${trimmed} — Entrée pour copier le résultat`,
          copy: String(value),
        });
      }
    }

    // 4. Bases numériques
    const base = convertBase(trimmed, locale);
    if (base) {
      cards.push({
        id: 'smart-base',
        kind: 'base',
        title: base.text,
        subtitle: `${base.detail} — conversion de base`,
        copy: base.text,
      });
    }

    // 5. Couleurs (avec aperçu)
    const color = convertColor(trimmed);
    if (color) {
      cards.push({
        id: 'smart-color',
        kind: 'color',
        title: color.hex,
        subtitle: `${color.rgb} · ${color.hsl}`,
        swatch: color.swatch,
        copy: color.hex,
      });
    }

    // 6. Date / horodatage
    const time = convertTime(trimmed, locale);
    if (time) {
      cards.push({
        id: 'smart-time',
        kind: 'time',
        title: time.title,
        subtitle: time.detail,
        copy: time.copy,
      });
    }

    return cards;
  }, [trimmed, locale, fxQuery, rates]);
}
