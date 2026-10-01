import { useEffect, useRef, useState } from 'react';
import { Globe, Check, X } from 'lucide-react';
import { useT } from '../lib/i18n';

// // Réécrire l'adresse de la page courante, sans la fermer.
//
// Nécessaire surtout sur une PAGE VOLANTE : elle n'a pas de champ d'adresse, et
// une faute de frappe ne se corrigeait qu'en tout supprimant et rouvrant — on
// perdait l'historique de navigation et la page repartait de zéro.
//
// Le champ est pré-rempli avec l'URL COURANTE et tout sélectionné : taper par-
// dessus remplace, ce qui est le geste attendu.
export default function EditUrlDialog({ initialUrl = '', onSubmit, onClose }) {
  const t = useT();
  const [value, setValue] = useState(initialUrl);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // Échap annule, Entrée valide — comme n'importe quelle boîte de dialogue.
  const submit = () => {
    const url = value.trim();
    // `window.open` refusant « javascript: », on n'autorise que http(s) : c'est
    // aussi ce que fait openFlyPage côté store.
    if (!/^https?:\/\//i.test(url)) {
      setError(t('fly.editUrlInvalid'));
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    onSubmit(url);
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
            placeholder="https://exemple.fr"
            spellCheck={false}
            autoComplete="off"
            className="input w-full font-mono"
          />
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