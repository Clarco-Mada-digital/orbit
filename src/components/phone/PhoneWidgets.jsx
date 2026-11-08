// ---------------------------------------------------------------------------
// Les cartes du bureau du Téléphone.
//
// Chaque widget reçoit ce qu'il affiche et ne va rien chercher lui-même : le
// bureau interroge le téléphone UNE fois par source (voir `neededSources`) et
// distribue. Sans ça, quatre cartes posées sur le même bureau multiplieraient
// les appels adb pour les mêmes données.
//
// Les cartes s'adaptent à leur taille (« sm » à « wide ») : ce n'est pas la
// même carte rognée, c'est la même information à la densité qui convient.
// ---------------------------------------------------------------------------

import {
  AlertTriangle,
  Battery,
  Bell,
  Calendar,
  Clock3,
  Database,
  History,
  Loader2,
  Monitor,
  Music,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Smartphone,
  Star,
} from 'lucide-react';

export const WIDGET_ICONS = {
  clock: Clock3,
  smartphone: Smartphone,
  monitor: Monitor,
  calendar: Calendar,
  music: Music,
  database: Database,
  bell: Bell,
  phone: Phone,
  star: Star,
  history: History,
  layout: Smartphone,
};

const octets = (value) => {
  const n = Number(value) || 0;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} Go`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} Mo`;
  return `${Math.round(n / 1024)} Ko`;
};

// « aujourd'hui 15:00 », « demain », « lun. 12 » : une date d'évènement se lit
// par son écart à maintenant, pas par son format long.
function whenLabel(event, now = Date.now()) {
  const start = new Date(event.start);
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const today = new Date(now);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Math.round((day - base) / 86400000);
  const hour = event.allDay
    ? ''
    : start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return hour ? `aujourd’hui ${hour}` : 'aujourd’hui';
  if (days === 1) return hour ? `demain ${hour}` : 'demain';
  const label = start.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  return hour ? `${label} · ${hour}` : label;
}

function Empty({ icon: Icon, children }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
      {Icon ? <Icon size={18} className="text-white/25" /> : null}
      <p className="text-[11px] leading-snug text-white/40">{children}</p>
    </div>
  );
}

// --- Horloge ----------------------------------------------------------------

function ClockWidget({ size, now }) {
  const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const big = size === 'lg';
  return (
    <div className="flex h-full flex-col justify-center">
      <div
        className={`font-light leading-none tabular-nums tracking-tight ${
          big ? 'text-5xl' : size === 'sm' ? 'text-2xl' : 'text-4xl'
        }`}
      >
        {time}
      </div>
      <div className={`mt-2 truncate capitalize text-white/60 ${size === 'sm' ? 'text-[10px]' : 'text-xs'}`}>
        {date}
      </div>
      {big ? (
        <div className="mt-3 text-[11px] text-white/35">
          {now.toLocaleDateString('fr-FR', { year: 'numeric' })} · semaine{' '}
          {Math.ceil(((now - new Date(now.getFullYear(), 0, 1)) / 86400000 + 1) / 7)}
        </div>
      ) : null}
    </div>
  );
}

// --- Appareil ---------------------------------------------------------------

