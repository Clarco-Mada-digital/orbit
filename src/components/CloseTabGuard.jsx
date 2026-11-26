import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useMediaStore } from '../lib/mediaStore';
import { getWebview } from '../lib/webviewRegistry';
import { useT } from '../lib/i18n';

// ---------------------------------------------------------------------------
// Alt+W — fermer l'onglet libre affiché, avec un garde-fou.
//
//   • Onglet libre (page volante) sans activité → fermé tout de suite.
//   • Onglet libre OCCUPÉ (un son ou une vidéo joue, du texte a été tapé dans
//     un formulaire) → on demande d'abord. Alt+W une seconde fois, ou
//     « Fermer quand même », confirme ; Échap ou « Annuler » garde la page.
//   • Application installée → jamais fermée au clavier : la supprimer se
//     confirme ailleurs, et un geste réflexe ne doit pas perdre une session.
//     Un court rappel indique quoi faire à la place.
//
// Déclenché par l'événement 'orbit:close-tab' (voir runShortcut dans App).
// ---------------------------------------------------------------------------

// Lu DANS la page : du texte saisi et pas encore envoyé ? (lecture seule)
const PAGE_CHECK = `(() => {
  try {
    const typed = [...document.querySelectorAll('textarea, input')].some((el) => {
      const type = (el.type || 'text').toLowerCase();
      if (el.tagName === 'INPUT' && !['text', 'search', 'email', 'url', 'tel', 'number', ''].includes(type)) return false;
      return el.value && el.value.trim() && el.value !== el.defaultValue && el.offsetParent !== null;
    });
    const active = document.activeElement;
    const editing = Boolean(active && active.isContentEditable && (active.innerText || '').trim().length > 0);
    return { typed: typed || editing };
  } catch (e) { return { typed: false }; }
})()`;

async function busyReasons(id, t) {
  const reasons = [];
  if (useMediaStore.getState().media[id]?.playing) reasons.push(t('close.reason.media'));
  const wv = getWebview(id);
  if (wv && typeof wv.executeJavaScript === 'function') {
    try {
      const res = await Promise.race([
        wv.executeJavaScript(PAGE_CHECK),
        new Promise((resolve) => setTimeout(() => resolve(null), 400)),
      ]);
      if (res?.typed) reasons.push(t('close.reason.typed'));
    } catch {
      /* page pas prête : rien à protéger */
    }
  }
  return reasons;
}

export default function CloseTabGuard() {
  const t = useT();
  const [confirm, setConfirm] = useState(null); // { id, title, reasons }
  const [hint, setHint] = useState(false);
  const confirmRef = useRef(null);
  // Bulle « Onglet fermé · Rouvrir » : après TOUTE fermeture d'onglet libre
  // (clavier, croix, menu), quelques secondes.
  const lastClosed = useStore((s) => s.closedFlyPages[0] || null);
  const [seenClosedAt, setSeenClosedAt] = useState(() => lastClosed?.closedAt || 0);
  const showReopen = Boolean(lastClosed && lastClosed.closedAt > seenClosedAt);
  useEffect(() => {
    if (!showReopen) return undefined;
    const at = lastClosed.closedAt;
    const timer = setTimeout(() => setSeenClosedAt(at), 5000);
    return () => clearTimeout(timer);
  }, [showReopen, lastClosed]);
  const cancelRef = useRef(null);

  useEffect(() => {
    confirmRef.current = confirm;
    if (confirm) cancelRef.current?.focus();
  }, [confirm]);

  useEffect(() => {
    let hintTimer = null;
    const onClose = async () => {
      const st = useStore.getState();
      const id = st.activeApp;
      // Deuxième Alt+W pendant la question : c'est une confirmation.
      const pending = confirmRef.current;
      if (pending) {
        setConfirm(null);
        useStore.getState().closeFlyPage(pending.id);
        return;
      }
      const page = st.flyPages.find((p) => p.id === id);
      if (!page) {
        if (st.apps.some((a) => a.id === id)) {
          setHint(true);
          clearTimeout(hintTimer);
          hintTimer = setTimeout(() => setHint(false), 3500);
        }
        return;
      }
      const reasons = await busyReasons(id, t);
      // L'utilisateur a pu changer d'onglet pendant la vérification.
      if (useStore.getState().activeApp !== id) return;
      if (!reasons.length) {
        useStore.getState().closeFlyPage(id);
        return;
      }
      setConfirm({ id, title: page.title || page.name || page.url || '', reasons });
    };
    window.addEventListener('orbit:close-tab', onClose);
    return () => {
      clearTimeout(hintTimer);
      window.removeEventListener('orbit:close-tab', onClose);
    };
  }, [t]);

  useEffect(() => {
    if (!confirm) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setConfirm(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirm]);

  return (
    <>
      {showReopen && !hint && !confirm && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[10001] -translate-x-1/2 flex items-center gap-2 rounded-full border border-border bg-bg-elevated py-1 pl-3 pr-1 text-xs shadow-lg animate-scale-in app-no-drag"
        >
          <span className="text-text-secondary truncate max-w-[260px]">{t('close.closed', { title: lastClosed.title })}</span>
          <button
            type="button"
            onClick={() => {
              setSeenClosedAt(lastClosed.closedAt);
              useStore.getState().reopenClosedFlyPage();
            }}
            className="flex items-center gap-1 rounded-full bg-accent-primary/15 px-2.5 py-1 font-medium text-accent-primary hover:bg-accent-primary/25"
            title={t('close.reopenHint')}
          >
            <RotateCcw size={11} /> {t('close.reopen')}
          </button>
          <button type="button" onClick={() => setSeenClosedAt(lastClosed.closedAt)} className="btn-icon w-6 h-6" title={t('close.cancel')}>
            <X size={12} />
          </button>
        </div>
      )}
      {hint && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[10001] -translate-x-1/2 rounded-full border border-border bg-bg-elevated px-4 py-2 text-xs text-text-secondary shadow-lg animate-scale-in"
        >
          {t('close.appHint')}
        </div>
      )}
      {confirm && (
        <div
          className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirm(null);
          }}
        >
          <div
            role="alertdialog"
            aria-labelledby="close-tab-title"
            className="w-[min(420px,calc(100vw-2rem))] rounded-xl border border-border bg-bg-elevated p-4 shadow-2xl animate-scale-in"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-warning flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <h3 id="close-tab-title" className="font-semibold text-sm">
                  {t('close.title')}
                </h3>
                <p className="text-xs text-text-muted truncate mt-0.5">{confirm.title}</p>
                <ul className="mt-2 space-y-1 text-sm text-text-secondary">
                  {confirm.reasons.map((r) => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
              </div>
              <button onClick={() => setConfirm(null)} className="btn-icon w-7 h-7" title={t('close.cancel')}>
                <X size={14} />
              </button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button ref={cancelRef} onClick={() => setConfirm(null)} className="btn btn-secondary btn-sm">
                {t('close.cancel')}
              </button>
              <button
                onClick={() => {
                  const id = confirm.id;
                  setConfirm(null);
                  useStore.getState().closeFlyPage(id);
                }}
                className="btn btn-primary btn-sm"
              >
                {t('close.confirm')}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-text-muted text-right">{t('close.again')}</p>
          </div>
        </div>
      )}
    </>
  );
}
