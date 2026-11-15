import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, Check, X, Search } from 'lucide-react';
import { useT, resolveLang } from '../lib/i18n';
import { useStore } from '../stores/useStore';
import { resolveOmniInput } from '../lib/searchEngines';

// // Réécrire l'adresse de la page courante, sans la fermer.
//
// Nécessaire surtout sur une PAGE VOLANTE : elle n'a pas de champ d'adresse, et
// une faute de frappe ne se corrigeait qu'en tout supprimant et rouvrant — on
// perdait l'historique de navigation et la page repartait de zéro.
//
// Le champ est pré-rempli avec l'URL COURANTE et tout sélectionné : taper par-
// dessus remplace, ce qui est le geste attendu.
//
// Ce champ se comporte comme une BARRE D'ADRESSE, pas comme un formulaire :
// il exigeait « https:// » en toutes lettres et refusait tout le reste, alors
// que personne ne tape le schéma. Désormais « exemple.fr » et
// « localhost:5173 » sont des adresses, et du texte libre devient une
// recherche avec le moteur par défaut (voir src/lib/searchEngines.js). La
// seule chose encore refusée, c'est ce qu'on ne peut pas ouvrir du tout.
export default function EditUrlDialog({ initialUrl = '', onSubmit, onClose }) {
  const t = useT();
  const lang = resolveLang(useStore((s) => s.settings?.language));
  const search = useStore((s) => s.settings?.search);
  const [value, setValue] = useState(initialUrl);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // Ce que la validation va faire, calculé à chaque frappe : la réponse est
  // AFFICHÉE sous le champ. Annoncer « je vais chercher ça » avant d'ouvrir
  // vaut mieux qu'ouvrir une recherche surprise sur une adresse mal tapée.
  const resolved = useMemo(
    () => resolveOmniInput(value, { search: search || {}, lang }),
    [value, search, lang]
  );

  // Échap annule, Entrée valide — comme n'importe quelle boîte de dialogue.
  const submit = () => {
    // `kind: 'engines'` = un « @moteur » encore en cours de frappe, sans
    // termes : il n'y a rien à ouvrir, on garde la main à l'utilisateur.
    if (resolved.kind !== 'url' && resolved.kind !== 'search') {
      setError(t('fly.editUrlInvalid'));
      inputRef.current?.focus();
      return;
    }
    // `window.open` refusant « javascript: », la cible est toujours une URL
    // http(s) construite par resolveOmniInput — jamais la saisie brute.
    onSubmit(resolved.url);
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/60 flex items-start justify-center pt-[12vh] animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl bg-bg-secondary border border-border rounded-2xl shadow-2xl animate-scale-in">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <Globe size={18} className="text-accent-primary" />
          <h2 className="font-semibold">{t('fly.editUrlTitle')}</h2>
        </div>

        <div className="px-5 py-4">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              else if (e.key === 'Escape') onClose();
            }}
            placeholder={t('fly.editUrlPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            className="input w-full font-mono"
          />

          {/* Aperçu de l'action. Deux issues possibles, deux allures bien
              différentes : on ne doit pas croire qu'on ouvre un site quand
              on lance une recherche. */}
          {!error && resolved.kind === 'url' && (
            <div className="mt-2 flex items-center gap-2 text-xs text-text-muted min-w-0">
              <Globe size={13} className="flex-shrink-0 text-accent-primary" />
              <span className="truncate font-mono">{resolved.url}</span>
            </div>
          )}
          {!error && resolved.kind === 'search' && (
            <div className="mt-2 flex items-center gap-2 text-xs text-text-muted min-w-0">
              <Search size={13} className="flex-shrink-0" style={{ color: resolved.engine.color }} />
              <span className="truncate">
                {t('fly.editUrlSearch', { engine: resolved.engine.name, terms: resolved.terms })}
              </span>
            </div>
          )}
          {!error && resolved.kind === 'engines' && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
              <Search size={13} className="flex-shrink-0" />
              {resolved.engines.slice(0, 8).map((engine) => (
                <button
                  key={engine.id || engine.keyword}
                  type="button"
                  onClick={() => {
                    setValue(`@${engine.keyword} ${resolved.terms}`.trimEnd() + ' ');
                    inputRef.current?.focus();
                  }}
                  className="px-2 py-0.5 rounded-full border border-border hover:border-accent-primary hover:text-accent-primary"
                >
                  <span className="font-mono">@{engine.keyword}</span> {engine.name}
                </button>
              ))}
            </div>
          )}

          {error && <div className="mt-2 text-sm text-error">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={onClose} className="btn">
            <X size={14} /> {t('common.cancel')}
          </button>
          <button onClick={submit} className="btn btn-primary">
            <Check size={14} /> {t('fly.editUrlGo')}
          </button>
        </div>
      </div>
    </div>
  );
}