function DeviceWidget({ size, device }) {
  if (!device) return <Empty icon={Smartphone}>Aucun appareil connecté</Empty>;
  const level = typeof device.battery === 'number' ? device.battery : null;
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-sky-300/10 text-sky-200">
          <Smartphone size={15} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold">{device.model || 'Téléphone'}</span>
          <span className="block truncate text-[10px] text-white/45">
            {device.android ? `Android ${device.android}` : 'Connecté'}
          </span>
        </span>
      </div>
      {level !== null ? (
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-white/55">
            <span className="flex items-center gap-1">
              <Battery size={12} /> Batterie{device.charging ? ' · en charge' : ''}
            </span>
            <span className="tabular-nums">{level} %</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${
                level <= 15 ? 'bg-rose-400' : device.charging ? 'bg-emerald-400' : 'bg-sky-300'
              }`}
              style={{ width: `${Math.max(2, level)}%` }}
            />
          </div>
        </div>
      ) : null}
      {size !== 'sm' && device.serial ? (
        <p className="truncate text-[10px] text-white/30" title={device.serial}>
          {device.serial}
        </p>
      ) : null}
    </div>
  );
}

// --- Écran vivant -----------------------------------------------------------

// La carte qui n'existe sur aucun autre bureau : l'écran du téléphone, posé
// là. L'image est rafraîchie par le bureau (une capture redimensionnée) ; un
// clic ouvre le miroir, où l'on peut agir.
function ScreenWidget({ screen, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Ouvrir le miroir du téléphone"
      className="group relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-black/35"
    >
      {screen?.image ? (
        <img
          src={screen.image}
          alt="Écran du téléphone"
          draggable={false}
          className="max-h-full max-w-full object-contain transition group-hover:scale-[1.02]"
        />
      ) : screen?.error ? (
        <Empty icon={Monitor}>{screen.error}</Empty>
      ) : (
        <Loader2 size={18} className="animate-spin text-white/40" />
      )}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent py-2 text-[10px] font-medium text-white/80 opacity-0 transition group-hover:opacity-100">
        <Monitor size={12} /> Ouvrir le miroir
      </span>
    </button>
  );
}

// --- Agenda -----------------------------------------------------------------

function CalendarWidget({ size, calendar, now }) {
  if (calendar?.error) return <Empty icon={Calendar}>{calendar.error}</Empty>;
  if (!calendar) return <Empty icon={Loader2}>Lecture de l’agenda…</Empty>;
  const events = calendar.events || [];
  if (!events.length) return <Empty icon={Calendar}>Rien de prévu</Empty>;
  const max = size === 'lg' ? 5 : 2;
  return (
    <ul className="flex h-full flex-col gap-1.5 overflow-hidden">
      {events.slice(0, max).map((event, index) => {
        const live = event.start <= now && (event.end || event.start) >= now;
        return (
          <li
            key={`${event.start}-${index}`}
            className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${
              live ? 'bg-sky-300/10' : 'bg-white/[0.03]'
            }`}
          >
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${live ? 'bg-sky-300' : 'bg-white/25'}`}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-medium text-white/85" title={event.title}>
                {event.title}
              </span>
              <span className="block truncate text-[10px] text-white/45">
                {whenLabel(event, now)}
                {event.location ? ` · ${event.location}` : ''}
              </span>
            </span>
          </li>
        );
      })}
      {events.length > max ? (
        <li className="mt-auto text-[10px] text-white/35">+ {events.length - max} autres</li>
      ) : null}
    </ul>
  );
}

// --- Lecture en cours -------------------------------------------------------

function MediaWidget({ media, onMediaKey, busy }) {
  if (media?.error) return <Empty icon={Music}>{media.error}</Empty>;
  const track = media?.media;
  if (!track) return <Empty icon={Music}>Rien en lecture</Empty>;
  const playing = track.state === 'playing';
  return (
    <div className="flex h-full items-center gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-400/15 text-violet-200">
        <Music size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold" title={track.title}>
          {track.title}
        </p>
        {track.artist ? <p className="truncate text-[10px] text-white/50">{track.artist}</p> : null}
        <div className="mt-1.5 flex items-center gap-1">
          {[
            ['previous', SkipBack, 'Précédent'],
            ['play-pause', playing ? Pause : Play, playing ? 'Pause' : 'Lecture'],
            ['next', SkipForward, 'Suivant'],
          ].map(([action, Icon, label]) => (
            <button
              key={action}
              type="button"
              onClick={() => onMediaKey(action)}
              disabled={Boolean(busy)}
              title={label}
              aria-label={label}
              className="rounded-lg p-1.5 text-white/65 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              {busy === action ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Stockage ---------------------------------------------------------------

function StorageWidget({ size, storage }) {
  if (storage?.error) return <Empty icon={Database}>{storage.error}</Empty>;
  const data = storage?.storage;
  if (!data) return <Empty icon={Loader2}>Lecture du stockage…</Empty>;
  // Au-delà de 90 %, Android commence à mal se porter : la carte le dit au
  // lieu d'afficher un pourcentage de plus.
  const tight = data.percent >= 90;
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xl font-light tabular-nums ${tight ? 'text-rose-200' : ''}`}>
          {data.percent} %
        </span>
        <span className="text-[10px] text-white/45">occupé</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${tight ? 'bg-rose-400' : 'bg-sky-300'}`}
          style={{ width: `${Math.max(2, data.percent)}%` }}
        />
      </div>
      <p className="truncate text-[10px] text-white/45">
        {octets(data.free)} libres sur {octets(data.total)}
      </p>
      {tight && size !== 'sm' ? (
        <p className="flex items-center gap-1 text-[10px] text-rose-200/80">
          <AlertTriangle size={11} /> Le téléphone va manquer de place
        </p>
      ) : null}
    </div>
  );
}

// --- Notifications ----------------------------------------------------------

function NotificationsWidget({ size, notifications, apps, onOpen, onDismiss }) {
  const items = notifications || [];
  if (!items.length) return <Empty icon={Bell}>Aucune notification</Empty>;
  const max = size === 'lg' ? 5 : size === 'wide' ? 3 : 2;
  return (
    <ul className="flex h-full flex-col gap-1 overflow-hidden">
      {items.slice(0, max).map((item) => {
        const app = apps.find((a) => a.package === item.package);
        return (
          <li key={item.key} className="group flex items-start gap-1.5">
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.06]"
              title={`${item.title || ''} — ouvrir l’application`}
            >
              <span className="block truncate text-[11px] font-medium text-white/85">
                {item.title || app?.name || 'Notification'}
              </span>
              {item.text ? (
                <span className="block truncate text-[10px] text-white/45">{item.text}</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => onDismiss(item)}
              aria-label="Écarter"
              title="Écarter du téléphone"
              className="mt-1 rounded-md px-1 text-[11px] text-white/30 opacity-0 transition hover:text-white group-hover:opacity-100"
            >
              ✕
            </button>
          </li>
        );
      })}
      {items.length > max ? (
        <li className="mt-auto px-2 text-[10px] text-white/35">+ {items.length - max} autres</li>
      ) : null}
    </ul>
  );
}

// --- Appels récents ---------------------------------------------------------

function CallsWidget({ size, calls, onCallBack, busy }) {
  if (calls?.error) return <Empty icon={Phone}>{calls.error}</Empty>;
  const entries = calls?.entries || [];
  if (!entries.length) return <Empty icon={Phone}>Aucun appel récent</Empty>;
  const max = size === 'lg' ? 4 : 2;
  return (
    <ul className="flex h-full flex-col gap-1 overflow-hidden">
      {entries.slice(0, max).map((entry, index) => {
        const Icon = entry.type === 'outgoing' ? PhoneOutgoing : entry.missed ? PhoneMissed : PhoneIncoming;
        return (
          <li
            key={`${entry.at || index}-${entry.number || index}`}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.05]"
          >
            <Icon size={13} className={entry.missed ? 'shrink-0 text-rose-300' : 'shrink-0 text-white/40'} />
            <span className="min-w-0 flex-1">
              <span
                className={`block truncate text-[11px] font-medium ${
                  entry.missed ? 'text-rose-100' : 'text-white/85'
                }`}
              >
                {entry.who}
              </span>
              <span className="block truncate text-[10px] text-white/40">
                {[
                  entry.at
                    ? new Date(entry.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
                    : null,
                  entry.duration,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {entry.callable ? (
              <button
                type="button"
                onClick={() => onCallBack(entry)}
                disabled={Boolean(busy)}
                title={`Rappeler ${entry.number}`}
                className="shrink-0 rounded-lg bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-100 transition hover:bg-emerald-500/25 disabled:opacity-40"
              >
                Rappeler
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// --- Grilles d'applications -------------------------------------------------

function AppsWidget({ size, apps, onLaunch, renderIcon, empty, emptyIcon, iconBase = 40 }) {
  if (!apps.length) return <Empty icon={emptyIcon}>{empty}</Empty>;
  const max = size === 'wide' ? 12 : size === 'lg' ? 10 : 4;
  return (
    <div
      className="grid h-full content-start gap-x-1 gap-y-2 overflow-hidden"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${iconBase + 32}px, 1fr))` }}
    >
      {apps.slice(0, max).map((app) => (
        <button
          key={app.package}
          type="button"
          onClick={() => onLaunch(app)}
          title={app.name}
          className="group flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-1.5 transition hover:bg-white/[0.08]"
        >
          <span className="transition group-hover:-translate-y-0.5">{renderIcon(app, iconBase)}</span>
          <span className="line-clamp-2 w-full break-words text-center text-[10px] leading-tight text-white/65">
            {app.name}
          </span>
        </button>
      ))}
    </div>
  );
}

