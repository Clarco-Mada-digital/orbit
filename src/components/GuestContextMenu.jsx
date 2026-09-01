import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Link2,
  Copy,
  Scissors,
  ClipboardPaste,
  TextSelect,
  Languages,
  Volume2,
  VolumeX,
  Search,
  Download,
  Music,
  Camera,
  Image as ImageIcon,
  ExternalLink,
  PictureInPicture2,
  Bug,
  SpellCheck,
  ChevronRight,
  KeyRound,
} from 'lucide-react';
import { useT } from '../lib/i18n';
import { getWebview } from '../lib/webviewRegistry';
import { useStore } from '../stores/useStore';
import { useDismiss } from '../lib/useDismiss';

// ---------------------------------------------------------------------------
// Menu contextuel des apps embarquées
//
// Remplace le Menu natif d'Electron, qui ne se met pas en forme : on ne peut y
// mettre ni rangée d'icônes, ni sections, ni le style d'Orbit. Ici les actions
// de navigation — celles qu'on reconnaît d'un coup d'œil — forment une rangée
// d'icônes en tête, le reste garde du texte lisible.
//
// Le processus principal reste le seul à connaître les URL : on ne lui renvoie
// qu'un nom d'action (voir `ctx:action` dans main.js).
// ---------------------------------------------------------------------------

const MENU_WIDTH = 248;
const MARGIN = 8;

