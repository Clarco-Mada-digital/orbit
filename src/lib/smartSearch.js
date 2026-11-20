// ---------------------------------------------------------------------------
// « Résultats instantanés » de la palette Alt+K : calcul, conversions, bases,
// couleurs, dates, devises et détection d'URL.
//
// Le hook renvoie les cartes prêtes à afficher. Tout est synchrone sauf les
// devises : les taux sont lus en cascade (réseau → cache local, même périmé →
// instantané livré avec l'app) et arrivent dans un second rendu — la palette
// reste donc instantanée, et convertit même hors ligne.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from 'react';
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

// « taux du 18/11/2026 » — l'âge d'un taux fait partie du résultat : sans lui,
// un relevé d'il y a six mois passerait pour le cours du jour.
function formatRateDate(at, locale) {
  if (!Number.isFinite(at) || !at) return '';
  try {
    return new Date(at).toLocaleDateString(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function useSmartResults(query, locale = 'fr-FR') {
  const trimmed = String(query || '').trim();

  // `fx` = { rates, at, source, stale } | null ; il ne change plus une fois
  // obtenu pour la session de palette en cours.
  const [fx, setFx] = useState(null);
  const [loading, setLoading] = useState(false);

  // Devises : la requête est reconnue tout de suite, les taux arrivent après.
  // Les codes connus viennent des taux eux-mêmes (l'API en connaît ~160).
  const fxQuery = useMemo(
    () => parseCurrencyQuery(trimmed, fx ? fx.rates : null),
    [trimmed, fx]
  );

  useEffect(() => {
    if (!fxQuery || fx) return;
    let alive = true;
    fetchRates().then((next) => {
      if (alive && next) setFx(next);
    });
    return () => {
      alive = false;
    };
  }, [fxQuery, fx]);

  // Actualisation à la demande : on ignore le cache frais et on retente le
  // réseau. Si tout échoue, le repli s'applique comme d'habitude.
  const refresh = useCallback(() => {
    setLoading(true);
    fetchRates({ force: true }).then((next) => {
      if (next) setFx(next);
      setLoading(false);
    });
  }, []);

  const cards = useMemo(() => {
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

    // 2. Devises — la carte affiche toujours la DATE du relevé utilisé
    if (fxQuery) {
      const result = convertCurrency(fxQuery, fx ? fx.rates : null, locale);
      const date = fx ? formatRateDate(fx.at, locale) : '';
      // « taux du 18/11/2026 · hors ligne » : la provenance fait partie du
      // résultat, pas d'une infobulle qu'on ne lira jamais.
      const provenance = fx
        ? `taux du ${date}${fx.stale ? ' · hors ligne' : ''}`
        : '';
      cards.push(
        result
          ? {
              id: 'smart-fx',
              kind: 'currency',
              title: result.text,
              subtitle: `${fxQuery.amount} ${fxQuery.from.toUpperCase()} — ${result.detail} · ${provenance}`,
              copy: String(Number(result.value.toFixed(2))),
            }
          : {
              id: 'smart-fx',
              kind: 'currency',
              title: '…',
              subtitle: 'Récupération des taux de change…',
              disabled: true,
            }
      );
      // Relevé périmé : un geste pour réessayer, sans quitter la palette ni
      // retaper la requête. (Rien à proposer tant que le premier chargement
      // n'a pas rendu de relevé : la carte au-dessus dit déjà « récupération ».)
      if (fx && fx.stale) {
        cards.push({
          id: 'smart-fx-refresh',
          kind: 'fxRefresh',
          title: loading ? 'Actualisation des taux…' : 'Actualiser les taux de change',
          subtitle: `Dernier relevé : ${date} — Entrée pour réessayer`,
          disabled: loading,
          run: refresh,
        });
      }
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
  }, [trimmed, locale, fxQuery, fx, loading, refresh]);

  return useMemo(
    () => ({ cards, refresh, rates: fx, loading }),
    [cards, refresh, fx, loading]
  );
}
