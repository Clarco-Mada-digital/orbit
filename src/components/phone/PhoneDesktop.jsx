// ---------------------------------------------------------------------------
// Le bureau du Téléphone.
//
// Trois étages, empruntés à ce qui marche déjà ailleurs :
//
//   — en haut, une BARRE D'ÉTAT qui est aussi la poignée d'un VOLET. On la
//     tire (ou on clique) et les notifications et les contrôles rapides
//     descendent, comme sur le téléphone lui-même ;
//   — au milieu, une TOILE de widgets : chacun s'ajoute, s'enlève, se déplace
//     et change de taille. C'est une grille `auto-fill`, donc la même
//     disposition tient sur une fenêtre étroite et sur un écran large ;
//   — en bas, un DOCK : les applications épinglées et les gestes du téléphone.
//
// Le bureau est vide par défaut (l'heure et les favoris) : qui veut un bureau
// nu n'a rien à enlever, qui veut tout l'ajoute d'un clic — ou prend la
// disposition « complète » en un geste.
//
// Les fonds d'écran d'Orbit (dégradés ou image) restent le support de tout ça :
// le bureau ne pose que des cartes translucides par-dessus.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BellOff,
  BellRing,
  Bluetooth,
  BluetoothOff,
  Check,
  ChevronDown,
  FolderUp,
  ChevronUp,
  GripVertical,
  Home,
  LayoutGrid,
  Maximize2,
  Monitor,
  Moon,
  Plus,
  Power,
  Settings,
  Smartphone,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Vibrate,
  Volume1,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  WIDGET_CATALOG,
  WIDGET_SIZES,
  addWidget,
  cycleWidgetSize,
  moveWidget,
  presetLayout,
  removeWidget,
  widgetDefinition,
} from '../../lib/phoneDesktop';
import PhoneWidget, { WIDGET_ICONS } from './PhoneWidgets';

// Hauteur d'une rangée de la grille. Une carte « lg » en occupe deux.
const ROW = 104;

