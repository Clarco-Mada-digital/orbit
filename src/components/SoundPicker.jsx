import { Volume2, Upload, Play, RotateCcw } from 'lucide-react';
import { builtinSoundNames, getBuiltinSound, resolveSoundUrl, playSound } from '../lib/sounds';
import { useT } from '../lib/i18n';

// Sélecteur de son réutilisable (notifications, minuteur…). Le parent fournit
// le couple { name, data } et reçoit les changements ; `data` est une piste
// importée (data URL) qui prime sur le son intégré `name`.
//
// `allowNone` : autorise « aucun son / son système » (bouton de remise à zéro
// qui vide les deux champs) — utile pour les notifications, où l'absence de
// son personnalisé laisse le système jouer le sien.
export default function SoundPicker({
  title,
  description,
  name,
  data,
  volume = 80,
  allowNone = false,
  noneLabel,
  onChange,
}) {
  const t = useT();
  const current = resolveSoundUrl(name, data);

  const preview = (url) => playSound(url, volume);

  return (
    <div className="card">
      <h4 className="font-semibold mb-2">{title}</h4>
      {description && <p className="text-sm text-text-muted mb-4">{description}</p>}

      {/* Sons proposés (intégrés) — clic = sélectionner + écouter */}
      <div className="flex flex-wrap gap-2 mb-4">
        {builtinSoundNames.map((n) => {
          const selected = !data && name === n;
          return (
            <button
              key={n}
              onClick={() => {
                const url = getBuiltinSound(n);
                onChange({ name: n, data: '' });
                preview(url);
              }}
              className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-secondary'}`}
            >
              <Volume2 size={13} className="mr-1" />
              {n}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-text-secondary">
          {data
            ? `🔊 ${name || t('st.customSound')}`
            : name
              ? `🔊 ${name}`
              : noneLabel || t('st.systemSound')}
        </span>
        <div className="flex gap-2 ml-auto">
          <label className="btn btn-secondary btn-sm cursor-pointer">
            <Upload size={13} className="mr-1" />
            {t('st.chooseSound')}
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files && e.target.files[0];
                e.target.value = '';
                if (!file) return;
                if (file.size > 1024 * 1024) {
                  alert(t('st.soundTooHeavy'));
                  return;
                }
                const reader = new FileReader();
                reader.onload = () =>
                  onChange({ name: file.name, data: String(reader.result || '') });
                reader.readAsDataURL(file);
              }}
            />
          </label>
          {current && (
            <button onClick={() => preview(current)} className="btn btn-secondary btn-sm">
              <Play size={13} className="mr-1" />
              {t('st.testSound')}
            </button>
          )}
          {allowNone && (data || name) && (
            <button
              onClick={() => onChange({ name: '', data: '' })}
              className="btn btn-sm text-error hover:bg-error/10"
            >
              <RotateCcw size={13} className="mr-1" />
              {t('st.defaultSound')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
