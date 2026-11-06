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
  PenLine,
  Maximize2,
  RefreshCw,
  Eye,
  EyeOff,
  GripVertical,
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
  directStudioKey,
  STUDIO_KEYS,
  composeLayout,
  stepLayoutTransition,
  stepFade,
  PRESENTATION_FRAMINGS,
  framingOf,
  framingPatch,
  CAMERA_ALIGNS,
  inertReason,
  micLevel,
  zoomPulseLevel,
  ZOOM_PULSE_MS,
  titleCardPhase,
  presetPatch,
  savePreset,
  removePreset,
  MAX_PRESETS,
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

// Temps pendant lequel l'image figée de la pause est ENCORE enregistrée, avant
// la coupure. Assez pour qu'on lise le bandeau à la relecture, assez court
// pour ne pas allonger la vidéo d'une seconde à chaque pause.
const PAUSE_HOLD_MS = 700;

// Touche associée à chaque action, pour rejouer un raccourci GLOBAL par le
// même chemin que la touche locale. `STUDIO_KEYS` reste la seule source.
const KEY_FOR_ACTION = Object.fromEntries(
  Object.entries(STUDIO_KEYS).map(([touche, action]) => [action, touche])
);


export default function RecordingStudio({ onClose }) {
  const t = useT();
  const accentColor = useStore((s) => s.settings?.accentColor) || '#6366f1';
  const savedStyle = useStore((s) => s.settings?.studio);
  const savedPresets = useStore((s) => s.settings?.studioPresets);
  const updateSettings = useStore((s) => s.updateSettings);
  const presets = useMemo(() => (Array.isArray(savedPresets) ? savedPresets : []), [savedPresets]);

  const [step, setStep] = useState('setup'); // setup | countdown | recording | done
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState('');
  const [devices, setDevices] = useState({ cameras: [], mics: [] });
  const [cameraId, setCameraId] = useState('');
  const [micId, setMicId] = useState('');
  const [style, setStyle] = useState({ ...DEFAULT_STYLE, ...(savedStyle || {}) });
  const styleRef = useRef(style);
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
  // Coup de zoom en cours : seul le suivi du curseur s'en sert (il doit se
  // réveiller le temps de la pulsation), d'où un état plutôt qu'une référence.
  const [pulsing, setPulsing] = useState(false);
  // Ce qu'une touche vient de changer, affiché brièvement sur l'aperçu.
  const [hint, setHint] = useState(null);
  const [presetName, setPresetName] = useState('');
  // Position de la barre réduite, en pixels depuis le coin bas droit. Elle se
  // déplace par sa poignée : posée d'office en bas à droite, elle masquait
  // parfois justement ce qu'on voulait montrer.
  const [barOffset, setBarOffset] = useState({ right: 20, bottom: 20 });
  const barRef = useRef(null);
  // Retour d'image dans la barre réduite, pour voir ce qui est filmé. Sous
  // Linux, rien n'empêche la capture d'écran de reprendre une fenêtre : s'il
  // est à l'écran, il est dans la vidéo — d'où la possibilité de le replier.
  const previewRef = useRef(null);
  // Couche d'annotation de l'écran : une VRAIE fenêtre au-dessus de tout, donc
  // reprise telle quelle par la capture d'écran — le studio n'a rien à
  // composer, et elle sert aussi bien hors enregistrement.
  const [annotating, setAnnotating] = useState(false);
  const toggleAnnotate = useCallback(async () => {
    const result = await window.electronAPI?.screenshots?.toggleAnnotate?.();
    if (result?.success) setAnnotating(result.open === true);
  }, []);
  // Le gestionnaire de touches est posé une fois : il lit la bascule par une
  // ref plutôt que de se réabonner à chaque rendu.
  const toggleAnnotateRef = useRef(toggleAnnotate);
  useEffect(() => {
    toggleAnnotateRef.current = toggleAnnotate;
  }, [toggleAnnotate]);
  // Tracés de la couche d'annotation, recomposés dans la vidéo : la capture
  // d'écran ne reprend pas toujours une fenêtre transparente (cas courant sous
  // Linux), et l'annotation manquait alors à l'enregistrement.
  const annotationsRef = useRef(null);
  useEffect(() => {
    const offState = window.electronAPI?.screenshots?.onAnnotateState?.((state) => {
      setAnnotating(state?.open === true);
      if (state?.open !== true) annotationsRef.current = null;
    });
    const offDraw = window.electronAPI?.screenshots?.onAnnotateDraw?.((state) => {
      const previous = annotationsRef.current;
      // La liste complète n'arrive que lorsqu'elle change : on garde la
      // précédente le reste du temps.
      annotationsRef.current = { ...state, strokes: state.strokes || previous?.strokes || [] };
    });
    return () => {
      if (typeof offState === 'function') offState();
      if (typeof offDraw === 'function') offDraw();
    };
  }, []);

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
  // Enchaînements : la géométrie affichée rattrape la disposition demandée, et
  // le fond fait un fondu. L'état vit dans une ref — il change à chaque image,
  // en faire un état React redéclencherait trente rendus par seconde.
  const transitionRef = useRef(null);
  const bgFadeRef = useRef(null);
  // Coup de zoom : l'instant où il a été demandé, et rien d'autre — sa courbe
  // se déduit du temps écoulé (voir zoomPulseLevel).
  const pulseRef = useRef(0);
  // Niveau de voix lissé, et l'analyseur qui le mesure.
  const voiceRef = useRef(0);
  const analyserRef = useRef(null);
  const micBufRef = useRef(null);
  // Début du carton de titre (enregistrement ou aperçu à la demande).
  const titleStartRef = useRef(0);
  // Image figée pendant la pause.
  const frozenRef = useRef(null);
  const pulseTimer = useRef(0);
  const pauseTimer = useRef(0);
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
  // Lue par la boucle de rendu sans la relancer à chaque changement de liste.
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  // --- Préférences : le style choisi survit à la fermeture ------------------
  useEffect(() => {
    styleRef.current = style;
    updateSettings({ studio: style });
  }, [style, updateSettings]);

  // Cadrages mémorisés. Lus par le gestionnaire de touches via une référence :
  // il est posé une fois et ne doit pas se réabonner à chaque enregistrement.
  const presetsRef = useRef(presets);
  useEffect(() => {
    presetsRef.current = presets;
  }, [presets]);

  // L'annonce d'un réglage s'efface d'elle-même : c'est un accusé de
  // réception, pas un bandeau de plus à regarder.
  useEffect(() => {
    if (!hint) return undefined;
    const timer = setTimeout(() => setHint(null), 1800);
    return () => clearTimeout(timer);
  }, [hint]);

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

  // Analyseur du micro : il alimente l'anneau de la caméra. Branché sur le
  // flux déjà ouvert, il ne coûte qu'une FFT par image — et surtout il tourne
  // AVANT l'enregistrement, pour qu'on puisse vérifier d'un coup d'œil que le
  // bon micro est choisi et qu'il entend quelque chose.
  useEffect(() => {
    const stream = micStream.current;
    if (!micId || !stream) {
      analyserRef.current = null;
      voiceRef.current = 0;
      return undefined;
    }
    let ctx;
    try {
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(stream).connect(analyser);
      micBufRef.current = new Uint8Array(analyser.fftSize);
      analyserRef.current = analyser;
    } catch {
      analyserRef.current = null; // pas d'anneau plutôt qu'un studio cassé
    }
    return () => {
      analyserRef.current = null;
      voiceRef.current = 0;
      ctx?.close?.().catch?.(() => {});
    };
  }, [micId]);

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
    // Niveau du micro, mesuré sur le flux déjà ouvert pour l'enregistrement.
    // Zéro quand l'anneau est coupé : inutile de réveiller l'analyseur pour un
    // chiffre dont personne ne fait rien.
    const readMicLevel = () => {
      const analyser = analyserRef.current;
      if (!analyser || style.voiceRing === false) return 0;
      analyser.getByteTimeDomainData(micBufRef.current);
      return micLevel(micBufRef.current);
    };

    const titleCardFor = (now) => {
      const text = String(style.title || '').trim();
      if (!text || !titleStartRef.current) return null;
      const phase = titleCardPhase(now - titleStartRef.current);
      return phase ? { text, phase } : null;
    };

    const draw = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx) return;
      const now = Date.now();
      // Coup de zoom en cours ? Il l'emporte sur le zoom permanent : c'est un
      // geste, et un geste doit se voir même si le zoom continu est déjà là.
      const pulse = zoomPulseLevel(pulseRef.current, now, style.zoomLevel);
      const zoomLevel = pulse > 1 ? pulse : style.zoom ? style.zoomLevel : 1;
      // Le point suivi sert au zoom ET au halo : on l'entretient dès que l'un
      // des deux est demandé. Le halo suit de plus près (le zoom, lui, doit
      // rester lent pour ne pas donner le mal de mer).
      focusRef.current =
        zoomLevel > 1 || style.cursorHalo
          ? easeFocus(
              focusRef.current,
              targetFocus.current,
              // Un coup de zoom doit arriver SUR le curseur, pas le rattraper
              // en deux secondes : pendant la pulsation, on suit de près.
              pulse > 1 ? 0.3 : style.cursorHalo && !style.zoom ? 0.35 : 0.12
            )
          : { x: 0.5, y: 0.5 };
      // Niveau de voix, lissé : la mesure brute saute d'une image à l'autre et
      // ferait vibrer l'anneau au lieu de le faire respirer.
      voiceRef.current = voiceRef.current * 0.72 + readMicLevel() * 0.28;
      const current = sourceRef.current;
      const camera = cameraId ? cameraVideo.current : null;
      // Disposition VISÉE, puis plan réellement dessiné : entre les deux, un
      // enchaînement de quelques centaines de millisecondes. Sans lui, changer
      // de disposition en pleine phrase se voyait comme une coupure au montage.
      const target = composeLayout({
        outW: canvas.width,
        outH: canvas.height,
        style,
        hasCamera: Boolean(camera && camera.videoWidth),
      });
      transitionRef.current = stepLayoutTransition(transitionRef.current, target, now);
      bgFadeRef.current = stepFade(bgFadeRef.current, style.background, now);
      drawFrame(ctx, {
        width: canvas.width,
        height: canvas.height,
        screenVideo: screenVideo.current,
        cameraVideo: camera,
        style,
        accentColor,
        focus: focusRef.current,
        captureBounds: current?.kind === 'screen' ? current.bounds : null,
        annotations: annotationsRef.current,
        plan: transitionRef.current.plan,
        backgroundFade: bgFadeRef.current,
        zoomLevel,
        voice: voiceRef.current,
        // Le carton de titre n'existe que pendant l'enregistrement : à la
        // préparation, il cacherait la mise en scène qu'on est en train de
        // régler. Le bouton « Aperçu du titre » le rejoue à la demande.
        titleCard: titleCardFor(now),
        frozen: frozenRef.current,
        banner: frozenRef.current ? tRef.current('studio.pauseBanner') : null,
      });
      // Retour d'image : simple copie réduite du canvas, APRÈS composition —
      // il montre donc exactement ce qui part dans la vidéo.
      const preview = previewRef.current;
      if (preview) {
        preview.getContext('2d')?.drawImage(canvas, 0, 0, preview.width, preview.height);
      }
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
    if ((!style.zoom && !style.cursorHalo && !pulsing) || !source?.bounds) return undefined;
    const timer = setInterval(async () => {
      const point = await api()?.cursor();
      if (point) targetFocus.current = cursorFocus(point, source.bounds);
    }, 100);
    return () => clearInterval(timer);
  }, [style.zoom, style.cursorHalo, pulsing, source]);

  // Coup de zoom : l'image se rapproche de là où l'on travaille, puis revient
  // toute seule. Le point visé est relevé AVANT de zoomer, et posé d'autorité
  // — un zoom qui démarre au centre puis glisse vers le curseur donnerait
  // exactement le mal de mer qu'on cherche à éviter.
  const zoomPulse = useCallback(async () => {
    const bounds = sourceRef.current?.bounds;
    if (bounds) {
      const point = await api()?.cursor();
      if (point) {
        targetFocus.current = cursorFocus(point, bounds);
        focusRef.current = targetFocus.current;
      }
    }
    pulseRef.current = Date.now();
    setPulsing(true);
    clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulsing(false), ZOOM_PULSE_MS);
  }, []);
  const zoomPulseRef = useRef(zoomPulse);
  useEffect(() => {
    zoomPulseRef.current = zoomPulse;
  }, [zoomPulse]);

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
    // Carton de titre : il commence AVEC l'enregistrement, et la composition
    // arrive dessous. On réamorce l'enchaînement pour qu'elle se révèle au
    // lieu d'être déjà là quand le voile se lève.
    // (la base du carton est posée par le même effet, voir plus bas)
    titleStartRef.current = 0;
    const vide = { screen: null, camera: null };
    transitionRef.current = { plan: vide, from: vide, target: null, signature: '', start: 0 };
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
    clearTimeout(pauseTimer.current);
    frozenRef.current = null;
    titleStartRef.current = 0;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorderRef.current = null;
  }, []);

  // Image figée de la pause : une copie du canvas, prise avant la coupure.
  // Elle est REDESSINÉE pendant un instant encore enregistré, pour que la
  // coupure se lise comme voulue à la relecture, au lieu d'un saut brutal dont
  // le spectateur se demande s'il a manqué quelque chose.
  const freezeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    try {
      const copy = Object.assign(document.createElement('canvas'), {
        width: canvas.width,
        height: canvas.height,
      });
      copy.getContext('2d').drawImage(canvas, 0, 0);
      return copy;
    } catch {
      return null; // pas de figé plutôt qu'une pause qui échoue
    }
  };

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      frozenRef.current = freezeCanvas();
      setPaused(true);
      // Le temps que l'image figée et son bandeau entrent dans la vidéo, puis
      // seulement, on coupe pour de bon.
      clearTimeout(pauseTimer.current);
      pauseTimer.current = setTimeout(() => {
        if (recorderRef.current?.state === 'recording') recorderRef.current.pause();
      }, PAUSE_HOLD_MS);
    } else if (recorder.state === 'paused' || paused) {
      clearTimeout(pauseTimer.current);
      if (recorder.state === 'paused') recorder.resume();
      frozenRef.current = null;
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
      if (!startedAt.current) {
        startedAt.current = Date.now() - elapsed;
        // Le carton de titre démarre avec la prise — mais pas après une pause,
        // où `elapsed` a déjà couru : on ne rejoue pas le titre au milieu.
        if (!elapsed) titleStartRef.current = startedAt.current;
      }
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

  // Un réglage qui change SANS que l'image bouge est indiscernable d'un
  // raccourci cassé — c'est ce qui fait écrire « j'appuie et rien ne se
  // passe ». On annonce donc le réglage ET, le cas échéant, la raison pour
  // laquelle il ne se voit pas tout de suite.
  const describePatch = (patch, next) => {
    const champs = Object.keys(patch);
    const nom = (field) => {
      switch (field) {
        case 'layout': return `${t('studio.layout')} · ${t(`studio.layout.${next.layout}`)}`;
        case 'background': return `${t('studio.background')} · ${t(`studio.bg.${next.background}`)}`;
        case 'cameraCorner': return `${t('studio.corner')} · ${t(`studio.corner.${next.cameraCorner}`)}`;
        case 'cameraSide': return `${t('studio.side')} · ${t(`studio.side.${next.cameraSide}`)}`;
        case 'cameraAlign': return `${t('studio.align')} · ${t(`studio.align.${next.cameraAlign}`)}`;
        case 'cameraOverlap': return `${t('studio.framing')} · ${t(`studio.framing.${framingOf(next)}`)}`;
        case 'cameraShape': return `${t('studio.shape')} · ${t(`studio.shape.${next.cameraShape}`)}`;
        case 'zoom': return `${t('studio.zoom')} · ${t(next.zoom ? 'studio.on' : 'studio.off')}`;
        case 'cursorHalo': return `${t('studio.halo')} · ${t(next.cursorHalo ? 'studio.on' : 'studio.off')}`;
        case 'cameraMirror': return `${t('studio.mirror')} · ${t(next.cameraMirror ? 'studio.on' : 'studio.off')}`;
        case 'voiceRing': return `${t('studio.voiceRing')} · ${t(next.voiceRing ? 'studio.on' : 'studio.off')}`;
        default: return null;
      }
    };
    // Le premier champ reconnu porte le message : les patches à deux champs
    // (une flèche règle le coin ET le côté) parlent de la même chose.
    return champs.map(nom).find(Boolean) || null;
  };

  const announce = (label, next, patch) => {
    if (!label) return;
    const reason = patch ? inertReason(patch, next, { hasCamera: Boolean(cameraId) }) : null;
    setHint({ label, reason: reason ? t(`studio.inert.${reason}`) : null, at: Date.now() });
  };

  // `styleRef` double l'état : il est à jour À L'INSTANT, ce dont le
  // gestionnaire de touches a besoin pour enchaîner deux appuis.
  const set = (patch) => {
    const next = { ...styleRef.current, ...patch };
    styleRef.current = next;
    setStyle(next);
    announce(describePatch(patch, next), next, patch);
  };

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
      // Alt + chiffre rappelle un cadrage mémorisé. C'est la seule
      // combinaison admise : les autres appartiennent au système ou à l'app
      // qu'on est en train de filmer.
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        const index = Number(e.key) - 1;
        const patch = presetPatch(presetsRef.current, index);
        if (patch) {
          e.preventDefault();
          const next = { ...styleRef.current, ...patch };
          styleRef.current = next;
          setStyle(next);
          setHint({ label: presetsRef.current[index].name, reason: null, at: Date.now() });
        }
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
      if (action === 'annotate') {
        e.preventDefault();
        toggleAnnotateRef.current?.();
        return;
      }
      if (action === 'zoomPulse' && (step === 'setup' || step === 'recording')) {
        e.preventDefault();
        zoomPulseRef.current?.();
        announce(tRef.current('studio.zoomPulse'));
        return;
      }

      // Mise en scène : modifiable à tout moment, y compris en plein
      // enregistrement — c'est tout l'intérêt.
      if (step === 'setup' || step === 'recording') {
        // Touche de mise en scène ? (chiffres et flèches pour l'accès direct,
        // lettres pour faire défiler)
        const styleAction = STUDIO_KEYS[key];
        const parcourt =
          !e.shiftKey && styleAction && !['pause', 'stop', 'minimize', 'annotate'].includes(styleAction);
        if (!/^[1-9]$/.test(e.key) && !e.key.startsWith('Arrow') && !parcourt) return;
        e.preventDefault();

        // Le calcul part de `styleRef`, tenu à jour À L'INSTANT par `set`.
        // Deux flèches enchaînées dans le même instant lisaient sinon la même
        // valeur périmée : « ↑ » puis « → » donnait « en bas à droite », le
        // second appui ignorant le premier.
        const cur = styleRef.current;
        const patch =
          directStudioKey(e.key, { shift: e.shiftKey }, cur, { hasCamera: Boolean(cameraId) }) ||
          (e.shiftKey ? null : applyStudioKey(key, cur, { hasCamera: Boolean(cameraId) }));
        if (patch) set(patch);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, stopRecording, onClose, cameraId]);

  // --- Raccourcis GLOBAUX pendant la prise ---------------------------------
  // On filme son écran pour montrer AUTRE CHOSE : pendant l'enregistrement, le
  // focus est dans l'application démontrée, et les touches ci-dessus ne
  // recevaient plus rien. Il fallait revenir sur Orbit — donc sortir du cadre
  // — pour changer une disposition. Le processus principal pose donc les mêmes
  // actions en raccourcis système, le temps de la prise seulement
  // (voir electron/studio.js).
  const actionRef = useRef(null);
  // Affecté dans un effet, pas pendant le rendu : un rendu doit rester sans
  // effet de bord, et React le vérifie.
  const executerAction = (action) => {
    if (action === 'pause') {
      togglePause();
      return;
    }
    if (action === 'stop') {
      stopRecording();
      return;
    }
    if (action === 'zoomPulse') {
      zoomPulseRef.current?.();
      setHint({ label: t('studio.zoomPulse'), reason: null, at: Date.now() });
      return;
    }
    // Le reste passe par EXACTEMENT le même chemin que la touche équivalente
    // dans la fenêtre : une seule logique, donc un seul comportement.
    const key = KEY_FOR_ACTION[action];
    const patch = key && applyStudioKey(key, styleRef.current, { hasCamera: Boolean(cameraId) });
    if (patch) set(patch);
  };
  useEffect(() => {
    actionRef.current = executerAction;
  });

  const [globalKeys, setGlobalKeys] = useState([]);
  useEffect(() => {
    if (step !== 'recording') return undefined;
    let annule = false;
    api()?.setGlobalKeys?.(true).then((res) => {
      // Ce qui a RÉELLEMENT été enregistré : un gestionnaire de fenêtres peut
      // s'être approprié une combinaison. Annoncer un raccourci qui ne répond
      // pas serait pire que de ne rien proposer.
      if (!annule) setGlobalKeys(res?.keys || []);
    });
    const off = api()?.onKey?.((action) => actionRef.current?.(action));
    return () => {
      annule = true;
      off?.();
      api()?.setGlobalKeys?.(false);
      setGlobalKeys([]);
    };
  }, [step]);

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

  // Déplacement de la barre réduite par sa poignée. On travaille depuis le
  // coin bas droit (là où elle naît), borné à la fenêtre pour qu'elle ne
  // puisse jamais disparaître hors champ.
  const startBarDrag = (e) => {
    if (e.button !== 0 || !barRef.current) return;
    e.preventDefault();
    const rect = barRef.current.getBoundingClientRect();
    const grabX = e.clientX - rect.right;
    const grabY = e.clientY - rect.bottom;
    const move = (ev) => {
      const width = barRef.current?.offsetWidth || rect.width;
      const height = barRef.current?.offsetHeight || rect.height;
      setBarOffset({
        right: Math.max(4, Math.min(window.innerWidth - width - 4, window.innerWidth - (ev.clientX - grabX))),
        bottom: Math.max(4, Math.min(window.innerHeight - height - 4, window.innerHeight - (ev.clientY - grabY))),
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const storePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    updateSettings({ studioPresets: savePreset(presets, name, style) });
    setPresetName('');
    setHint({ label: name, reason: null, at: Date.now() });
  };

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
      <div
        ref={barRef}
        style={{ right: barOffset.right, bottom: barOffset.bottom }}
        className="fixed z-[10001] flex flex-col items-end gap-2"
      >
      {/* Retour d'image, repliable : il figure dans la vidéo quand on filme
          l'écran où se trouve Orbit. */}
      {style.monitor && (
        <div className="rounded-xl border border-border bg-black shadow-2xl overflow-hidden">
          <canvas
            ref={previewRef}
            width={320}
            height={Math.round((320 * OUTPUT.height) / OUTPUT.width)}
            className="block w-80 max-w-[70vw] h-auto"
          />
        </div>
      )}
      <div className="flex items-center gap-2 rounded-full border border-border bg-bg-elevated/95 pl-1 pr-3 py-2 shadow-2xl backdrop-blur">
        <span
          onPointerDown={startBarDrag}
          className="cursor-grab active:cursor-grabbing text-text-muted px-0.5 touch-none"
          title={t('studio.move')}
        >
          <GripVertical size={14} />
        </span>
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
        {/* Annoter l'écran EN COURS d'enregistrement : c'est justement quand le
            studio est réduit qu'on en a besoin. */}
        <button
          onClick={toggleAnnotate}
          className={`btn-icon w-7 h-7 ${annotating ? 'text-accent-primary' : ''}`}
          aria-pressed={annotating}
          title={t('studio.annotateHint')}
        >
          <PenLine size={13} />
        </button>
        {micId && <MicMeter streamRef={micStream} streamKey={micId} paused={paused} compact />}
        <button
          onClick={() => set({ monitor: !style.monitor })}
          className={`btn-icon w-7 h-7 ${style.monitor ? 'text-accent-primary' : ''}`}
          aria-pressed={Boolean(style.monitor)}
          title={t(style.monitor ? 'studio.monitorHide' : 'studio.monitorShow')}
        >
          {style.monitor ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button onClick={() => setMinimized(false)} className="btn-icon w-7 h-7" title={t('studio.restore')}>
          <Maximize2 size={13} />
        </button>
      </div>
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
          <h3 className="font-semibold">{t('studio.titleCard')}</h3>
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
          {step === 'recording' && micId && (
            <MicMeter streamRef={micStream} streamKey={micId} paused={paused} compact />
          )}
          <div className="flex-1" />
          <button
            onClick={toggleAnnotate}
            className={`btn btn-sm ${annotating ? 'btn-primary' : 'btn-secondary'}`}
            aria-pressed={annotating}
            title={t('studio.annotateHint')}
          >
            <PenLine size={14} /> {t('studio.annotate')}
          </button>
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
          {/* Colonne de l'aperçu : elle ne défile JAMAIS. Seuls les réglages,
              à droite, défilent — l'image qu'on est en train de composer doit
              rester sous les yeux pendant qu'on la règle. Le canvas s'adapte
              donc à la hauteur disponible au lieu de pousser le reste. */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col items-center justify-center gap-3 p-5 overflow-hidden bg-bg-primary/40">
            <div className="relative min-h-0 flex-1 w-full max-w-4xl flex items-center justify-center">
              <canvas
                ref={canvasRef}
                width={OUTPUT.width}
                height={OUTPUT.height}
                className="max-w-full max-h-full rounded-xl border border-border shadow-lg bg-black"
              />
              {step === 'countdown' && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 pointer-events-none">
                  <span className="text-7xl font-bold text-white tabular-nums">{countdown}</span>
                </div>
              )}
              {/* Accusé de réception d'un raccourci. Il est posé SUR l'aperçu
                  mais HORS du canvas : il guide celui qui règle, sans figurer
                  dans la vidéo. */}
              {hint && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center gap-1">
                  <span className="px-3 py-1.5 rounded-full bg-bg-elevated/95 border border-border text-xs shadow-lg backdrop-blur">
                    {hint.label}
                  </span>
                  {hint.reason && (
                    <span className="px-3 py-1 rounded-full bg-warning/15 border border-warning/40 text-[11px] text-warning max-w-sm text-center">
                      {hint.reason}
                    </span>
                  )}
                </div>
              )}
            </div>

            {error && <p className="text-sm text-error max-w-2xl text-center">{error}</p>}

            {/* Les raccourcis sont rappelés sous l'aperçu : changer de fond ou
                de disposition sans rouvrir le panneau, c'est ce qui permet de
                le faire SANS sortir du cadre pendant qu'on parle. */}
            {(step === 'setup' || step === 'recording') && (
              <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
                {[
                  ['1–5', t('studio.layout')],
                  ['⇧1–8', t('studio.background')],
                  ['↑↓←→', t('studio.corner')],
                  ['F', `${t('studio.background')} ▸`],
                  ['D', `${t('studio.layout')} ▸`],
                  ['C', `${t('studio.corner')} ▸`],
                  ['Z', t('studio.zoom')],
                  ['X', t('studio.zoomPulse')],
                  ['H', t('studio.halo')],
                  ['M', t('studio.mirror')],
                  ['V', t('studio.voiceRing')],
                  // Le cadrage ne concerne que la présentation : on ne
                  // l'annonce que là, pour ne pas allonger la liste pour rien.
                  ...(style.layout === 'presentation' ? [['O', t('studio.framing')]] : []),
                  ...(presets.length ? [['⎇1–' + presets.length, t('studio.presets')]] : []),
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

            {/* Les raccourcis ci-dessus ne répondent que si Orbit a le focus.
                Pendant la prise on est ailleurs : ceux-là marchent depuis
                l'application filmée. */}
            {step === 'recording' && globalKeys.length > 0 && (
              <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
                <span className="text-accent-primary">{t('studio.globalKeys')}</span>
                {globalKeys.map(({ accelerator, action }) => (
                  <span key={accelerator} className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 rounded border border-border bg-bg-elevated">
                      {accelerator.replace('Alt+Shift+', '⎇⇧')}
                    </kbd>
                    {t(`studio.action.${action}`)}
                  </span>
                ))}
              </p>
            )}

            {/* Commandes */}
            <div className="flex items-center gap-3">
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
              {/* Onde du micro : on voit qu'il capte AVANT de lancer la prise,
                  pas à la relecture. */}
              {micId && (
                <div className="mt-2" title={t('studio.micLevel')}>
                  <MicMeter streamRef={micStream} streamKey={micId} />
                </div>
              )}
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
                {Object.keys(BACKGROUNDS).map((key, i) => (
                  <button
                    key={key}
                    onClick={() => set({ background: key })}
                    title={`${t(`studio.bg.${key}`)} — Maj+${i + 1}`}
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

              {/* Carton de titre : les trois premières secondes décident si on
                  regarde la suite. Vide = pas de carton. */}
              <label className="block text-xs text-text-muted mb-1 mt-3">{t('studio.titleCard')}</label>
              <input
                value={style.title || ''}
                onChange={(e) => set({ title: e.target.value })}
                placeholder={t('studio.titlePlaceholder')}
                maxLength={80}
                className="input"
              />
              <div className="flex items-center justify-between gap-2 mt-1">
                <p className="text-[11px] text-text-muted">{t('studio.titleHint')}</p>
                {Boolean(String(style.title || '').trim()) && (
                  <button
                    onClick={() => { titleStartRef.current = Date.now(); }}
                    className="btn btn-secondary btn-sm flex-shrink-0"
                  >
                    <Eye size={13} /> {t('studio.titlePreview')}
                  </button>
                )}
              </div>
            </Section>

            {/* Cadrages mémorisés : « ma démo client » et « mon tutoriel » ne
                se filment pas pareil, et refaire huit réglages à chaque fois
                use. Les réglages de machine (définition, cadence) n'en font
                pas partie — voir stagingOf. */}
            <Section title={t('studio.presets')}>
              {presets.length === 0 ? (
                <p className="text-[11px] text-text-muted mb-2">{t('studio.presetsHint')}</p>
              ) : (
                <div className="flex flex-col gap-1.5 mb-2">
                  {presets.map((preset, i) => (
                    <div key={preset.name} className="flex items-center gap-1">
                      <button
                        onClick={() => set(presetPatch(presets, i) || {})}
                        className="flex-1 flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border border-border hover:bg-bg-hover text-xs"
                      >
                        <span className="truncate">{preset.name}</span>
                        <kbd className="flex-shrink-0 px-1 rounded border border-border text-[10px] text-text-muted">⎇{i + 1}</kbd>
                      </button>
                      <button
                        onClick={() => updateSettings({ studioPresets: removePreset(presets, preset.name) })}
                        className="btn-icon w-7 h-7 flex-shrink-0"
                        title={t('common.delete')}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-1">
                <input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') storePreset(); }}
                  placeholder={t('studio.presetName')}
                  maxLength={24}
                  className="input flex-1"
                />
                <button
                  onClick={storePreset}
                  disabled={!presetName.trim() || (presets.length >= MAX_PRESETS && !presets.some((p) => p.name === presetName.trim()))}
                  className="btn btn-secondary btn-sm flex-shrink-0"
                >
                  {t('common.save')}
                </button>
              </div>
            </Section>

            {cameraId && (
              <Section title={t('studio.cameraLook')}>
                <label className="block text-xs text-text-muted mb-1">{t('studio.layout')}</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {LAYOUTS.map((l, i) => (
                    <button
                      key={l}
                      onClick={() => set({ layout: l })}
                      className={`flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg border text-xs ${
                        style.layout === l ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:bg-bg-hover'
                      }`}
                    >
                      <span className="truncate">{t(`studio.layout.${l}`)}</span>
                      {/* Le numéro de la touche est écrit sur le bouton : on
                          l'apprend en s'en servant, sans mémoriser une liste. */}
                      <kbd className="flex-shrink-0 px-1 rounded border border-border text-[10px] text-text-muted">{i + 1}</kbd>
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
                    {/* Cadrage : la vignette mord sur la capture, ou se range à
                        côté. Deux choix nommés plutôt qu'un interrupteur — on
                        voit d'un coup les deux allures possibles. */}
                    {style.layout === 'presentation' && (
                      <>
                        <label className="flex items-center gap-1.5 text-xs text-text-muted mb-1">
                          {t('studio.framing')}
                          <kbd className="px-1 rounded border border-border text-[10px]">O</kbd>
                        </label>
                        <div className="flex gap-2 mb-3">
                          {PRESENTATION_FRAMINGS.map((f) => (
                            <button
                              key={f}
                              onClick={() => set(framingPatch(f))}
                              className={`flex-1 px-2 py-1.5 rounded-lg border text-xs ${
                                framingOf(style) === f
                                  ? 'border-accent-primary bg-accent-primary/10'
                                  : 'border-border hover:bg-bg-hover'
                              }`}
                            >
                              {t(`studio.framing.${f}`)}
                            </button>
                          ))}
                        </div>
                        {/* Hauteur de pose : la vignette tombe parfois sur ce
                            qu'on veut justement montrer. */}
                        <label className="flex items-center gap-1.5 text-xs text-text-muted mb-1">
                          {t('studio.align')}
                          <kbd className="px-1 rounded border border-border text-[10px]">C</kbd>
                        </label>
                        <div className="flex gap-2 mb-3">
                          {CAMERA_ALIGNS.map((a) => (
                            <button
                              key={a}
                              onClick={() => set({ cameraAlign: a })}
                              className={`flex-1 px-2 py-1.5 rounded-lg border text-xs ${
                                (style.cameraAlign || 'middle') === a
                                  ? 'border-accent-primary bg-accent-primary/10'
                                  : 'border-border hover:bg-bg-hover'
                              }`}
                            >
                              {t(`studio.align.${a}`)}
                            </button>
                          ))}
                        </div>
                      </>
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
                {/* L'anneau ne sert à rien sans micro : il ne pourrait que
                    rester éteint, et on chercherait pourquoi. */}
                <Toggle
                  label={t('studio.voiceRing')}
                  checked={style.voiceRing !== false}
                  onChange={(v) => set({ voiceRing: v })}
                />
                {!micId && <p className="text-[11px] text-text-muted">{t('studio.voiceRingHint')}</p>}
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
              {/* Coup de zoom : le geste, plutôt que le réglage. On s'en sert
                  au moment précis où l'on montre quelque chose. */}
              <button
                onClick={() => { zoomPulseRef.current?.(); setHint({ label: t('studio.zoomPulse'), reason: null, at: Date.now() }); }}
                disabled={!source?.bounds}
                className="btn btn-secondary btn-sm w-full mt-2"
                title={t('studio.zoomPulseHint')}
              >
                <ZoomIn size={13} /> {t('studio.zoomPulse')}
                <kbd className="ml-auto px-1 rounded border border-border text-[10px]">X</kbd>
              </button>
              {!source?.bounds && <p className="text-[11px] text-text-muted mt-1">{t('studio.zoomPulseWindow')}</p>}
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

// Vumètre du micro : la forme d'onde en direct. Un micro muet ou mal choisi se
// voit tout de suite — une ligne plate — au lieu de se découvrir à la relecture.
// L'analyse a son propre graphe audio : elle ne touche pas au son enregistré.
function MicMeter({ streamRef, streamKey, paused = false, compact = false }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const track = streamRef.current?.getAudioTracks?.()[0];
    if (!track) return undefined;
    let ctx;
    let frame = 0;
    try {
      ctx = new AudioContext();
    } catch {
      return undefined;
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const g = canvas?.getContext('2d');
      if (!g) return;
      analyser.getByteTimeDomainData(samples);
      const { width, height } = canvas;
      g.clearRect(0, 0, width, height);
      // Niveau crête : il colore l'onde (gris = silence, vert = voix, orange =
      // proche de la saturation).
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v - 128) / 128);
      g.strokeStyle = paused ? '#64748b' : peak > 0.85 ? '#f59e0b' : peak > 0.02 ? '#22c55e' : '#64748b';
      g.lineWidth = compact ? 1.5 : 2;
      g.beginPath();
      const step = samples.length / width;
      for (let x = 0; x < width; x += 1) {
        // Amplifiée ×2 : une voix normale n'occupe qu'un tiers de l'échelle,
        // l'onde serait sinon trop plate pour être lisible en petit.
        const v = (samples[Math.floor(x * step)] - 128) / 128;
        const y = height / 2 + Math.max(-1, Math.min(1, v * 2)) * (height / 2 - 1);
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      ctx.close().catch(() => {});
    };
    // `streamKey` change quand le micro change : c'est le signal de relancer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey, paused, compact]);
  return (
    <canvas
      ref={canvasRef}
      width={compact ? 56 : 280}
      height={compact ? 20 : 36}
      className={compact ? 'w-14 h-5' : 'w-full h-9 rounded-lg border border-border bg-bg-primary/60'}
      aria-hidden
    />
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
