import { useRef, useState } from 'react';
import { X, Globe, ImageIcon, Trash2, Check } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { EMOJI_CHOICES, COLOR_CHOICES, faviconServiceUrl } from '../lib/appIcons';
import { homeUrlFor } from '../lib/urls';
import AppIcon from './AppIcon';
import { useT } from '../lib/i18n';

function normalizeUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Modal d'édition d'une application installée : nom, URL (seulement pour
// les apps personnalisées — les recettes gardent leur page d'origine),
// icône (emoji, favicon du site ou image téléversée) et couleur.
export default function EditAppModal({ app, onClose }) {
  const updateApp = useStore((s) => s.updateApp);
  const t = useT();
  const [name, setName] = useState(app.name);
  const [url, setUrl] = useState(app.url || '');
  const [emoji, setEmoji] = useState(app.icon || '🌐');
  // L'utilisateur a-t-il cliqué sur un emoji de la grille ? (distinguer un
  // choix EXPLICITE de l'emoji par défaut « 🌐 » jamais touché)
  const [emojiTouched, setEmojiTouched] = useState(false);
  const [iconImage, setIconImage] = useState(app.iconImage || '');
  const [useSiteFavicon, setUseSiteFavicon] = useState(Boolean(app.favicon && !app.iconImage));
  // Icône effective : emoji choisi explicitement (aujourd'hui ou déjà
  // enregistré) → il prime ; sinon image/favicon/auto.
  const effectiveIconEmoji = !iconImage && !useSiteFavicon && (emojiTouched || app.iconEmoji);
  const [color, setColor] = useState(app.color || '#6366f1');
  const [proxy, setProxy] = useState(app.proxy || '');
  // '' = suit le réglage global, 'on' = toujours bloquer, 'off' = jamais
  const [adblock, setAdblock] = useState(app.adblock || '');
  // 'profile' (défaut) = visible dans son profil ; 'all' = dans tous
  const [scope, setScope] = useState(app.scope === 'all' ? 'all' : 'profile');
  const fileRef = useRef(null);

  const isCustom = !app.recipeId; // URL modifiable uniquement pour les apps personnalisées

  const handleUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setIconImage(String(reader.result || ''));
      setUseSiteFavicon(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSave = () => {
    const updates = {
      name: name.trim() || app.name,
      icon: emoji,
      color,
      // Image téléversée : prioritaire sur tout ; vide = retirée
      iconImage: iconImage || undefined,
      favicon: useSiteFavicon ? faviconServiceUrl(url || app.url) : undefined,
      // Emoji choisi explicitement → prime sur le favicon automatique
      iconEmoji: effectiveIconEmoji || undefined,
      // Proxy/VPN spécifique à cette app (vide = suit le profil / le global)
      proxy: proxy.trim() || undefined,
      // Bloqueur de pub propre à cette app (absent = suit le réglage global)
      adblock: adblock || undefined,
      // Portée : une app « tous profils » reste UNE app avec UNE session —
      // c'est ce qui la distingue d'une seconde installation.
      scope: scope === 'all' ? 'all' : undefined,
    };
    if (isCustom) {
      const u = normalizeUrl(url);
      if (u) {
        updates.url = u;
        updates.homeUrl = homeUrlFor(u);
      }
    }
    updateApp(app.id, updates);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-bg-secondary border border-border rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="h-14 border-b border-border flex items-center justify-between px-5">
          <h3 className="font-semibold">{t('edit.title', { name: app.name })}</h3>
          <button onClick={onClose} className="btn-icon" title={t('common.close')}>
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Nom */}
          <div>
            <label className="text-xs text-text-muted block mb-1.5">{t('edit.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              autoFocus
            />
          </div>

          {/* URL — uniquement pour les apps personnalisées */}
          {isCustom && (
            <div>
              <label className="text-xs text-text-muted block mb-1.5">URL</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t('edit.urlPlaceholder')}
                  className="input pl-10"
                />
              </div>
            </div>
          )}

          {/* Icône */}
          <div>
            <label className="text-xs text-text-muted block mb-1.5">{t('edit.icon')}</label>
            <div className="flex items-center gap-3 mb-3">
              {/* Aperçu de l'icône choisie */}
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 border border-border"
                style={{ backgroundColor: `${color}20` }}
              >
                {iconImage ? (
                  <img src={iconImage} alt="" className="w-8 h-8 object-contain" draggable={false} />
                ) : (
                  <AppIcon
                    app={{ ...app, icon: emoji, iconImage: '', favicon: useSiteFavicon ? faviconServiceUrl(url || app.url) : undefined, iconEmoji: effectiveIconEmoji, url: url || app.url }}
                    className="w-8 h-8"
                  />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="btn btn-secondary btn-sm"
                  title={t('edit.uploadTitle')}
                >
                  <ImageIcon size={14} /> {t('edit.image')}
                </button>
                <button
                  onClick={() => setUseSiteFavicon((v) => !v)}
                  className={`btn btn-sm ${useSiteFavicon ? 'btn-primary' : 'btn-secondary'}`}
                  title={t('edit.faviconTitle')}
                >
                  <Globe size={14} /> Favicon
                </button>
                {iconImage && (
                  <button
                    onClick={() => setIconImage('')}
                    className="btn btn-secondary btn-sm text-error hover:bg-error/10"
                    title={t('edit.removeImage')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleUpload}
              />
            </div>

            <div className="grid grid-cols-10 gap-1.5 max-h-40 overflow-y-auto pr-1">
              {EMOJI_CHOICES.map((e, i) => (
                <button
                  key={`${e}-${i}`}
                  onClick={() => {
                    setEmoji(e);
                    setEmojiTouched(true);
                    setIconImage('');
                    setUseSiteFavicon(false);
                  }}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-all ${
                    emoji === e && !iconImage && !useSiteFavicon
                      ? 'bg-accent-primary/20 ring-2 ring-accent-primary'
                      : 'bg-bg-elevated hover:bg-bg-hover'
                  }`}
                  title={e}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Couleur */}
          <div>
            <label className="text-xs text-text-muted block mb-1.5">{t('edit.color')}</label>
            <div className="flex gap-1.5 flex-wrap">
              {COLOR_CHOICES.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-lg transition-all ${
                    color === c ? 'ring-2 ring-white scale-110' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Portée : profil d'origine seulement, ou tous les profils */}
          <div>
            <label className="text-xs text-text-muted block mb-1.5">{t('edit.scopeLabel')}</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)} className="input">
              <option value="profile">{t('edit.scopeProfile')}</option>
              <option value="all">{t('edit.scopeAll')}</option>
            </select>
            <p className="text-xs text-text-muted mt-1.5">{t('edit.scopeHint')}</p>
            {scope === 'all' && (
              <p className="text-xs text-warning mt-1.5">{t('edit.scopeLockWarning')}</p>
            )}
          </div>

          {/* Bloqueur de pub spécifique à cette app */}
          <div>
            <label className="text-xs text-text-muted block mb-1.5">{t('edit.adblockLabel')}</label>
            <select
              value={adblock}
              onChange={(e) => setAdblock(e.target.value)}
              className="input"
            >
              <option value="">{t('edit.adblockInherit')}</option>
              <option value="on">{t('edit.adblockOn')}</option>
              <option value="off">{t('edit.adblockOff')}</option>
            </select>
            <p className="text-xs text-text-muted mt-1.5">{t('edit.adblockHint')}</p>
          </div>

          {/* Proxy / VPN spécifique à cette app */}
          <div>
            <label className="text-xs text-text-muted block mb-1.5">
              {t('edit.proxyLabel')}
            </label>
            <input
              type="text"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              placeholder="socks5://host:port"
              className="input"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex gap-2">
          <button onClick={handleSave} className="flex-1 btn btn-primary">
            <Check size={16} /> {t('common.save')}
          </button>
          <button onClick={onClose} className="btn btn-secondary">
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
