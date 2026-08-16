import { Play, Pause, PictureInPicture2, Music, SkipBack, SkipForward, ExternalLink } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useMediaStore } from '../lib/mediaStore';
import { mediaToggle, mediaPip, mediaPrev, mediaNext, pickNowPlaying } from '../lib/mediaControls';
import { useT } from '../lib/i18n';

// Mini-barre « lecture en cours » dans la Topbar : pilote l'audio/vidéo qui
// joue (précédent / pause / suivant / PiP) sans revenir sur l'app, et permet
// de détacher un mini-lecteur flottant toujours au-dessus.
export default function NowPlaying() {
  const t = useT();
  const { apps, activeApp, setActiveApp, setActiveProfile } = useStore();
  const media = useMediaStore((s) => s.media);

  const pick = pickNowPlaying(media, activeApp);
  if (!pick) return null;
  const [appId, info] = pick;
  const app = apps.find((a) => a.id === appId);
  if (!app) return null;

  const goToApp = () => {
    if (app.profileId) setActiveProfile(app.profileId);
    setActiveApp(appId);
  };

  const label = info.title || app.name;

  return (
    <div className="flex items-center gap-0.5 app-no-drag bg-bg-elevated border border-border rounded-full px-1 h-8 max-w-[340px]">
      <button
        onClick={() => mediaPrev(appId)}
        className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-bg-hover flex-shrink-0"
        title={t('np.prevTrack')}
      >
        <SkipBack size={13} />
      </button>
      <button
        onClick={() => mediaToggle(appId)}
        className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-bg-hover flex-shrink-0"
        title={info.playing ? 'Pause' : 'Lecture'}
      >
        {info.playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <button
        onClick={() => mediaNext(appId)}
        className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-bg-hover flex-shrink-0"
        title={t('np.nextTrack')}
      >
        <SkipForward size={13} />
      </button>
      <button
        onClick={goToApp}
        className="flex items-center gap-1.5 min-w-0 flex-1 px-1"
        title={`${label} — aller à ${app.name}`}
      >
        {info.artwork ? (
          <img src={info.artwork} alt="" className="w-4 h-4 rounded object-cover flex-shrink-0" draggable={false} />
        ) : (
          <Music size={13} className="text-accent-primary flex-shrink-0" />
        )}
        <span className="text-xs font-medium truncate">{label}</span>
      </button>
      <button
        onClick={() => mediaPip(appId)}
        className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-bg-hover flex-shrink-0"
        title={t('np.pip')}
      >
        <PictureInPicture2 size={14} />
      </button>
      <button
        onClick={() => window.electronAPI?.miniPlayer?.open?.()}
        className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-bg-hover flex-shrink-0"
        title={t('np.detach')}
      >
        <ExternalLink size={13} />
      </button>
    </div>
  );
}
