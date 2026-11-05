import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Circle,
  Monitor,
  AppWindow,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Square,
  Pause,
  Play,
  X,
  FolderOpen,
  Download,
  Loader2,
  Sparkles,
  ZoomIn,
  MousePointer2,
  Minimize2,
  Maximize2,
  RefreshCw,
} from 'lucide-react';
import { useT } from '../lib/i18n';
import { useStore } from '../stores/useStore';
import {
  BACKGROUNDS,
  DEFAULT_STYLE,
  LAYOUTS,
  CAMERA_CORNERS,
  CAMERA_SIDES,
  easeFocus,
  cursorFocus,
  recordingName,
  formatDuration,
  FRAME_RATES,
  fpsHealth,
  applyStudioKey,
  STUDIO_KEYS,
} from '../lib/studioLayout';
import { drawFrame } from '../lib/studioRenderer';

// ---------------------------------------------------------------------------
// Studio d'enregistrement : écran + caméra, composés en direct.
//
// Le principe tient en une phrase : tout est dessiné sur UN canvas, et c'est ce
// canvas qu'on enregistre. L'aperçu affiché est donc l'enregistrement lui-même
// — pas une approximation. Rien ne réserve de surprise à la relecture.
//
// Ce que le processus principal fournit (voir electron/studio.js) : la liste
// des écrans et fenêtres, la position du curseur pour le zoom suivi, et
// l'écriture du fichier. Le reste — capture, composition, encodage — se passe
// ici, dans le renderer, avec les API du navigateur.
// ---------------------------------------------------------------------------
const api = () => window.electronAPI?.studio;

// 1080p par défaut : au-delà, le poids double sans gain visible pour une
// démonstration, et l'encodage logiciel commence à peiner sur une machine
// modeste.
// 720p par défaut : c'est la définition qui rend une démonstration lisible
// pour un coût de composition deux fois moindre. Le 1080p reste proposé pour
// les machines qui suivent — sur une machine modeste, il fait chuter la
// cadence et donne une vidéo saccadée, ce qui est bien pire qu'une image
// légèrement moins fine.
const RESOLUTIONS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};
const OFFSCREEN = 'fixed -left-[9999px] top-0 w-px h-px opacity-0 pointer-events-none';