export default function GuestContextMenu() {
  const t = useT();
  const [menu, setMenu] = useState(null); // état reçu du processus principal
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [shots, setShots] = useState(false); // sous-section « capture » dépliée
  const [active, setActive] = useState(-1); // navigation clavier
  const ref = useRef(null);
  const apps = useStore((s) => s.apps);

  // Où se trouve le clic à l'écran ? Le processus principal donne des
  // coordonnées relatives au CONTENU de la page ; il faut y ajouter la position
  // du <webview> dans la fenêtre, et tenir compte du zoom de l'app.
  const anchorFor = useCallback(
    (state) => {
      for (const app of apps) {
        const wv = getWebview(app.id);
        if (!wv) continue;
        let id;
        try {
          id = wv.getWebContentsId();
        } catch {
          continue;
        }
        if (id !== state.wcId) continue;
        const rect = wv.getBoundingClientRect();
        const z = state.zoom || 1;
        return { left: rect.left + state.x * z, top: rect.top + state.y * z };
      }
      // Webview introuvable (app démontée entre-temps) : on centre plutôt que
      // de poser le menu dans un coin.
      return { left: window.innerWidth / 2, top: window.innerHeight / 3 };
    },
    [apps]
  );

  useEffect(() => {
    const off = window.electronAPI?.contextMenu?.onShow?.((state) => {
      setShots(false);
      setActive(-1);
      setMenu(state);
      setPos(anchorFor(state));
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [anchorFor]);

  const close = useCallback(() => setMenu(null), []);

  const run = useCallback(
    (action, value) => {
      if (menu) window.electronAPI?.contextMenu?.run?.(menu.wcId, action, value);
      close();
    },
    [menu, close]
  );

  // Repositionnement après mesure : on connaît la hauteur réelle seulement une
  // fois le menu rendu, donc on ne peut décider de le retourner qu'ici.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const h = ref.current.offsetHeight;
    setPos((p) => {
      let left = p.left;
      let top = p.top;
      if (left + MENU_WIDTH + MARGIN > window.innerWidth) left = Math.max(MARGIN, left - MENU_WIDTH);
      if (top + h + MARGIN > window.innerHeight) top = Math.max(MARGIN, window.innerHeight - h - MARGIN);
      return left === p.left && top === p.top ? p : { left, top };
    });
  }, [menu, shots]);

  // Fermeture : clic ailleurs, Échap, perte de focus… et surtout clic DANS la
  // page, qui est le cas le plus fréquent ici — le menu s'ouvre au-dessus d'une
  // app, donc le clic suivant a toutes les chances d'y atterrir. Sans le relais
  // du preload, ce clic est invisible depuis l'interface (voir lib/useDismiss).
  useDismiss(ref, Boolean(menu), close);

  // Composition des entrées texte, dans l'ordre d'affichage.
  const items = useMemo(() => {
    if (!menu) return [];
    const list = [];
    const push = (item) => list.push(item);
    const sep = () => {
      if (list.length && list[list.length - 1] !== 'sep') list.push('sep');
    };

    // Correcteur orthographique : les suggestions passent avant tout le reste,
    // c'est ce qu'on vient chercher quand on clique droit sur un mot souligné.
    if (menu.misspelled && menu.suggestions.length) {
      menu.suggestions.forEach((word) =>
        push({ key: 'sp-' + word, icon: SpellCheck, label: word, bold: true, action: 'replaceMisspelling', value: word })
      );
      sep();
    }

    if (menu.isEditable) {
      push({ key: 'cut', icon: Scissors, label: t('cm.cut'), action: 'cut', disabled: !menu.canCut });
      push({ key: 'copy', icon: Copy, label: t('cm.copy'), action: 'copy', disabled: !menu.canCopy });
      push({ key: 'paste', icon: ClipboardPaste, label: t('cm.paste'), action: 'paste', disabled: !menu.canPaste });
      push({ key: 'all', icon: TextSelect, label: t('cm.selectAll'), action: 'selectAll' });
      if (menu.isPasswordField) {
        push({ key: 'genpw', icon: KeyRound, label: t('cm.generatePassword'), action: 'generatePassword' });
      }
      sep();
    } else if (menu.hasSelection) {
      push({ key: 'copy', icon: Copy, label: t('cm.copy'), action: 'copy' });
      push({
        key: 'tr',
        icon: Languages,
        label: t('cm.translate', { lang: menu.translateTarget }),
        action: 'translate',
      });
      push({ key: 'say', icon: Volume2, label: t('cm.speakSelection'), action: 'speakSelection' });
      push({
        key: 'find',
        icon: Search,
        label: t('cm.search', { text: menu.selectionPreview }),
        action: 'search',
      });
      sep();
    }

    if (menu.hasLink) {
      push({ key: 'lo', icon: ExternalLink, label: t('cm.openLink'), action: 'openLink' });
      push({ key: 'lc', icon: Link2, label: t('cm.copyLink'), action: 'copyLink' });
      push({ key: 'ld', icon: Download, label: t('cm.downloadLink'), action: 'downloadLink' });
      sep();
    }

    if (menu.hasImage) {
      push({ key: 'ic', icon: ImageIcon, label: t('cm.copyImage'), action: 'copyImage' });
      push({ key: 'iu', icon: Link2, label: t('cm.copyImageUrl'), action: 'copyImageUrl' });
      push({ key: 'is', icon: Download, label: t('cm.saveImage'), action: 'saveImage' });
      sep();
    }

    if (menu.isVideo) {
      push({ key: 'pip', icon: PictureInPicture2, label: t('cm.pip'), action: 'pip' });
      sep();
    }

    if (!menu.isEditable) {
      push({ key: 'dv', icon: Download, label: t('cm.downloadVideo'), action: 'downloadVideo' });
      push({ key: 'da', icon: Music, label: t('cm.downloadAudio'), action: 'downloadAudio' });
      sep();
      push({ key: 'sp', icon: Volume2, label: t('cm.speakPage'), action: 'speakPage' });
    }
    if (menu.speaking) {
      push({ key: 'st', icon: VolumeX, label: t('cm.stopSpeak'), action: 'stopSpeak' });
    }
    sep();

    push({ key: 'shot', icon: Camera, label: t('cm.screenshot'), expand: true });
    if (shots) {
      push({ key: 's1', label: t('cm.shotVisible'), action: 'screenshot', value: 'visible', sub: true });
      push({ key: 's2', label: t('cm.shotFull'), action: 'screenshot', value: 'full', sub: true });
      push({ key: 's3', label: t('cm.shotSelection'), action: 'screenshot', value: 'selection', sub: true });
    }

    push({ key: 'url', icon: Link2, label: t('cm.copyPageUrl'), action: 'copyPageUrl' });

    if (menu.isDev) {
      sep();
      push({ key: 'dev', icon: Bug, label: t('cm.inspect'), action: 'inspect' });
    }

    return list;
  }, [menu, shots, t]);

  // Navigation au clavier sur les entrées texte activables.
  const selectable = useMemo(
    () => items.map((it, i) => (it !== 'sep' && !it.disabled ? i : -1)).filter((i) => i >= 0),
    [items]
  );

  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
      e.preventDefault();
      if (e.key === 'Enter') {
        const item = items[active];
        if (item && item !== 'sep') {
          if (item.expand) setShots((v) => !v);
          else run(item.action, item.value);
        }
        return;
      }
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const cur = selectable.indexOf(active);
      const next = selectable[(cur + dir + selectable.length) % selectable.length];
      setActive(next === undefined ? selectable[0] : next);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu, items, active, selectable, run]);

  if (!menu) return null;

  const IconAction = ({ icon: Icon, label, action, disabled }) => (
    <button
      onClick={() => !disabled && run(action)}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex-1 h-9 rounded-lg flex items-center justify-center transition-colors ${
        disabled
          ? 'text-text-muted/40 cursor-default'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      }`}
    >
      <Icon size={17} />
    </button>
  );

  return (
    <div
      ref={ref}
      // Au-dessus des <webview>, qui ont leur propre surface de composition.
      className="fixed z-[9000] bg-bg-elevated border border-border rounded-xl shadow-2xl py-1.5 animate-scale-in select-none"
      style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Rangée d'icônes : les gestes de navigation, qu'on reconnaît sans les
          lire. Ils occupaient quatre lignes de texte dans le menu natif. */}
      <div className="flex items-center gap-0.5 px-1.5 pb-1.5 mb-1 border-b border-border">
        <IconAction icon={ArrowLeft} label={t('cm.back')} action="back" disabled={!menu.canBack} />
        <IconAction icon={ArrowRight} label={t('cm.forward')} action="forward" disabled={!menu.canFwd} />
        <IconAction icon={RotateCw} label={t('cm.reload')} action="reload" />
        <IconAction icon={Link2} label={t('cm.copyPageUrl')} action="copyPageUrl" />
        <IconAction icon={Camera} label={t('cm.shotVisible')} action="screenshot" />
      </div>

      <div className="max-h-[min(70vh,30rem)] overflow-y-auto">
        {items.map((item, i) =>
          item === 'sep' ? (
            <div key={'sep' + i} className="my-1 border-t border-border" />
          ) : (
            <button
              key={item.key}
              onMouseEnter={() => setActive(i)}
              onClick={() => (item.expand ? setShots((v) => !v) : run(item.action, item.value))}
              disabled={item.disabled}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors ${
                item.sub ? 'pl-9' : ''
              } ${
                item.disabled
                  ? 'text-text-muted/40 cursor-default'
                  : active === i
                    ? 'bg-bg-hover text-text-primary'
                    : 'text-text-secondary'
              }`}
            >
              {item.icon ? (
                <item.icon size={15} className="flex-shrink-0" />
              ) : (
                !item.sub && <span className="w-[15px] flex-shrink-0" />
              )}
              <span className={`flex-1 truncate ${item.bold ? 'font-semibold' : ''}`}>{item.label}</span>
              {item.expand && (
                <ChevronRight
                  size={14}
                  className={`flex-shrink-0 transition-transform ${shots ? 'rotate-90' : ''}`}
                />
              )}
            </button>
          )
        )}
      </div>
    </div>
  );
}
