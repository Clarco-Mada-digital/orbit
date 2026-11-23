import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Bell,
  MapPin,
  MonitorUp,
  ClipboardPaste,
  KeyRound,
  ShieldQuestion,
  X,
  RotateCw,
} from 'lucide-react';
import { getWebContentsIdFor, reloadApp } from '../../lib/webviewRegistry';
import { useDismiss } from '../../lib/useDismiss';

// ---------------------------------------------------------------------------
// Bouton « Autorisations » de la barre (équivalent du cadenas de Chrome).
//
// Dans l'esprit d'Orbit, il ne prend de place que lorsqu'il sert : il reste
// invisible tant que le site actif n'a rien demandé et qu'aucune décision n'a
// été prise pour lui. Dès qu'une page réclame la caméra, le micro, les
// notifications… il apparaît — en rouge si quelque chose a été bloqué — et
// permet de débloquer sur place, sans fouiller dans les Paramètres.
//
// L'utilisateur peut aussi le retirer de la barre comme n'importe quel module
// (Paramètres → Barre supérieure).
// ---------------------------------------------------------------------------

// Les accès qu'on propose toujours, même jamais demandés : ce sont ceux qui
// bloquent le plus souvent une visio, une messagerie ou une carte.
const COMMON = ['media', 'notifications', 'geolocation', 'display-capture', 'clipboard-read'];

const ICONS = {
  media: Camera,
  notifications: Bell,
  geolocation: MapPin,
  'display-capture': MonitorUp,
  'desktop-capture': MonitorUp,
  'clipboard-read': ClipboardPaste,
  fileSystem: KeyRound,
};

function originOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

export default function PermissionsButton({ appId, url, menuAlign, menuPos, t }) {
  const api = window.electronAPI?.sitePermissions;
  const origin = originOf(url);
  const [info, setInfo] = useState({ key: null, decisions: {}, requests: {} });
  const [show, setShow] = useState(false);
  const [dirty, setDirty] = useState(false);
  const key = `${appId}|${origin}`;

  const refresh = useCallback(async () => {
    if (!api?.forSite || !origin) return;
    const res = await api.forSite(origin, getWebContentsIdFor(appId));
    if (res?.success) {
      setInfo({ key, decisions: res.decisions || {}, requests: res.requests || {} });
    }
  }, [api, origin, appId, key]);

  // Relecture à chaque navigation. Le délai rend l'appel asynchrone : aucun
  // setState n'a lieu pendant l'effet lui-même.
  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [refresh, url]);

  // Une demande vient d'être traitée quelque part : on relit si elle concerne
  // le site affiché (le bouton peut alors apparaître).
  useEffect(() => {
    if (!api?.onActivity) return undefined;
    return api.onActivity((data) => {
      if (data?.origin === origin) refresh();
    });
  }, [api, origin, refresh]);

  const close = useCallback(() => setShow(false), []);
  const ref = useRef(null);
  useDismiss(ref, show, close);

  // Les infos d'un autre site/app ne doivent jamais s'afficher, même une frame.
  const decisions = info.key === key ? info.decisions : {};
  const requests = info.key === key ? info.requests : {};
  const blocked = Object.values(requests).includes('blocked');
  const visible = origin && (show || Object.keys(decisions).length > 0 || Object.keys(requests).length > 0);
  if (!visible) return null;

  const list = [...new Set([...COMMON, ...Object.keys(requests), ...Object.keys(decisions)])];

  const change = async (permission, value) => {
    await api?.set?.(origin, permission, value || null);
    setDirty(true);
    refresh();
  };

  const label = (permission) => {
    const k = `perm.title.${permission}`;
    return t(k) === k ? permission : t(k);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setShow((v) => !v)}
        className={`btn-icon relative ${show ? 'bg-bg-hover' : ''} ${blocked ? 'text-error' : ''}`}
        title={blocked ? t('permbtn.titleBlocked') : t('permbtn.title')}
      >
        <ShieldQuestion size={18} />
        {blocked && (
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-error" />
        )}
      </button>
      {show && (
        <div
          className={`absolute ${menuAlign} ${menuPos} z-50 w-80 p-4 bg-bg-elevated border border-border rounded-xl shadow-2xl space-y-3`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <div className="min-w-0">
              <h4 className="font-semibold">{t('permbtn.title')}</h4>
              <div className="text-xs text-text-muted truncate" title={origin}>
                {origin.replace(/^https?:\/\//, '')}
              </div>
            </div>
            <button onClick={close} className="btn-icon">
              <X size={16} />
            </button>
          </div>

          <div className="space-y-2">
            {list.map((permission) => {
              const Icon = ICONS[permission] || ShieldQuestion;
              const current = decisions[permission]?.value || '';
              const asked = requests[permission];
              return (
                <div key={permission} className="flex items-center gap-2">
                  <Icon
                    size={16}
                    className={asked === 'blocked' ? 'text-error' : 'text-text-muted'}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{label(permission)}</div>
                    {asked && (
                      <div
                        className={`text-[11px] ${asked === 'blocked' ? 'text-error' : 'text-success'}`}
                      >
                        {asked === 'blocked' ? t('permbtn.askedBlocked') : t('permbtn.askedAllowed')}
                      </div>
                    )}
                  </div>
                  <select
                    value={current}
                    onChange={(e) => change(permission, e.target.value)}
                    className="input py-1 px-2 text-xs w-28"
                  >
                    <option value="">{t('permbtn.ask')}</option>
                    <option value="allow">{t('perm.allow')}</option>
                    <option value="deny">{t('perm.block')}</option>
                  </select>
                </div>
              );
            })}
          </div>

          {dirty ? (
            <button
              onClick={() => {
                setDirty(false);
                reloadApp(appId);
              }}
              className="btn btn-primary btn-sm w-full flex items-center justify-center gap-2"
            >
              <RotateCw size={14} />
              {t('permbtn.reload')}
            </button>
          ) : (
            <p className="text-[11px] text-text-muted">{t('permbtn.hint')}</p>
          )}
        </div>
      )}
    </div>
  );
}
