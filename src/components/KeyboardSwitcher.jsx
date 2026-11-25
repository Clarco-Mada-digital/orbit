import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useSecurityStore } from '../lib/securityStore';
import AppIcon from './AppIcon';
import {
  COMMIT_DELAY_MS,
  appCycleList,
  moveSwitcher,
  openSwitcher,
  profileCycleList,
} from '../lib/keyboardSwitcher';

// ---------------------------------------------------------------------------
// Sélecteur au clavier : Alt+Page↓ / Alt+Page↑ (apps), avec ⇧ (profils).
//
// Une petite pastille apparaît en haut ; chaque appui avance la sélection SANS rien
// ouvrir. On valide en relâchant Alt (comme Alt+Tab), avec Entrée, ou en
// s'arrêtant un peu plus d'une seconde (un trait fin montre le temps
// restant). Échap annule. Flèches et Tab déplacent aussi.
//
// Au clic, rien ne change : on voit déjà tout, on va directement à la cible.
//
// Quand le focus est DANS une page, ses touches n'arrivent pas ici : le
// processus principal relaie Entrée, Échap, les flèches et le relâchement
// d'Alt tant que le sélecteur est ouvert (voir `switcher:setOpen`).
// ---------------------------------------------------------------------------

const TILE = 40;
const GAP = 6;
const mac = () => window.electronAPI?.platform === 'darwin';