export default function PhoneDesktop({
  layout,
  onLayoutChange,
  device,
  apps,
  pinnedApps,
  favorites,
  recent,
  notifications,
  calls,
  calendar,
  media,
  storage,
  screen,
  mediaBusy,
  callBusy,
  controlBusy,
  sendingFiles,
  sendReport,
  mirrorRunning,
  shadeOpen,
  onShadeToggle,
  dockVisible,
  iconBase = 40,
  actions,
}) {
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const shadeRef = useRef(null);
  const canvasRef = useRef(null);
  // Nombre de colonnes réellement disponibles. Il est MESURÉ : une carte
  // « large » qui réclamerait quatre colonnes dans une fenêtre qui n'en tient
  // que deux déborderait de la grille (CSS ne borne pas un `span` tout seul).
  const [cols, setCols] = useState(4);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  // Largeur minimale d'une colonne : 11,5 rem. En dessous de deux colonnes on
  // reste à une seule — les cartes s'empilent, ce qui est le bon
  // comportement sur une fenêtre étroite.
  useEffect(() => {
    const node = canvasRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const width = node.clientWidth;
      if (!width) return;
      // Colonne visée : 232 px. Le reste est réparti par `1fr`, donc les
      // cartes s'élargissent pour occuper toute la largeur au lieu de
      // laisser une colonne vide au bout de la rangée.
      setCols(Math.max(1, Math.min(8, Math.round((width + 14) / (232 + 14)))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Le volet se referme au clic en dehors et à Échap : un volet qu'on ne sait
  // pas refermer est un volet qu'on n'ouvre plus.
  useEffect(() => {
    if (!shadeOpen) return undefined;
    const outside = (event) => {
      if (!shadeRef.current?.contains(event.target)) onShadeToggle(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') onShadeToggle(false);
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape);
    };
  }, [shadeOpen, onShadeToggle]);

  const data = useMemo(
    () => ({
      now,
      device,
      apps,
      favorites,
      recent,
      notifications,
      calls,
      calendar,
      media,
      storage,
      screen,
      mediaBusy,
      callBusy,
      iconBase,
    }),
    [now, device, apps, favorites, recent, notifications, calls, calendar, media, storage, screen, mediaBusy, callBusy, iconBase]
  );

  const onDrop = useCallback(
    (targetId) => {
      if (!dragging || dragging === targetId) return;
      onLayoutChange(moveWidget(layout, dragging, targetId));
      setDragging(null);
    },
    [dragging, layout, onLayoutChange]
  );

  const ringer = device?.ringerMode || null;
  const RingerIcon = ringer === 'vibrate' ? Vibrate : ringer === 'silent' ? BellOff : BellRing;
  const notifCount = notifications?.length || 0;

  // Les applications qu'on peut suivre par une tuile vivante : les épinglées
  // d'abord (c'est d'elles qu'on attend quelque chose), les favorites ensuite.
  const tileCandidates = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const app of [...(pinnedApps || []), ...(favorites || [])]) {
      if (!app?.package || seen.has(app.package)) continue;
      seen.add(app.package);
      list.push(app);
    }
    return list.slice(0, 12);
  }, [pinnedApps, favorites]);

  const alreadyPlaced = (type, pkg) =>
    layout.some((w) => w.type === type && (!pkg || w.package === pkg));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ---------------------------------------------------------------- */}
      {/* BARRE D'ÉTAT — et poignée du volet                              */}
      {/* ---------------------------------------------------------------- */}
      <div ref={shadeRef} className="relative z-20 shrink-0">
        <div className="flex items-center gap-2 border-b border-white/10 bg-slate-950/35 px-3 py-1.5 text-[11px] text-white/70 backdrop-blur-xl">
          <span className="flex min-w-0 items-center gap-1.5">
            <Smartphone size={12} className="shrink-0 text-sky-200/70" />
            <span className="truncate font-medium text-white/80">{device?.model || 'Téléphone'}</span>
            {device?.android ? (
              <span className="hidden truncate text-white/40 sm:inline">· Android {device.android}</span>
            ) : null}
          </span>

          <span className="mx-auto hidden tabular-nums text-white/80 sm:block">
            {now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>

          <span className="ml-auto flex items-center gap-2 sm:ml-0">
            {device?.wifiEnabled === false ? (
              <WifiOff size={12} className="text-white/30" />
            ) : (
              <Wifi size={12} className={device?.wifiEnabled ? 'text-sky-200' : 'text-white/30'} />
            )}
            {device?.bluetoothEnabled === false ? (
              <BluetoothOff size={12} className="text-white/30" />
            ) : (
              <Bluetooth size={12} className={device?.bluetoothEnabled ? 'text-sky-200' : 'text-white/30'} />
            )}
            {ringer ? <RingerIcon size={12} className="text-white/55" /> : null}
            {device?.doNotDisturb ? <Moon size={12} className="text-violet-200" /> : null}
            {typeof device?.battery === 'number' ? (
              <span className="tabular-nums text-white/70">
                {device.battery}%{device.charging ? ' ⚡' : ''}
              </span>
            ) : null}
          </span>

          <button
            type="button"
            onClick={() => onShadeToggle(!shadeOpen)}
            aria-expanded={shadeOpen}
            title={shadeOpen ? 'Fermer le volet' : 'Tirer le volet : notifications et contrôles'}
            className="relative flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <Bell size={12} />
            {notifCount > 0 ? (
              <span className="min-w-[14px] rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {notifCount > 99 ? '99+' : notifCount}
              </span>
            ) : null}
            {shadeOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>

        {/* La languette : la zone qu'on tire. Discrète, mais présente — c'est
            le geste du téléphone, pas un bouton de plus. */}
        {!shadeOpen ? (
          <button
            type="button"
            onClick={() => onShadeToggle(true)}
            aria-label="Tirer le volet des notifications"
            className="group absolute inset-x-0 top-full z-10 flex h-4 items-start justify-center"
          >
            <span className="h-1 w-16 rounded-full bg-white/20 transition group-hover:w-24 group-hover:bg-white/40" />
          </button>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* VOLET — notifications + contrôles rapides                       */}
        {/* ---------------------------------------------------------------- */}
        {shadeOpen ? (
          <div className="absolute inset-x-0 top-full origin-top border-b border-white/10 bg-slate-950/90 shadow-2xl shadow-black/50 backdrop-blur-2xl">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.07] px-3 py-2.5">
              {[
                {
                  id: 'wifi',
                  on: device?.wifiEnabled === true,
                  Icon: device?.wifiEnabled === false ? WifiOff : Wifi,
                  label: 'Wi-Fi',
                  action: () => actions.toggleRadio('wifi'),
                },
                {
                  id: 'bluetooth',
                  on: device?.bluetoothEnabled === true,
                  Icon: device?.bluetoothEnabled === false ? BluetoothOff : Bluetooth,
                  label: 'Bluetooth',
                  action: () => actions.toggleRadio('bluetooth'),
                },
                {
                  id: 'ringer',
                  on: ringer === 'vibrate' || ringer === 'silent',
                  Icon: RingerIcon,
                  label: ringer === 'vibrate' ? 'Vibreur' : ringer === 'silent' ? 'Silencieux' : 'Sonnerie',
                  action: actions.toggleRinger,
                  disabled: !ringer,
                },
                {
                  id: 'dnd',
                  on: device?.doNotDisturb === true,
                  Icon: Moon,
                  label: 'Ne pas déranger',
                  action: actions.toggleDnd,
                },
              ].map(({ id, on, Icon, label, action, disabled }) => (
                <button
                  key={id}
                  type="button"
                  onClick={action}
                  disabled={Boolean(controlBusy) || disabled}
                  aria-pressed={on}
                  title={label}
                  className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-medium transition disabled:opacity-40 ${
                    on
                      ? 'bg-sky-300/15 text-sky-100 hover:bg-sky-300/25'
                      : 'bg-white/[0.05] text-white/70 hover:bg-white/[0.12] hover:text-white'
                  }`}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}

              <span className="mx-1 h-5 w-px bg-white/10" />
              {[
                ['volume_down', Volume1, 'Baisser le volume'],
                ['mute', VolumeX, 'Couper le son'],
                ['volume_up', Volume2, 'Augmenter le volume'],
              ].map(([key, Icon, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => actions.sendKey(key)}
                  title={label}
                  aria-label={label}
                  className="rounded-xl p-2 text-white/65 transition hover:bg-white/10 hover:text-white"
                >
                  <Icon size={13} />
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-white/10" />
              {/* Les panneaux de réglages Android : c'est le téléphone qui les
                  affiche, et c'est là qu'on règle ce qu'adb ne pilote pas. */}
              {[
                ['internet', Wifi, 'Réglages réseau'],
                ['sound', Volume2, 'Réglages du son'],
                ['settings', Settings, 'Réglages Android'],
              ].map(([panel, Icon, label]) => (
                <button
                  key={panel}
                  type="button"
                  onClick={() => actions.openDevicePanel(panel)}
                  title={label}
                  aria-label={label}
                  className="rounded-xl p-2 text-white/65 transition hover:bg-white/10 hover:text-white"
                >
                  <Icon size={13} />
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-white/10" />
              <button
                type="button"
                onClick={actions.sendFiles}
                disabled={sendingFiles}
                title="Envoyer des fichiers dans les téléchargements du téléphone"
                className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <Upload size={13} /> Fichiers
              </button>
              <button
                type="button"
                onClick={actions.sendFolder}
                disabled={sendingFiles}
                title="Envoyer un dossier entier : l’arborescence est recréée"
                className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <FolderUp size={13} /> Dossier
              </button>
              <button
                type="button"
                onClick={() => onShadeToggle(false)}
                aria-label="Fermer le volet"
                className="ml-auto rounded-lg p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>

            {/* Compte rendu d'un envoi : savoir OÙ le fichier est arrivé fait
                partie du service rendu. */}
            {sendReport ? (
              <p role="status" className="border-b border-white/[0.07] px-3 py-2 text-[11px] text-sky-100/80">
                {sendReport}
              </p>
            ) : null}

            <div className="max-h-[42vh] overflow-y-auto">
              {notifCount ? (
                <>
                  <div className="flex items-center gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    Notifications
                    <button
                      type="button"
                      onClick={actions.clearNotifications}
                      className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] normal-case tracking-normal text-white/50 transition hover:bg-white/10 hover:text-white"
                    >
                      <Trash2 size={11} /> Tout effacer
                    </button>
                  </div>
                  <ul className="divide-y divide-white/[0.05] pb-2">
                    {notifications.map((item) => {
                      const app = apps.find((a) => a.package === item.package);
                      return (
                        <li key={item.key} className="group flex items-start gap-2 px-3 py-2">
                          <button
                            type="button"
                            onClick={() => actions.openNotification(item)}
                            className="min-w-0 flex-1 rounded-lg text-left"
                          >
                            <span className="block truncate text-[11.5px] font-medium text-white/85">
                              {item.title || app?.name || 'Notification'}
                            </span>
                            {item.text ? (
                              <span className="mt-0.5 block line-clamp-2 text-[10.5px] leading-relaxed text-white/50">
                                {item.text}
                              </span>
                            ) : null}
                            <span className="mt-1 block truncate text-[9.5px] text-white/25">
                              {app?.name || item.package}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => actions.dismissNotification(item)}
                            aria-label="Écarter cette notification"
                            className="mt-0.5 rounded-lg p-1.5 text-white/30 transition hover:bg-white/10 hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
                          >
                            <X size={12} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p className="px-3 py-6 text-center text-[11px] text-white/35">
                  Aucune notification sur le téléphone
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* TOILE DE WIDGETS                                                 */}
      {/* ---------------------------------------------------------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-5 pb-6 pt-6">
          {/* En-tête de la toile : discret hors personnalisation. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white/85">Bureau</h2>
              <p className="text-[11px] text-white/45">
                {layout.length
                  ? `${layout.length} carte${layout.length > 1 ? 's' : ''}${editing ? ' · glissez pour réorganiser' : ''}`
                  : 'Bureau vide — ajoutez ce qui vous est utile'}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPickerOpen((open) => !open)}
                aria-expanded={pickerOpen}
                className="flex items-center gap-1.5 rounded-xl border border-sky-200/20 bg-sky-300/10 px-2.5 py-1.5 text-xs font-medium text-sky-100 transition hover:bg-sky-300/20"
              >
                <Plus size={13} /> Ajouter
              </button>
              <button
                type="button"
                onClick={() => setEditing((value) => !value)}
                aria-pressed={editing}
                title="Réorganiser, redimensionner, retirer les cartes"
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition ${
                  editing
                    ? 'border-violet-300/30 bg-violet-400/20 text-violet-100'
                    : 'border-white/10 bg-white/[0.05] text-white/70 hover:bg-white/10'
                }`}
              >
                {editing ? <Check size={13} /> : <LayoutGrid size={13} />}
                {editing ? 'Terminé' : 'Organiser'}
              </button>
              <button
                type="button"
                onClick={actions.openSettings}
                title="Fond d’écran et réglages"
                aria-label="Fond d’écran et réglages"
                className="rounded-xl border border-white/10 bg-white/[0.05] p-2 text-white/65 transition hover:bg-white/10 hover:text-white"
              >
                <Settings size={13} />
              </button>
            </div>
          </div>

          {/* ------------------------------------------------------------ */}
          {/* PALETTE D'AJOUT                                              */}
          {/* ------------------------------------------------------------ */}
          {pickerOpen ? (
            <section className="mb-4 rounded-2xl border border-sky-200/15 bg-slate-950/75 p-3 shadow-xl backdrop-blur-xl">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-white/85">Cartes disponibles</h3>
                  <p className="mt-0.5 text-[11px] text-white/45">
                    Rien n’est imposé : prenez ce qui vous sert, laissez le reste.
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onLayoutChange(presetLayout('sobre'))}
                    className="rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-white/70 transition hover:bg-white/10"
                    title="L’heure et les favoris, rien de plus"
                  >
                    Bureau sobre
                  </button>
                  <button
                    type="button"
                    onClick={() => onLayoutChange(presetLayout('complet'))}
                    className="flex items-center gap-1 rounded-lg border border-violet-200/20 bg-violet-400/15 px-2.5 py-1.5 text-[11px] text-violet-100 transition hover:bg-violet-400/25"
                    title="Toutes les cartes, d’un coup"
                  >
                    <Sparkles size={12} /> Tout afficher
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
                {WIDGET_CATALOG.filter((def) => !def.requiresPackage).map((def) => {
                  const Icon = WIDGET_ICONS[def.icon] || LayoutGrid;
                  const placed = alreadyPlaced(def.type);
                  return (
                    <button
                      key={def.type}
                      type="button"
                      disabled={placed}
                      onClick={() => onLayoutChange(addWidget(layout, def.type))}
                      className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition ${
                        placed
                          ? 'cursor-default border-white/[0.07] bg-white/[0.02] opacity-55'
                          : 'border-white/10 bg-white/[0.04] hover:border-sky-200/25 hover:bg-white/[0.09]'
                      }`}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-sky-200">
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-white/85">
                          {def.label}
                          {placed ? <Check size={11} className="text-emerald-300" /> : null}
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-snug text-white/45">
                          {placed ? 'Déjà sur le bureau' : def.hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Les tuiles vivantes : une par application suivie. */}
              {tileCandidates.length ? (
                <div className="mt-3 border-t border-white/[0.07] pt-3">
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    Tuiles d’application
                  </h4>
                  <p className="mb-2 mt-1 text-[10px] text-white/40">
                    Une application sur le bureau, avec son compteur et sa dernière notification.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {tileCandidates.map((app) => {
                      const placed = alreadyPlaced('apptile', app.package);
                      return (
                        <button
                          key={app.package}
                          type="button"
                          disabled={placed}
                          onClick={() => onLayoutChange(addWidget(layout, 'apptile', { package: app.package }))}
                          title={placed ? `${app.name} est déjà sur le bureau` : `Ajouter ${app.name}`}
                          className={`flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-[11px] transition ${
                            placed
                              ? 'cursor-default border-white/[0.07] bg-white/[0.02] text-white/40'
                              : 'border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.1]'
                          }`}
                        >
                          {actions.renderIcon(app, 18)}
                          <span className="max-w-[9rem] truncate">{app.name}</span>
                          {placed ? <Check size={10} className="text-emerald-300" /> : <Plus size={10} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {/* ------------------------------------------------------------ */}
          {/* LES CARTES                                                   */}
          {/* ------------------------------------------------------------ */}
          {layout.length ? (
            <div
              ref={canvasRef}
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridAutoRows: `${ROW}px`,
                gridAutoFlow: 'dense',
              }}
            >
              {layout.map((widget) => {
                const def = widgetDefinition(widget.type);
                const span = WIDGET_SIZES[widget.size] || WIDGET_SIZES.md;
                const Icon = WIDGET_ICONS[def?.icon] || LayoutGrid;
                const over = dragging && dragging !== widget.id;
                return (
                  <article
                    key={widget.id}
                    draggable={editing}
                    onDragStart={() => setDragging(widget.id)}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(event) => {
                      if (editing && dragging) event.preventDefault();
                    }}
                    onDrop={() => onDrop(widget.id)}
                    style={{
                      // Borné au nombre de colonnes mesuré : une carte large
                      // occupe toute la largeur plutôt que de déborder.
                      gridColumn: `span ${Math.min(span.cols, cols)}`,
                      gridRow: `span ${span.rows}`,
                    }}
                    className={`group/widget relative flex min-w-0 flex-col overflow-hidden rounded-2xl border p-3 text-white shadow-lg shadow-black/10 backdrop-blur-xl transition ${
                      editing
                        ? `cursor-grab border-violet-200/25 bg-slate-950/45 ${over ? 'ring-2 ring-violet-300/50' : ''}`
                        : 'border-white/10 bg-slate-950/30 hover:border-white/20'
                    } ${dragging === widget.id ? 'opacity-40' : ''}`}
                  >
                    {/* L'en-tête n'apparaît qu'en organisation ou au survol :
                        une carte qui se lit n'a pas besoin de son étiquette. */}
                    <header
                      className={`mb-1.5 flex shrink-0 items-center gap-1.5 transition ${
                        editing ? '' : 'opacity-0 group-hover/widget:opacity-100'
                      }`}
                    >
                      {editing ? <GripVertical size={11} className="text-white/35" /> : null}
                      <Icon size={11} className="text-white/40" />
                      <span className="min-w-0 flex-1 truncate text-[9.5px] font-semibold uppercase tracking-wider text-white/40">
                        {def?.label || widget.type}
                      </span>
                      {def && def.sizes.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => onLayoutChange(cycleWidgetSize(layout, widget.id))}
                          title={`Taille : ${WIDGET_SIZES[widget.size]?.label} — changer`}
                          aria-label="Changer la taille de la carte"
                          className="rounded p-0.5 text-white/40 transition hover:bg-white/10 hover:text-white"
                        >
                          <Maximize2 size={10} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onLayoutChange(removeWidget(layout, widget.id))}
                        title="Retirer cette carte"
                        aria-label="Retirer cette carte"
                        className="rounded p-0.5 text-white/40 transition hover:bg-rose-500/80 hover:text-white"
                      >
                        <X size={10} />
                      </button>
                    </header>
                    <div className="min-h-0 flex-1">
                      <PhoneWidget widget={widget} data={data} actions={actions} />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-10 text-center transition hover:border-sky-200/30 hover:bg-white/[0.05]"
            >
              <Plus size={22} className="text-white/30" />
              <span className="text-sm font-medium text-white/70">Un bureau à vous</span>
              <span className="max-w-sm text-[11px] leading-relaxed text-white/40">
                Posez ici l’heure, votre agenda, l’écran du téléphone, vos applications… ou
                laissez-le nu : tout est accessible depuis le volet et le dock.
              </span>
            </button>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* DOCK                                                             */}
      {/* ---------------------------------------------------------------- */}
      {dockVisible ? (
        <div className="shrink-0 px-3 pb-3">
          <div className="mx-auto flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-white/12 bg-slate-950/55 px-2 py-1.5 shadow-2xl shadow-black/35 backdrop-blur-2xl">
            {(pinnedApps || []).slice(0, 8).map((app) => {
              const count = (notifications || []).filter((n) => n.package === app.package).length;
              return (
                <button
                  key={app.package}
                  type="button"
                  onClick={() => actions.launch(app)}
                  title={app.name}
                  aria-label={`Ouvrir ${app.name}`}
                  style={{ width: iconBase + 10, height: iconBase + 10 }}
                  className="relative grid shrink-0 place-items-center rounded-xl transition hover:-translate-y-1 hover:bg-white/10"
                >
                  {actions.renderIcon(app, iconBase - 6)}
                  {count ? (
                    <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-rose-400" />
                  ) : null}
                </button>
              );
            })}

            {pinnedApps?.length ? <span className="mx-1 h-7 w-px shrink-0 bg-white/10" /> : null}

            {[
              ['back', ArrowLeft, 'Retour'],
              ['home', Home, 'Accueil du téléphone'],
              ['recents', Square, 'Applications récentes'],
              ['wakeup', Power, 'Réveiller l’écran'],
            ].map(([key, Icon, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => actions.sendKey(key)}
                title={label}
                aria-label={label}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <Icon size={15} />
              </button>
            ))}

            <span className="mx-1 h-7 w-px shrink-0 bg-white/10" />

            <button
              type="button"
              onClick={actions.openMirror}
              title={mirrorRunning ? 'Le miroir est ouvert' : 'Ouvrir le miroir'}
              aria-label="Miroir du téléphone"
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition hover:-translate-y-1 ${
                mirrorRunning ? 'bg-violet-400/20 text-violet-100' : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Monitor size={15} />
            </button>
            <button
              type="button"
              onClick={actions.openDrawer}
              title="Toutes les applications"
              aria-label="Toutes les applications"
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white/[0.07] px-3 text-xs font-medium text-white/80 transition hover:-translate-y-1 hover:bg-white/15"
            >
              <LayoutGrid size={15} />
              <span className="hidden sm:inline">Toutes</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