export default function RecordingStudio({ onClose }) {
  const t = useT();
  const accentColor = useStore((s) => s.settings?.accentColor) || '#6366f1';
  const savedStyle = useStore((s) => s.settings?.studio);
  const updateSettings = useStore((s) => s.updateSettings);

  const [step, setStep] = useState('setup'); // setup | countdown | recording | done
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState('');
  const [devices, setDevices] = useState({ cameras: [], mics: [] });
  const [cameraId, setCameraId] = useState('');
  const [micId, setMicId] = useState('');
  const [style, setStyle] = useState({ ...DEFAULT_STYLE, ...(savedStyle || {}) });
  const OUTPUT = RESOLUTIONS[style.resolution] || RESOLUTIONS['720p'];
  const FPS = style.fps || 24;
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ffmpeg, setFfmpeg] = useState(false);
  // Périphériques nommés ? (voir loadDevices) et demande en cours.
  const [hasHardware, setHasHardware] = useState(false);
  const [asking, setAsking] = useState(false);
  // Fenêtre réduite : l'enregistrement continue, seule une petite barre reste.
  // C'est ce qui permet de filmer Orbit lui-même — impossible tant que le
  // studio occupe tout l'écran.
  const [minimized, setMinimized] = useState(false);

  // Ressources vivantes : volontairement dans des refs, pas dans l'état. Un
  // flux média n'est pas une donnée d'affichage, et le relâcher au mauvais
  // moment laisserait la LED de la caméra allumée.
  const screenStream = useRef(null);
  const cameraStream = useRef(null);
  const micStream = useRef(null);
  const screenVideo = useRef(null);
  const cameraVideo = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAt = useRef(0);
  const focusRef = useRef({ x: 0.5, y: 0.5 });
  const targetFocus = useRef({ x: 0.5, y: 0.5 });
  const audioCtxRef = useRef(null);
  // Piste vidéo en capture MANUELLE : c'est nous qui décidons quand une image
  // part à l'encodeur (voir beginRecording).
  const frameTrack = useRef(null);
  // Images réellement poussées à l'encodeur, pour afficher la cadence tenue.
  const frameCount = useRef(0);
  const [fps, setFps] = useState(0);
  // `finishRecording` est appelé depuis `recorder.onstop` : il voit la valeur
  // de `elapsed` capturée à la création du gestionnaire, pas la dernière.
  const elapsedRef = useRef(0);

  // `useT()` rend une NOUVELLE fonction à chaque rendu. S'en servir comme
  // dépendance d'effet relancerait la capture en boucle : le flux à peine
  // ouvert serait arrêté par le nettoyage du passage suivant, et l'aperçu
  // resterait désespérément vide. On le lit donc par une ref.
  const tRef = useRef(t);
  // Mise à jour APRÈS le rendu : écrire dans une ref pendant le rendu est un
  // effet de bord que React interdit.
  useEffect(() => {
    tRef.current = t;
  });

  const source = useMemo(() => sources.find((s) => s.id === sourceId) || null, [sources, sourceId]);

  // --- Préférences : le style choisi survit à la fermeture ------------------
  useEffect(() => {
    updateSettings({ studio: style });
  }, [style, updateSettings]);

  // --- Inventaire ----------------------------------------------------------
  const loadSources = useCallback(async () => {
    const res = await api()?.sources();
    if (res?.success) {
      setSources(res.sources);
      setSourceId((cur) => (res.sources.some((s) => s.id === cur) ? cur : res.sources[0]?.id || ''));
    } else {
      setError(tRef.current('studio.err.sources'));
    }
  }, []);

  useEffect(() => {
    loadSources();
    api()?.hasFfmpeg().then((r) => setFfmpeg(Boolean(r?.available)));
  }, [loadSources]);

  // La liste des caméras et micros n'est nommée qu'APRÈS une autorisation :
  // avant, le système ne rend que des entrées anonymes. On énumère donc une
  // première fois pour savoir s'il y en a, et on renomme après l'accord.
  const loadDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      // Tant que l'autorisation n'est pas donnée, Chromium rend des entrées
      // ANONYMES : identifiant vide, nom vide. Les afficher donnait une liste
      // dont toutes les options valaient « aucun » — on choisissait, et rien
      // ne se passait. On ne garde donc que les périphériques réellement
      // désignables.
      const named = (kind) => all.filter((d) => d.kind === kind && d.deviceId);
      setDevices({ cameras: named('videoinput'), mics: named('audioinput') });
      // Des périphériques existent-ils, même anonymes ? Cela distingue
      // « pas de webcam sur cette machine » de « autorisation pas encore
      // donnée » — deux situations qui demandent des mots différents.
      setHasHardware(all.some((d) => d.kind === 'videoinput' || d.kind === 'audioinput'));
    } catch {
      /* aucun périphérique : le studio reste utilisable en écran seul */
    }
  }, []);

  // Demande l'accès une fois, explicitement, sur un clic. C'est ce geste qui
  // donne à Orbit le droit de NOMMER les périphériques — sans lui, la liste
  // reste inutilisable.
  const enableDevices = useCallback(async () => {
    setError('');
    setAsking(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      // Le flux ne sert qu'à obtenir l'autorisation : on le relâche aussitôt,
      // la caméra ne doit pas rester allumée pendant qu'on règle la mise en
      // scène.
      stream.getTracks().forEach((track) => track.stop());
      await loadDevices();
    } catch (err) {
      setError(
        err?.name === 'NotAllowedError'
          ? tRef.current('studio.err.denied')
          : tRef.current('studio.err.camera', { detail: String(err?.message || err) })
      );
    } finally {
      setAsking(false);
    }
  }, [loadDevices]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // --- Flux ----------------------------------------------------------------
  const stopStream = (ref) => {
    ref.current?.getTracks().forEach((track) => track.stop());
    ref.current = null;
  };

  // Rend le flux (ou null) sans rien stocker : c'est l'effet appelant qui en
  // est propriétaire, et qui saura l'arrêter au bon moment.
  const openScreenStream = useCallback(async (id) => {
    if (!id) return null;
    try {
      // On passe par `getDisplayMedia`, l'API prévue pour la capture d'écran :
      // elle est routée vers le gestionnaire de partage d'Orbit, qui reçoit le
      // choix fait ici sous forme de jeton à usage unique. Le chemin historique
      // (`chromeMediaSource: 'desktop'` dans getUserMedia) déclenchait, lui, la
      // demande d'autorisation « caméra et micro » — refuser la caméra faisait
      // alors échouer la capture d'écran, pour laquelle on n'avait rien demandé.
      await api()?.prepare(id);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: { frameRate: FPS, width: OUTPUT.width, height: OUTPUT.height },
      });
      setError('');
      return stream;
    } catch (err) {
      // Le jeton ne doit pas survivre à un échec : sinon la prochaine demande
      // d'écran d'une page embarquée le consommerait.
      api()?.cancelPrepare();
      setError(tRef.current('studio.err.capture', { detail: String(err?.message || err) }));
      return null;
    }
  }, []);

  // L'ouverture est ASYNCHRONE, et React exécute les effets deux fois en
  // développement. Sans ce garde, le nettoyage du premier passage arrêtait le
  // flux que le second venait d'attacher : la vidéo restait à 0×0, piste
  // « ended », sans la moindre erreur affichée.
  useEffect(() => {
    let cancelled = false;
    let owned = null;
    (async () => {
      const stream = await openScreenStream(sourceId);
      if (!stream) return;
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      owned = stream;
      screenStream.current = stream;
      if (screenVideo.current) {
        screenVideo.current.srcObject = stream;
        screenVideo.current.play().catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
      owned?.getTracks().forEach((track) => track.stop());
      if (screenStream.current === owned) screenStream.current = null;
    };
  }, [sourceId, openScreenStream]);

  const toggleCamera = useCallback(async (id) => {
    if (!id) {
      stopStream(cameraStream);
      if (cameraVideo.current) cameraVideo.current.srcObject = null;
      setCameraId('');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: id }, width: 1280, height: 720 },
        audio: false,
      });
      stopStream(cameraStream);
      cameraStream.current = stream;
      if (cameraVideo.current) {
        cameraVideo.current.srcObject = stream;
        await cameraVideo.current.play().catch(() => {});
      }
      setCameraId(id);
      loadDevices(); // les noms deviennent lisibles une fois l'accord donné
    } catch (err) {
      setError(tRef.current('studio.err.camera', { detail: String(err?.message || err) }));
    }
  }, [loadDevices]);

  const toggleMic = useCallback(async (id) => {
    if (!id) {
      stopStream(micStream);
      setMicId('');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: id }, echoCancellation: true, noiseSuppression: true },
      });
      stopStream(micStream);
      micStream.current = stream;
      setMicId(id);
      loadDevices();
    } catch (err) {
      setError(tRef.current('studio.err.mic', { detail: String(err?.message || err) }));
    }
  }, [loadDevices]);

  // --- Boucle de rendu -----------------------------------------------------
  // Le même canvas sert d'aperçu et de source d'enregistrement.
  useEffect(() => {
    // Surtout PAS `requestAnimationFrame` : il est lié au compositeur de la
    // fenêtre. Or on enregistre son écran pour montrer AUTRE CHOSE — Orbit
    // passe derrière, Chromium cesse de la peindre, rAF ne se déclenche plus
    // et la vidéo se retrouve avec deux images par seconde au lieu de trente.
    //
    // Une minuterie, elle, continue de battre (le bridage d'arrière-plan est
    // levé pendant l'enregistrement, voir beginRecording), et dessiner dans un
    // canvas 2D ne demande pas que la fenêtre soit visible.
    const draw = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx) return;
      // Le point suivi sert au zoom ET au halo : on l'entretient dès que l'un
      // des deux est demandé. Le halo suit de plus près (le zoom, lui, doit
      // rester lent pour ne pas donner le mal de mer).
      focusRef.current =
        style.zoom || style.cursorHalo
          ? easeFocus(focusRef.current, targetFocus.current, style.cursorHalo && !style.zoom ? 0.35 : 0.12)
          : { x: 0.5, y: 0.5 };
      drawFrame(ctx, {
        width: canvas.width,
        height: canvas.height,
        screenVideo: screenVideo.current,
        cameraVideo: cameraId ? cameraVideo.current : null,
        style,
        accentColor,
        focus: focusRef.current,
      });
      // L'image vient d'être composée : on la pousse à l'encodeur.
      if (frameTrack.current) {
        frameTrack.current.requestFrame?.();
        frameCount.current += 1;
      }
    };
    draw();
    rafRef.current = setInterval(draw, Math.round(1000 / FPS));
    return () => clearInterval(rafRef.current);
  }, [style, cameraId, accentColor]);

  // Position du curseur : interrogée dix fois par seconde seulement. À la
  // cadence des images, l'aller-retour IPC coûterait plus cher que le dessin
  // lui-même, pour un gain invisible — le suivi est de toute façon amorti.
  useEffect(() => {
    if ((!style.zoom && !style.cursorHalo) || !source?.bounds) return undefined;
    const timer = setInterval(async () => {
      const point = await api()?.cursor();
      if (point) targetFocus.current = cursorFocus(point, source.bounds);
    }, 100);
    return () => clearInterval(timer);
  }, [style.zoom, style.cursorHalo, source]);

  // --- Enregistrement ------------------------------------------------------
  const buildAudioStream = () => {
    const tracks = micStream.current?.getAudioTracks() || [];
    if (tracks.length === 0) return null;
    // Un seul micro : inutile de passer par un graphe audio.
    if (tracks.length === 1) return new MediaStream([tracks[0]]);
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const dest = ctx.createMediaStreamDestination();
    for (const track of tracks) {
      ctx.createMediaStreamSource(new MediaStream([track])).connect(dest);
    }
    return dest.stream;
  };

  const beginRecording = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // `captureStream(0)` = mode MANUEL. En mode automatique, le canvas n'est
    // échantillonné qu'au rythme où la fenêtre est composée : une fenêtre
    // occultée — le cas normal quand on filme son écran — ne produisait qu'une
    // image par seconde, alors que le dessin, lui, tournait à trente.
    const stream = canvas.captureStream(0);
    frameTrack.current = stream.getVideoTracks()[0] || null;
    const audio = buildAudioStream();
    if (audio) audio.getAudioTracks().forEach((track) => stream.addTrack(track));

    // VP9 quand le système le propose : à qualité égale, le fichier est
    // nettement plus léger à partager. Repli sur VP8, puis sur le choix par
    // défaut du système.
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 6_000_000,
    });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunksRef.current.push(e.data);
    };
    recorder.onstop = finishRecording;
    recorder.start(1000);
    recorderRef.current = recorder;
    // Sans cette levée, Orbit passant en arrière-plan fait chuter le canvas à
    // quelques images par SECONDE : la vidéo paraît figée. Voir studio.js.
    api()?.setThrottling(false);
    // La base du chronomètre est posée par l'effet ci-dessous, APRÈS le rendu :
    // lire l'horloge pendant un rendu donne une valeur différente à chaque
    // passage (React le signale comme impur).
    startedAt.current = 0;
    elapsedRef.current = 0;
    setElapsed(0);
    setPaused(false);
    setStep('recording');
  };

  const finishRecording = async () => {
    api()?.setThrottling(true);
    setBusy(true);
    try {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      chunksRef.current = [];
      const buffer = await blob.arrayBuffer();
      const res = await api()?.save(new Uint8Array(buffer), recordingName(new Date(), 'webm'));
      if (res?.success) {
        setResult({ path: res.path, bytes: res.bytes, duration: elapsedRef.current, url: URL.createObjectURL(blob) });
        setStep('done');
      } else {
        // « Rien à écrire » n'est pas « disque en panne » : confondre les deux
        // envoie chercher un problème d'espace libre alors que la prise était
        // simplement vide (aucune image capturée).
        setError(t(res?.error === 'empty' ? 'studio.err.empty' : 'studio.err.save'));
        setStep('setup');
      }
    } finally {
      setBusy(false);
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      frameTrack.current = null;
    }
  };

  const startCountdown = () => {
    setError('');
    setStep('countdown');
    let n = 3;
    setCountdown(n);
    const tick = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(tick);
        setCountdown(0);
        beginRecording();
      } else {
        setCountdown(n);
      }
    }, 1000);
  };

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorderRef.current = null;
  }, []);

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause();
      setPaused(true);
    } else if (recorder.state === 'paused') {
      recorder.resume();
      // La base est recalculée à partir du temps déjà écoulé : la pause ne
      // compte pas, sans avoir à mémoriser l'instant où elle a commencé.
      startedAt.current = 0;
      setPaused(false);
    }
  };

  // Chronomètre
  useEffect(() => {
    if (step !== 'recording' || paused) return undefined;
    const tick = () => {
      if (!startedAt.current) startedAt.current = Date.now() - elapsed;
      const next = Date.now() - startedAt.current;
      // Cadence tenue sur la dernière seconde : c'est elle qui dit si la
      // machine suit, pas la cadence demandée.
      setFps(Math.round(frameCount.current * 4));
      frameCount.current = 0;
      elapsedRef.current = next;
      setElapsed(next);
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
    // `elapsed` sert seulement à replacer la base après une pause : le relire
    // à chaque tick relancerait l'effet quatre fois par seconde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, paused]);

  // Échap arrête l'enregistrement plutôt que de fermer la fenêtre : perdre une
  // prise en cours par réflexe serait rageant.
  useEffect(() => {
    const onKey = (e) => {
      // Jamais pendant une saisie : une lettre tapée dans un champ ne doit pas
      // changer le fond de la vidéo.
      const el = e.target;
      if (el instanceof HTMLElement && el.closest('input, select, textarea, [contenteditable="true"]')) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        if (step === 'recording') stopRecording();
        else onClose?.();
        return;
      }

      const key = String(e.key).toLowerCase();
      // Actions d'enregistrement : utiles surtout fenêtre réduite, quand les
      // boutons ne sont plus sous la main.
      // `STUDIO_KEYS` associe une TOUCHE à une ACTION : c'est donc la valeur
      // qu'il faut comparer, pas la clé.
      const action = STUDIO_KEYS[key];
      if (step === 'recording') {
        if (action === 'pause' || e.key === ' ') {
          e.preventDefault();
          togglePause();
          return;
        }
        if (action === 'stop') {
          e.preventDefault();
          stopRecording();
          return;
        }
        if (action === 'minimize') {
          e.preventDefault();
          setMinimized((v) => !v);
          return;
        }
      }

      // Mise en scène : modifiable à tout moment, y compris en plein
      // enregistrement — c'est tout l'intérêt.
      if (step === 'setup' || step === 'recording') {
        const patch = applyStudioKey(key, style, { hasCamera: Boolean(cameraId) });
        if (patch) {
          e.preventDefault();
          setStyle((cur) => ({ ...cur, ...patch }));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, stopRecording, onClose, style, cameraId]);

  // Libération des ressources : la caméra et le micro doivent s'éteindre à la
  // fermeture, sans exception.
  useEffect(() => () => {
    stopStream(screenStream);
    stopStream(cameraStream);
    stopStream(micStream);
    if (recorderRef.current?.state && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    // Filet de sécurité : fermer le studio en pleine prise ne doit pas laisser
    // l'application tourner à plein régime une fois réduite.
    api()?.setThrottling(true);
    audioCtxRef.current?.close().catch(() => {});
  }, []);

  const set = (patch) => setStyle((s) => ({ ...s, ...patch }));

  const convert = async () => {
    setBusy(true);
    try {
      const res = await api()?.toMp4(result.path);
      if (res?.success) setResult((r) => ({ ...r, path: res.path, bytes: res.bytes, mp4: true }));
      else setError(t('studio.err.convert'));
    } finally {
      setBusy(false);
    }
  };

  // -------------------------------------------------------------------------
  return (
    <>
    {/* Barre flottante quand le studio est réduit. C'est elle qui rend
        possible l'enregistrement d'Orbit lui-même : le panneau disparaît, il
        ne reste qu'un chronomètre et deux boutons. */}
    {minimized && step === 'recording' && (
      <div className="fixed bottom-5 right-5 z-[10001] flex items-center gap-2 rounded-full border border-border bg-bg-elevated/95 px-3 py-2 shadow-2xl backdrop-blur">
        <Circle size={10} fill="currentColor" className={paused ? 'text-text-muted' : 'text-error animate-pulse'} />
        <span className="text-sm tabular-nums font-medium">{formatDuration(elapsed)}</span>
        <span className={`text-[11px] tabular-nums ${fpsHealth(fps, FPS) === 'low' ? 'text-warning' : 'text-text-muted'}`}>
          {fps}/{FPS}
        </span>
        <button onClick={togglePause} className="btn-icon w-7 h-7" title={t(paused ? 'studio.resume' : 'studio.pause')}>
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </button>
        <button onClick={stopRecording} className="btn-icon w-7 h-7 text-error" title={t('studio.stop')}>
          <Square size={12} fill="currentColor" />
        </button>
        <button onClick={() => setMinimized(false)} className="btn-icon w-7 h-7" title={t('studio.restore')}>
          <Maximize2 size={13} />
        </button>
      </div>
    )}

    {/* Le panneau reste MONTÉ même réduit : son canvas est la source de
        l'enregistrement. On le sort du champ au lieu de le démonter. */}
    <div
      className={
        minimized && step === 'recording'
          ? 'fixed -left-[99999px] top-0 w-px h-px overflow-hidden opacity-0 pointer-events-none'
          : 'fixed inset-0 z-[10000] bg-black/80 flex items-center justify-center p-4'
      }
      aria-hidden={minimized && step === 'recording'}
    >
      <div className="w-[min(96vw,84rem)] h-[88vh] bg-bg-secondary border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* En-tête */}
        <div className="h-14 px-5 flex items-center gap-3 border-b border-border flex-shrink-0">
          <Sparkles size={18} className="text-accent-primary" />
          <h3 className="font-semibold">{t('studio.title')}</h3>
          {step === 'recording' && (
            <span className="ml-2 flex items-center gap-2 px-2.5 py-1 rounded-full bg-error/15 text-error text-sm tabular-nums">
              <Circle size={9} className={paused ? '' : 'animate-pulse'} fill="currentColor" />
              {formatDuration(elapsed)}
              {paused && ` · ${t('studio.paused')}`}
            </span>
          )}
          {step === 'recording' && !paused && (
            <span
              className={`text-xs tabular-nums ${
                fpsHealth(fps, FPS) === 'low' ? 'text-warning' : 'text-text-muted'
              }`}
              title={fpsHealth(fps, FPS) === 'low' ? t('studio.fpsLow') : ''}
            >
              {t('studio.fpsNow', { fps, target: FPS })}
            </span>
          )}
          <div className="flex-1" />
          {step === 'recording' && (
            <button
              onClick={() => setMinimized(true)}
              className="btn btn-secondary btn-sm"
              title={t('studio.minimizeHint')}
            >
              <Minimize2 size={14} /> {t('studio.minimize')}
            </button>
          )}
          <button onClick={onClose} className="btn-icon w-8 h-8" title={t('common.close')}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Aperçu : c'est exactement ce qui est enregistré */}
          <div className="flex-1 min-w-0 flex flex-col items-center justify-center p-5 bg-bg-primary/40">
            <div className="relative w-full max-w-4xl">
              <canvas
                ref={canvasRef}
                width={OUTPUT.width}
                height={OUTPUT.height}
                className="w-full rounded-xl border border-border shadow-lg bg-black"
              />
              {step === 'countdown' && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
                  <span className="text-7xl font-bold text-white tabular-nums">{countdown}</span>
                </div>
              )}
            </div>

            {error && <p className="mt-3 text-sm text-error max-w-2xl text-center">{error}</p>}

            {/* Les raccourcis sont rappelés sous l'aperçu : changer de fond ou
                de disposition sans rouvrir le panneau, c'est ce qui permet de
                le faire SANS sortir du cadre pendant qu'on parle. */}
            {(step === 'setup' || step === 'recording') && (
              <p className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
                {[
                  ['F', t('studio.background')],
                  ['D', t('studio.layout')],
                  ['C', t('studio.corner')],
                  ['Z', t('studio.zoom')],
                  ['H', t('studio.halo')],
                  ['M', t('studio.mirror')],
                  ...(step === 'recording'
                    ? [['P', t('studio.pause')], ['S', t('studio.stop')], ['R', t('studio.minimize')]]
                    : []),
                ].map(([key, label]) => (
                  <span key={key} className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 rounded border border-border bg-bg-elevated">{key}</kbd>
                    {label}
                  </span>
                ))}
              </p>
            )}

            {/* Commandes */}
            <div className="mt-5 flex items-center gap-3">
              {step === 'setup' && (
                <button onClick={startCountdown} disabled={!sourceId} className="btn btn-primary">
                  <Circle size={14} fill="currentColor" /> {t('studio.start')}
                </button>
              )}
              {step === 'recording' && (
                <>
                  <button onClick={togglePause} className="btn btn-secondary">
                    {paused ? <Play size={15} /> : <Pause size={15} />}
                    {t(paused ? 'studio.resume' : 'studio.pause')}
                  </button>
                  <button onClick={stopRecording} className="btn btn-primary">
                    <Square size={14} fill="currentColor" /> {t('studio.stop')}
                  </button>
                </>
              )}
              {step === 'done' && result && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className="text-sm text-text-muted">
                    {t('studio.saved', {
                      size: Math.max(1, Math.round(result.bytes / 1024 / 1024)),
                      duration: formatDuration(result.duration),
                    })}
                  </span>
                  <button onClick={() => api()?.reveal(result.path)} className="btn btn-secondary btn-sm">
                    <FolderOpen size={14} /> {t('studio.reveal')}
                  </button>
                  <button onClick={() => api()?.saveAs(result.path)} className="btn btn-secondary btn-sm">
                    <Download size={14} /> {t('studio.saveAs')}
                  </button>
                  {ffmpeg && !result.mp4 && (
                    <button onClick={convert} disabled={busy} className="btn btn-secondary btn-sm">
                      {busy ? <Loader2 size={14} className="animate-spin" /> : null} {t('studio.toMp4')}
                    </button>
                  )}
                  <button onClick={() => { setResult(null); setStep('setup'); }} className="btn btn-primary btn-sm">
                    {t('studio.again')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Réglages */}
          <div className="w-80 flex-shrink-0 border-l border-border overflow-y-auto p-4 space-y-5">
            <Section title={t('studio.source')} action={
              <button onClick={loadSources} className="btn-icon w-7 h-7" title={t('studio.refresh')}>
                <RefreshCw size={13} />
              </button>
            }>
              <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                {sources.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSourceId(s.id)}
                    disabled={step === 'recording'}
                    className={`rounded-lg border p-1.5 text-left transition-colors ${
                      s.id === sourceId ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:bg-bg-hover'
                    }`}
                  >
                    {s.thumbnail && (
                      <img src={s.thumbnail} alt="" className="w-full h-14 object-cover rounded mb-1" />
                    )}
                    <span className="flex items-center gap-1 text-[11px] text-text-secondary truncate">
                      {s.kind === 'screen' ? <Monitor size={11} /> : <AppWindow size={11} />}
                      <span className="truncate">{s.name}</span>
                    </span>
                  </button>
                ))}
              </div>
            </Section>

            <Section title={t('studio.devices')}>
              {devices.cameras.length === 0 && devices.mics.length === 0 ? (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-text-muted mb-2">
                    {t(hasHardware ? 'studio.enableHint' : 'studio.noDevices')}
                  </p>
                  {hasHardware && (
                    <button onClick={enableDevices} disabled={asking} className="btn btn-secondary btn-sm w-full">
                      {asking ? <Loader2 size={14} className="animate-spin" /> : <Video size={14} />}
                      {t('studio.enable')}
                    </button>
                  )}
                </div>
              ) : (
              <>
              <label className="block text-xs text-text-muted mb-1">{t('studio.camera')}</label>
              <select
                value={cameraId}
                onChange={(e) => toggleCamera(e.target.value)}
                className="input mb-3"
              >
                <option value="">{t('studio.noCamera')}</option>
                {devices.cameras.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `${t('studio.camera')} ${i + 1}`}</option>
                ))}
              </select>
              <label className="block text-xs text-text-muted mb-1">{t('studio.mic')}</label>
              <select value={micId} onChange={(e) => toggleMic(e.target.value)} className="input">
                <option value="">{t('studio.noMic')}</option>
                {devices.mics.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `${t('studio.mic')} ${i + 1}`}</option>
                ))}
              </select>
              <p className="text-[11px] text-text-muted mt-2 flex items-center gap-1">
                {cameraId ? <Video size={11} /> : <VideoOff size={11} />}
                {micId ? <Mic size={11} /> : <MicOff size={11} />}
                {t('studio.devicesHint')}
              </p>
              </>
              )}
            </Section>

            <Section title={t('studio.look')}>
              <label className="block text-xs text-text-muted mb-1">{t('studio.resolution')}</label>
              <div className="flex gap-2 mb-3">
                {Object.keys(RESOLUTIONS).map((key) => (
                  <button
                    key={key}
                    onClick={() => set({ resolution: key })}
                    disabled={step === 'recording'}
                    className={`flex-1 px-2 py-1.5 rounded-lg border text-xs ${
                      (style.resolution || '720p') === key
                        ? 'border-accent-primary bg-accent-primary/10'
                        : 'border-border hover:bg-bg-hover'
                    }`}
                  >
                    {key}
                  </button>
                ))}
              </div>

              <label className="block text-xs text-text-muted mb-1">{t('studio.fps')}</label>
              <div className="flex gap-2 mb-3">
                {FRAME_RATES.map((rate) => (
                  <button
                    key={rate}
                    onClick={() => set({ fps: rate })}
                    disabled={step === 'recording'}
                    className={`flex-1 px-2 py-1.5 rounded-lg border text-xs ${
                      FPS === rate ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:bg-bg-hover'
                    }`}
                  >
                    {rate}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-text-muted mb-3">{t('studio.fpsHint')}</p>

              <label className="block text-xs text-text-muted mb-1">{t('studio.background')}</label>
              <div className="flex flex-wrap gap-2 mb-3">
                {Object.keys(BACKGROUNDS).map((key) => (
                  <button
                    key={key}
                    onClick={() => set({ background: key })}
                    title={t(`studio.bg.${key}`)}
                    aria-pressed={style.background === key}
                    className={`w-8 h-8 rounded-lg border-2 ${
                      style.background === key ? 'border-accent-primary' : 'border-border'
                    }`}
                    style={swatchStyle(key, accentColor)}
                  />
                ))}
              </div>

              <Slider
                label={t('studio.padding')}
                value={style.padding}
                min={0}
                max={20}
                onChange={(v) => set({ padding: v })}
              />
              <Slider
                label={t('studio.radius')}
                value={style.radius}
                min={0}
                max={48}
                onChange={(v) => set({ radius: v })}
              />
              <Toggle
                label={t('studio.shadow')}
                checked={style.shadow}
                onChange={(v) => set({ shadow: v })}
              />
            </Section>

            {cameraId && (
              <Section title={t('studio.cameraLook')}>
                <label className="block text-xs text-text-muted mb-1">{t('studio.layout')}</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {LAYOUTS.map((l) => (
                    <button
                      key={l}
                      onClick={() => set({ layout: l })}
                      className={`px-2 py-1.5 rounded-lg border text-xs ${
                        style.layout === l ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:bg-bg-hover'
                      }`}
                    >
                      {t(`studio.layout.${l}`)}
                    </button>
                  ))}
                </div>
                {/* Dispositions à deux zones : côté et chevauchement. */}
                {(style.layout === 'split' || style.layout === 'presentation') && (
                  <>
                    <label className="block text-xs text-text-muted mb-1">{t('studio.side')}</label>
                    <div className="flex gap-2 mb-3">
                      {CAMERA_SIDES.map((side) => (
                        <button
                          key={side}
                          onClick={() => set({ cameraSide: side })}
                          className={`flex-1 px-2 py-1.5 rounded-lg border text-xs ${
                            (style.cameraSide || 'right') === side
                              ? 'border-accent-primary bg-accent-primary/10'
                              : 'border-border hover:bg-bg-hover'
                          }`}
                        >
                          {t(`studio.side.${side}`)}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 mb-3">
                      {['circle', 'rounded'].map((shape) => (
                        <button
                          key={shape}
                          onClick={() => set({ cameraShape: shape })}
                          className={`flex-1 px-2 py-1.5 rounded-lg border text-xs ${
                            style.cameraShape === shape
                              ? 'border-accent-primary bg-accent-primary/10'
                              : 'border-border hover:bg-bg-hover'
                          }`}
                        >
                          {t(`studio.shape.${shape}`)}
                        </button>
                      ))}
                    </div>
                    {style.layout === 'presentation' && (
                      <Toggle
                        label={t('studio.overlap')}
                        checked={style.cameraOverlap !== false}
                        onChange={(v) => set({ cameraOverlap: v })}
                      />
                    )}
                  </>
                )}
                {style.layout === 'screen' && (
                  <>
                    <label className="block text-xs text-text-muted mb-1">{t('studio.corner')}</label>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {CAMERA_CORNERS.map((c) => (
                        <button
                          key={c}
                          onClick={() => set({ cameraCorner: c })}
                          className={`px-2 py-1.5 rounded-lg border text-xs ${
                            style.cameraCorner === c ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:bg-bg-hover'
                          }`}
                        >
                          {t(`studio.corner.${c}`)}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 mb-3">
                      {['circle', 'rounded'].map((shape) => (
                        <button
                          key={shape}
                          onClick={() => set({ cameraShape: shape })}
                          className={`flex-1 px-2 py-1.5 rounded-lg border text-xs ${
                            style.cameraShape === shape ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:bg-bg-hover'
                          }`}
                        >
                          {t(`studio.shape.${shape}`)}
                        </button>
                      ))}
                    </div>
                    <Slider
                      label={t('studio.cameraSize')}
                      value={style.cameraSize}
                      min={10}
                      max={40}
                      onChange={(v) => set({ cameraSize: v })}
                    />
                  </>
                )}
                <Toggle
                  label={t('studio.mirror')}
                  checked={style.cameraMirror}
                  onChange={(v) => set({ cameraMirror: v })}
                />
              </Section>
            )}

            <Section title={t('studio.motion')}>
              <Toggle
                label={t('studio.halo')}
                checked={Boolean(style.cursorHalo)}
                onChange={(v) => set({ cursorHalo: v })}
                icon={MousePointer2}
              />
              <Toggle
                label={t('studio.zoom')}
                checked={style.zoom}
                onChange={(v) => set({ zoom: v })}
                icon={ZoomIn}
              />
              {style.zoom && (
                <>
                  <Slider
                    label={t('studio.zoomLevel')}
                    value={Math.round(style.zoomLevel * 10)}
                    min={11}
                    max={30}
                    format={(v) => `${(v / 10).toFixed(1)}×`}
                    onChange={(v) => set({ zoomLevel: v / 10 })}
                  />
                  <p className="text-[11px] text-text-muted">{t('studio.zoomHint')}</p>
                </>
              )}
            </Section>
          </div>
        </div>
      </div>

      {/* Sources vidéo cachées : elles alimentent le canvas, jamais l'écran. */}
      {/* Sources vidéo hors champ plutôt que `display:none` : un élément non
          rendu peut cesser de décoder, et le canvas ne recevrait plus rien. */}
      <video ref={screenVideo} autoPlay muted playsInline aria-hidden className={OFFSCREEN} />
      <video ref={cameraVideo} autoPlay muted playsInline aria-hidden className={OFFSCREEN} />
    </div>
    </>
  );
}

function Section({ title, action, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h4>
        {action}
      </div>
      {children}
    </div>
  );
}

function Slider({ label, value, min, max, onChange, format }) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-text-muted">{label}</span>
        <span className="tabular-nums text-text-secondary">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent-primary"
      />
    </div>
  );
}

function Toggle({ label, checked, onChange, icon: Icon }) {
  return (
    <label className="flex items-center justify-between gap-2 mb-2 cursor-pointer">
      <span className="text-sm flex items-center gap-2">
        {Icon ? <Icon size={14} className={checked ? 'text-accent-primary' : 'text-text-muted'} /> : null}
        {label}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-10 h-5 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-5"
      />
    </label>
  );
}

// Pastille de prévisualisation d'un fond dans le sélecteur.
function swatchStyle(key, accentColor) {
  const bg = BACKGROUNDS[key];
  if (!bg || bg.kind === 'none') {
    return { backgroundImage: 'linear-gradient(45deg,#334155 25%,transparent 25%,transparent 75%,#334155 75%)', backgroundSize: '8px 8px' };
  }
  if (bg.kind === 'accent') return { background: `linear-gradient(135deg, ${accentColor}, #0ea5e9)` };
  if (bg.kind === 'solid') return { background: bg.colors[0] };
  return { background: `linear-gradient(135deg, ${bg.colors[0]}, ${bg.colors[1]})` };
}