export default function KeyboardSwitcher() {
  const [state, setState] = useState(null); // { kind, ids, currentId, index, steps }
  const [leaving, setLeaving] = useState(false);
  const stateRef = useRef(null);
  const rootRef = useRef(null);
  const timer = useRef(null);

  const apps = useStore((s) => s.apps);
  const profiles = useStore((s) => s.profiles);
  const { lockedProfileIds, unlockedProfileIds } = useSecurityStore();

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setOpenInMain = (open) => window.electronAPI?.switcher?.setOpen?.(open);

  const close = useCallback((animate = true) => {
    clearTimeout(timer.current);
    setOpenInMain(false);
    if (!animate) {
      setState(null);
      return;
    }
    setLeaving(true);
    setTimeout(() => {
      setState(null);
      setLeaving(false);
    }, 140);
  }, []);

  const commit = useCallback(() => {
    const st = stateRef.current;
    if (!st) return;
    const id = st.ids[st.index];
    const store = useStore.getState();
    if (id && id !== st.currentId) {
      if (st.kind === 'profile') store.setActiveProfile(id);
      else store.setActiveApp(id);
    }
    close();
  }, [close]);

  const armTimer = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(commit, COMMIT_DELAY_MS);
  }, [commit]);

  // Raccourci pressé (relayé par App) : ouvrir, ou avancer.
  useEffect(() => {
    const onStep = (e) => {
      const { kind, step } = e.detail || {};
      const st = stateRef.current;
      if (st && st.kind === kind && !leaving) {
        setState(moveSwitcher(st, step));
      } else {
        const store = useStore.getState();
        const items = kind === 'profile' ? profileCycleList(store) : appCycleList(store);
        const currentId = kind === 'profile' ? store.activeProfile : store.activeApp;
        const next = openSwitcher(kind, items, currentId, step);
        if (!next) return;
        setLeaving(false);
        setState(next);
        setOpenInMain(true);
      }
      armTimer();
    };
    const onKey = (e) => {
      if (!stateRef.current) return;
      const op = e.detail;
      if (op === 'commit') commit();
      else if (op === 'cancel') close();
      else if (op === 'next' || op === 'prev') {
        setState((st) => moveSwitcher(st, op === 'next' ? 1 : -1));
        armTimer();
      }
    };
    window.addEventListener('orbit:switcher', onStep);
    window.addEventListener('orbit:switcher-key', onKey);
    return () => {
      window.removeEventListener('orbit:switcher', onStep);
      window.removeEventListener('orbit:switcher-key', onKey);
    };
  }, [armTimer, commit, close, leaving]);

  // Focus dans l'interface d'Orbit : on écoute le clavier directement.
  useEffect(() => {
    if (!state) return undefined;
    const modifier = mac() ? 'Meta' : 'Alt';
    const down = (e) => {
      const ops = { Enter: 'commit', Escape: 'cancel', ArrowRight: 'next', ArrowDown: 'next', ArrowLeft: 'prev', ArrowUp: 'prev' };
      let op = ops[e.key];
      if (e.key === 'Tab') op = e.shiftKey ? 'prev' : 'next';
      if (!op) return;
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('orbit:switcher-key', { detail: op }));
    };
    const up = (e) => {
      if (e.key === modifier) commit();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    // Clic ailleurs dans l'interface : on annule.
    const outside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    };
    window.addEventListener('mousedown', outside, true);
    // Orbit perd le focus (autre application) : on annule, rien ne bascule
    // dans le dos de l'utilisateur.
    const blur = () => close(false);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('mousedown', outside, true);
    };
  }, [state, commit, close]);

  useEffect(() => () => {
    clearTimeout(timer.current);
    setOpenInMain(false);
  }, []);

  if (!state) return null;

  const isProfile = state.kind === 'profile';
  const items = state.ids
    .map((id) => (isProfile ? profiles.find((p) => p.id === id) : apps.find((a) => a.id === id)))
    .filter(Boolean);
  const selected = items[state.index];
  const profileLocked = (id) => lockedProfileIds.includes(id) && !unlockedProfileIds.includes(id);
  const appsIn = (pid) => apps.filter((a) => a.profileId === pid).length;

  // Rangée centrée sur l'élément désigné ; elle glisse au lieu de sauter.
  const offset = state.index * (TILE + GAP) + TILE / 2;
  const detail = isProfile
    ? `${appsIn(selected?.id)} app${appsIn(selected?.id) > 1 ? 's' : ''}${profileLocked(selected?.id) ? ' · verrouillé' : ''}`
    : (() => {
        try {
          return new URL(selected?.url).hostname.replace(/^www\./, '');
        } catch {
          return selected?.native ? 'Outil Orbit' : '';
        }
      })();

  // Discret : une petite pastille en haut, au centre, sans voile sur la page.
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={isProfile ? 'Changer de profil' : 'Changer d’application'}
      className={`fixed left-1/2 top-14 z-[10002] -translate-x-1/2 transition-all duration-150 ${
        leaving ? '-translate-y-1 opacity-0' : 'animate-scale-in opacity-100'
      }`}
    >
      <div className="relative w-[min(86vw,360px)] overflow-hidden rounded-2xl border border-border/70 bg-bg-elevated/85 px-2 pb-2 pt-2 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div
          className="relative h-12 overflow-hidden"
          style={{
            maskImage: 'linear-gradient(to right, transparent, #000 18%, #000 82%, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, #000 18%, #000 82%, transparent)',
          }}
        >
          <div
            className="absolute left-1/2 top-0 flex h-12 items-center transition-transform duration-300 ease-[cubic-bezier(.2,.9,.25,1.1)]"
            style={{ gap: GAP, transform: `translateX(${-offset}px)` }}
          >
            {items.map((item, i) => {
              const active = i === state.index;
              const isCurrent = item.id === state.currentId;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.name}
                  onClick={() => {
                    stateRef.current = { ...stateRef.current, index: i };
                    commit();
                  }}
                  className={`relative flex shrink-0 items-center justify-center rounded-xl text-xl transition-all duration-200 ${
                    active ? 'scale-110 opacity-100' : 'scale-90 opacity-45 hover:opacity-75'
                  }`}
                  style={{
                    width: TILE,
                    height: TILE,
                    background: `${item.color || '#6366f1'}${active ? '30' : '1a'}`,
                    boxShadow: active ? '0 0 0 2px rgb(var(--accent-primary))' : undefined,
                  }}
                >
                  {isProfile ? (
                    <span className="leading-none">{item.emoji || '👤'}</span>
                  ) : (
                    <AppIcon app={item} className="h-6 w-6 rounded-md" fallbackClassName="text-xl" />
                  )}
                  {!isProfile && item.unread > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-bg-elevated" />
                  ) : null}
                  {isProfile && profileLocked(item.id) ? (
                    <Lock size={9} className="absolute -right-0.5 -top-0.5 rounded-full bg-bg-elevated p-px text-text-secondary" />
                  ) : null}
                  {isCurrent && !active ? <span className="absolute -bottom-1 h-1 w-1 rounded-full bg-text-muted" /> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div key={selected?.id} className="mt-1 flex items-baseline justify-center gap-1.5 truncate px-2 text-xs animate-fade-in">
          <span className="truncate font-medium text-text-primary">{selected?.name}</span>
          {detail ? <span className="truncate text-text-muted">· {detail}</span> : null}
        </div>

        {/* Temps restant avant ouverture : un trait fin au bas de la pastille. */}
        <div
          key={state.steps}
          className="absolute bottom-0 left-0 h-0.5 bg-accent-primary/70"
          style={{ animation: `orbit-switcher-countdown ${COMMIT_DELAY_MS}ms linear forwards` }}
        />
      </div>
      <style>{'@keyframes orbit-switcher-countdown { from { width: 100%; } to { width: 0%; } }'}</style>
    </div>
  );
}