// --- Tuile d'application vivante -------------------------------------------

// Une application épinglée qui devient une carte : son compteur et sa dernière
// notification. C'est ce qui remplace, utilement, les widgets Android qu'on ne
// peut pas héberger — et ça marche pour TOUTE application, sans rien installer
// sur le téléphone.
function AppTileWidget({ size, app, pkg, notifications, onLaunch, renderIcon, iconBase = 40 }) {
  const mine = (notifications || []).filter((n) => n.package === pkg);
  const last = mine[0] || null;
  const name = app?.name || pkg;
  return (
    <button
      type="button"
      onClick={() => onLaunch(app || { package: pkg, name })}
      title={`Ouvrir ${name}`}
      className="flex h-full w-full items-start gap-2.5 text-left"
    >
      <span className="relative shrink-0">
        {renderIcon(app || { package: pkg, name }, iconBase + 4)}
        {mine.length ? (
          <span className="absolute -right-1 -top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full border border-slate-950 bg-rose-500 px-1 text-[9px] font-bold text-white">
            {mine.length > 99 ? '99+' : mine.length}
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{name}</span>
        {size !== 'sm' && last ? (
          <>
            <span className="mt-0.5 block truncate text-[10px] text-white/55">
              {last.title || 'Notification'}
            </span>
            {last.text ? (
              <span className="block truncate text-[10px] text-white/35">{last.text}</span>
            ) : null}
          </>
        ) : (
          <span className="mt-0.5 block text-[10px] text-white/35">
            {mine.length ? `${mine.length} notification${mine.length > 1 ? 's' : ''}` : 'À jour'}
          </span>
        )}
      </span>
    </button>
  );
}

// --- Répartiteur ------------------------------------------------------------

export default function PhoneWidget({ widget, data, actions }) {
  const { size, type } = widget;
  switch (type) {
    case 'clock':
      return <ClockWidget size={size} now={data.now} />;
    case 'device':
      return <DeviceWidget size={size} device={data.device} />;
    case 'screen':
      return <ScreenWidget screen={data.screen} onOpen={actions.openMirror} />;
    case 'calendar':
      return <CalendarWidget size={size} calendar={data.calendar} now={data.now.getTime()} />;
    case 'media':
      return <MediaWidget media={data.media} onMediaKey={actions.mediaKey} busy={data.mediaBusy} />;
    case 'storage':
      return <StorageWidget size={size} storage={data.storage} />;
    case 'notifications':
      return (
        <NotificationsWidget
          size={size}
          notifications={data.notifications}
          apps={data.apps}
          onOpen={actions.openNotification}
          onDismiss={actions.dismissNotification}
        />
      );
    case 'calls':
      return <CallsWidget size={size} calls={data.calls} onCallBack={actions.callBack} busy={data.callBusy} />;
    case 'favorites':
      return (
        <AppsWidget
          size={size}
          apps={data.favorites}
          onLaunch={actions.launch}
          renderIcon={actions.renderIcon}
          empty="Marquez une application d’une étoile"
          emptyIcon={Star}
          iconBase={data.iconBase}
        />
      );
    case 'recent':
      return (
        <AppsWidget
          size={size}
          apps={data.recent}
          onLaunch={actions.launch}
          renderIcon={actions.renderIcon}
          empty="Aucune application ouverte récemment"
          emptyIcon={History}
          iconBase={data.iconBase}
        />
      );
    case 'apptile':
      return (
        <AppTileWidget
          size={size}
          pkg={widget.package}
          app={data.apps.find((a) => a.package === widget.package)}
          notifications={data.notifications}
          onLaunch={actions.launch}
          renderIcon={actions.renderIcon}
          iconBase={data.iconBase}
        />
      );
    default:
      return null;
  }
}
