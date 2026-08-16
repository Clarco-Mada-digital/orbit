import { useEffect, useRef, useState } from 'react';
import { Lock, Delete, ArrowRight } from 'lucide-react';
import OrbitLogo from './OrbitLogo';
import { useT } from '../lib/i18n';

// Écran/panneau de saisie de code, réutilisable :
//   variant="app"     → déverrouillage global (plein écran, au lancement)
//   variant="profile" → déverrouillage d'un profil (superposé sur le contenu)
//   variant="set"     → définition d'un nouveau code (confirmation en 2 temps)
//
// Props :
//   title, subtitle  — libellés
//   onSubmit(pin)    — doit renvoyer { success, error }
//   onCancel         — optionnel (bouton Annuler)
//   confirm          — true : demande une double saisie (définition d'un code)
export default function LockScreen({
  variant = 'app',
  title,
  subtitle,
  onSubmit,
  onCancel,
  confirm = false,
}) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState('enter'); // 'enter' | 'confirm'
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const t = useT();

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  const current = step === 'confirm' ? confirmPin : pin;
  const setCurrent = step === 'confirm' ? setConfirmPin : setPin;

  const press = (digit) => {
    setError(null);
    if (current.length < 12) setCurrent(current + digit);
  };
  const backspace = () => {
    setError(null);
    setCurrent(current.slice(0, -1));
  };

  const validate = async () => {
    if (busy) return;
    if (confirm) {
      // Définition d'un code : saisie puis confirmation
      if (step === 'enter') {
        if (pin.length < 4) {
          setError(t('lock.tooShort'));
          return;
        }
        setStep('confirm');
        return;
      }
      if (confirmPin !== pin) {
        setError(t('lock.mismatch'));
        setConfirmPin('');
        return;
      }
    } else if (pin.length < 4) {
      setError(t('lock.tooShort2'));
      return;
    }

    setBusy(true);
    try {
      const res = await onSubmit(pin);
      if (res && !res.success) {
        setError(res.error || t('lock.wrong'));
        setPin('');
        setConfirmPin('');
        setStep('enter');
      }
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') validate();
    else if (e.key === 'Escape' && onCancel) onCancel();
  };

  const fullScreen = variant === 'app';

  return (
    <div
      className={`${
        fullScreen ? 'fixed inset-0' : 'absolute inset-0'
      } z-[10000] flex flex-col items-center justify-center bg-bg-primary/95 backdrop-blur-sm`}
      style={fullScreen ? { borderRadius: 12 } : undefined}
    >
      <div className="w-[min(360px,90%)] bg-bg-elevated border border-border rounded-2xl shadow-2xl p-6">
        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-14 h-14 rounded-2xl bg-accent-primary/15 flex items-center justify-center mb-3">
            {fullScreen ? <OrbitLogo size={26} /> : <Lock size={24} className="text-accent-primary" />}
          </div>
          <h2 className="text-lg font-semibold">
            {title || (confirm ? t('lock.setTitle') : t('lock.lockedTitle'))}
          </h2>
          <p className="text-sm text-text-muted mt-1">
            {subtitle ||
              (confirm
                ? step === 'confirm'
                  ? t('lock.confirm')
                  : t('lock.choose')
                : t('lock.enter'))}
          </p>
        </div>

        {/* Champ masqué (accepte chiffres ET texte) */}
        <input
          ref={inputRef}
          type="password"
          inputMode="text"
          value={current}
          onChange={(e) => {
            setError(null);
            setCurrent(e.target.value.slice(0, 24));
          }}
          onKeyDown={onKeyDown}
          placeholder="••••"
          className="input text-center text-lg tracking-[0.3em] mb-2"
          autoFocus
        />

        {error && <p className="text-sm text-error text-center mb-2">{error}</p>}

        {/* Pavé numérique (raccourci pour un PIN) */}
        <div className="grid grid-cols-3 gap-2 my-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              onClick={() => press(d)}
              className="h-11 rounded-lg bg-bg-secondary border border-border hover:bg-bg-hover text-lg font-medium transition-colors"
            >
              {d}
            </button>
          ))}
          <button
            onClick={backspace}
            className="h-11 rounded-lg bg-bg-secondary border border-border hover:bg-bg-hover flex items-center justify-center transition-colors"
            title={t('lock.clear')}
          >
            <Delete size={18} />
          </button>
          <button
            onClick={() => press('0')}
            className="h-11 rounded-lg bg-bg-secondary border border-border hover:bg-bg-hover text-lg font-medium transition-colors"
          >
            0
          </button>
          <button
            onClick={validate}
            disabled={busy}
            className="h-11 rounded-lg bg-accent-primary text-white hover:bg-accent-hover flex items-center justify-center transition-colors disabled:opacity-50"
            title={t('lock.validate')}
          >
            <ArrowRight size={18} />
          </button>
        </div>

        {onCancel && (
          <button
            onClick={onCancel}
            className="w-full btn btn-secondary btn-sm mt-1"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  );
}
