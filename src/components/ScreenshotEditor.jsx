import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowUpRight,
  Circle,
  Contrast,
  Crop,
  Droplet,
  EyeOff,
  Highlighter,
  ListOrdered,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Square,
  SunDim,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import {
  ANNOTATION_COLORS,
  ANNOTATION_WIDTHS,
  DEFAULT_ADJUSTMENTS,
  adjustmentsAreNeutral,
  arrowHead,
  clampAdjustments,
  cropOrigin,
  cssFilterFor,
  nextStepNumber,
  normalizeCrop,
  normalizeRect,
  pixelateBlockSize,
  pixelateGrid,
  shapeIsMeaningful,
  stepRadius,
  textFontSize,
  toImagePoint,
} from '../lib/annotate';
import { useT } from '../lib/i18n';

// ---------------------------------------------------------------------------
// Éditeur d'annotation d'une capture.
//
// La capture s'affiche dans une toile : tout ce qui est dessiné l'est DANS
// l'image, si bien qu'« enregistrer » et « copier » n'ont rien à aplatir —
// `toPngDataUrl()` rend exactement ce que l'utilisateur voit. La géométrie et
// les réglages vivent dans `src/lib/annotate.js` (testés sans navigateur) ;
// ici, il n'y a que des appels de dessin et la saisie.
// ---------------------------------------------------------------------------

const TOOLS = [
  { tool: 'arrow', icon: ArrowUpRight, key: 'annotate.toolArrow' },
  { tool: 'rect', icon: Square, key: 'annotate.toolRect' },
  { tool: 'ellipse', icon: Circle, key: 'annotate.toolEllipse' },
  { tool: 'pen', icon: Pencil, key: 'annotate.toolPen' },
  { tool: 'highlight', icon: Highlighter, key: 'annotate.toolHighlight' },
  { tool: 'text', icon: Type, key: 'annotate.toolText' },
  { tool: 'step', icon: ListOrdered, key: 'annotate.toolStep' },
  { tool: 'blur', icon: EyeOff, key: 'annotate.toolBlur' },
  { tool: 'crop', icon: Crop, key: 'annotate.toolCrop' },
];

const ADJUSTERS = [
  { key: 'brightness', icon: SunDim, label: 'annotate.brightness', min: 20, max: 200 },
  { key: 'contrast', icon: Contrast, label: 'annotate.contrast', min: 20, max: 300 },
  { key: 'saturation', icon: Droplet, label: 'annotate.saturation', min: 0, max: 300 },
];

function drawShape(ctx, shape, canvas, origin = { x: 0, y: 0 }) {
  const color = shape.color || ANNOTATION_COLORS[0];
  const width = Math.max(1, Number(shape.width) || 2);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;

  if (shape.tool === 'blur') {
    // La source est la toile elle-même : l'image y est déjà dessinée, donc
    // chaque bloc reprend la couleur du pixel qu'il recouvre. Les coordonnées
    // SOURCE sont celles de la toile — d'où le retrait de l'origine du
    // recadrage, que la transformation du contexte ne s'applique qu'à la
    // destination.
    ctx.imageSmoothingEnabled = false;
    for (const block of pixelateGrid(shape.rect, shape.blockSize)) {
      ctx.drawImage(
        canvas,
        block.x - origin.x,
        block.y - origin.y,
        1,
        1,
        block.x,
        block.y,
        block.width,
        block.height
      );
    }
    ctx.restore();
    return;
  }

  if (shape.tool === 'step') {
    // Pastille numérotée : fond plein, numéro au centre, liseré sombre pour
    // rester lisible sur une capture claire comme sur une capture foncée.
    const radius = stepRadius(width);
    ctx.beginPath();
    ctx.arc(shape.at.x, shape.at.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(2, radius / 7);
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.55)';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(radius * 1.15)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(shape.index || 1), shape.at.x, shape.at.y + radius * 0.06);
    ctx.restore();
    return;
  }

  if (shape.tool === 'rect') {
    ctx.strokeRect(shape.rect.x, shape.rect.y, shape.rect.width, shape.rect.height);
  } else if (shape.tool === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(
      shape.rect.x + shape.rect.width / 2,
      shape.rect.y + shape.rect.height / 2,
      Math.max(1, shape.rect.width / 2),
      Math.max(1, shape.rect.height / 2),
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
  } else if (shape.tool === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(shape.from.x, shape.from.y);
    ctx.lineTo(shape.to.x, shape.to.y);
    ctx.stroke();
    const head = arrowHead(shape.from, shape.to, width);
    ctx.beginPath();
    ctx.moveTo(head[0].x, head[0].y);
    ctx.lineTo(head[1].x, head[1].y);
    ctx.lineTo(head[2].x, head[2].y);
    ctx.stroke();
  } else if (shape.tool === 'pen' || shape.tool === 'highlight') {
    if (shape.tool === 'highlight') {
      // Un surligneur laisse voir ce qu'il recouvre, et ne s'assombrit pas aux
      // croisements du même tracé.
      ctx.globalAlpha = 0.35;
      ctx.globalCompositeOperation = 'multiply';
      ctx.lineWidth = width * 4;
    }
    ctx.beginPath();
    shape.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  } else if (shape.tool === 'text') {
    const size = textFontSize(width);
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.textBaseline = 'top';
    // Liseré sombre : un texte rouge sur une capture rouge resterait illisible.
    ctx.lineWidth = Math.max(2, size / 8);
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.72)';
    String(shape.text || '')
      .split('\n')
      .forEach((line, index) => {
        const y = shape.at.y + index * size * 1.22;
        ctx.strokeText(line, shape.at.x, y);
        ctx.fillText(line, shape.at.x, y);
      });
  }
  ctx.restore();
}

const ScreenshotEditor = forwardRef(function ScreenshotEditor({ dataUrl, alt, sensitive }, ref) {
  const t = useT();
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const drawingRef = useRef(null);
  // La forme en cours vit aussi dans une ref : valider depuis l'updater d'un
  // `setState` la dupliquerait (React rejoue les updaters en StrictMode).
  const draftRef = useRef(null);
  const textRef = useRef(null);
  const [imageSize, setImageSize] = useState(null);
  const [tool, setTool] = useState('arrow');
  const [color, setColor] = useState(ANNOTATION_COLORS[0]);
  const [width, setWidth] = useState(ANNOTATION_WIDTHS[1]);
  const [shapes, setShapes] = useState([]);
  const [draft, setDraft] = useState(null);
  const [adjustments, setAdjustments] = useState(DEFAULT_ADJUSTMENTS);
  const [textInput, setTextInput] = useState(null);
  const [showAdjust, setShowAdjust] = useState(false);
  // Recadrage : une fenêtre sur l'image d'origine. Les formes gardent leurs
  // coordonnées d'origine, ce qui permet de défaire le recadrage sans les
  // déplacer.
  const [crop, setCrop] = useState(null);
  const [maskedSensitive, setMaskedSensitive] = useState(false);

  const sensitiveRegions = useMemo(
    () => (Array.isArray(sensitive) ? sensitive.filter((rect) => rect?.width > 0 && rect?.height > 0) : []),
    [sensitive]
  );
  // Taille de la zone visible : l'image entière, ou le recadrage. Mémoïsée,
  // sinon le nouvel objet à chaque rendu relancerait tout ce qui en dépend.
  const viewSize = useMemo(
    () => (crop ? { width: crop.width, height: crop.height } : imageSize),
    [crop, imageSize]
  );
  const origin = useMemo(() => cropOrigin(crop), [crop]);

  // L'image source est chargée une fois ; la toile ne la redemande jamais.
  useEffect(() => {
    if (!dataUrl) return undefined;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.src = dataUrl;
    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  // Remise à zéro quand une NOUVELLE capture arrive : les annotations de la
  // précédente n'ont rien à faire sur celle-ci.
  useEffect(() => {
    draftRef.current = null;
    textRef.current = null;
    setShapes([]);
    setDraft(null);
    setTextInput(null);
    setCrop(null);
    setMaskedSensitive(false);
    setAdjustments(DEFAULT_ADJUSTMENTS);
  }, [dataUrl]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !imageSize) return;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Recadrage : on décale la toile au lieu de recalculer chaque forme.
    ctx.translate(-origin.x, -origin.y);
    ctx.save();
    ctx.filter = cssFilterFor(adjustments);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
    for (const shape of draft ? [...shapes, draft] : shapes) {
      // Le brouillon de recadrage n'est pas une forme : il se montre en cadre
      // de sélection, et ne laisse aucune trace dans l'image.
      if (shape.tool === 'crop') {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.setLineDash([7, 5]);
        ctx.lineWidth = 2;
        ctx.strokeRect(shape.rect.x, shape.rect.y, shape.rect.width, shape.rect.height);
        ctx.restore();
        continue;
      }
      drawShape(ctx, shape, canvas, origin);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [adjustments, draft, imageSize, origin, shapes]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useImperativeHandle(
    ref,
    () => ({
      // Ce que l'utilisateur voit, prêt à être enregistré ou copié. `null` si
      // rien n'a été touché : le processus principal garde alors l'original
      // (aucun ré-encodage, aucune perte).
      toPngDataUrl: () => {
        if (!canvasRef.current || !imageSize) return null;
        if (!shapes.length && !crop && adjustmentsAreNeutral(adjustments)) return null;
        return canvasRef.current.toDataURL('image/png');
      },
      isEdited: () => shapes.length > 0 || Boolean(crop) || !adjustmentsAreNeutral(adjustments),
    }),
    [adjustments, crop, imageSize, shapes]
  );

  const pointOf = useCallback(
    (event) => {
      const canvas = canvasRef.current;
      if (!canvas || !viewSize) return { x: 0, y: 0 };
      // Le point est d'abord ramené dans la zone AFFICHÉE, puis replacé dans
      // l'image d'origine : les formes y vivent toutes.
      const inView = toImagePoint(
        { x: event.clientX, y: event.clientY },
        canvas.getBoundingClientRect(),
        viewSize
      );
      return { x: inView.x + origin.x, y: inView.y + origin.y };
    },
    [origin, viewSize]
  );

  const setDraftShape = useCallback((shape) => {
    draftRef.current = shape;
    setDraft(shape);
  }, []);

  const setText = useCallback((value) => {
    textRef.current = value;
    setTextInput(value);
  }, []);

  const commitText = useCallback(() => {
    const current = textRef.current;
    setText(null);
    if (!current) return;
    const shape = {
      tool: 'text',
      at: current.at,
      text: current.value,
      color: current.color,
      width: current.width,
    };
    if (shapeIsMeaningful(shape)) setShapes((list) => [...list, shape]);
  }, [setText]);

  const onPointerDown = (event) => {
    if (event.button !== 0 || !imageSize) return;
    if (textInput) {
      commitText();
      return;
    }
    const at = pointOf(event);
    if (tool === 'text') {
      setText({ at, value: '', color, width });
      return;
    }
    if (tool === 'step') {
      // Une étape se pose d'un clic, et se numérote toute seule.
      setShapes((list) => [...list, { tool: 'step', at, color, width, index: nextStepNumber(list) }]);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = { pointerId: event.pointerId, from: at };
    if (tool === 'pen' || tool === 'highlight') {
      setDraftShape({ tool, color, width, points: [at] });
    } else if (tool === 'arrow') {
      setDraftShape({ tool, color, width, from: at, to: at });
    } else {
      setDraftShape({
        tool,
        color,
        width,
        rect: normalizeRect(at, at, imageSize),
        ...(tool === 'blur' ? { blockSize: pixelateBlockSize(imageSize) } : {}),
      });
    }
  };

  const onPointerMove = (event) => {
    const drawing = drawingRef.current;
    const current = draftRef.current;
    if (!drawing || drawing.pointerId !== event.pointerId || !current) return;
    const at = pointOf(event);
    if (current.tool === 'pen' || current.tool === 'highlight') {
      setDraftShape({ ...current, points: [...current.points, at] });
    } else if (current.tool === 'arrow') {
      setDraftShape({ ...current, to: at });
    } else {
      setDraftShape({ ...current, rect: normalizeRect(drawing.from, at, imageSize) });
    }
  };

  const onPointerUp = (event) => {
    const drawing = drawingRef.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    drawingRef.current = null;
    const current = draftRef.current;
    setDraftShape(null);
    if (!current) return;
    // Le recadrage n'ajoute pas une forme : il change la zone regardée.
    if (current.tool === 'crop') {
      const next = normalizeCrop(current.rect, imageSize);
      if (next) {
        setCrop(next);
        setTool('arrow');
      }
      return;
    }
    if (shapeIsMeaningful(current)) setShapes((list) => [...list, current]);
  };

  const undo = () => setShapes((list) => list.slice(0, -1));
  const clearAll = () => {
    setShapes([]);
    setText(null);
    setCrop(null);
    setMaskedSensitive(false);
    setAdjustments(DEFAULT_ADJUSTMENTS);
  };

  // Masquage assisté : les zones repérées DANS LA PAGE avant la capture
  // deviennent des masques ordinaires — annulables un par un, et déplaçables
  // dans l'historique comme le reste. Orbit propose, l'utilisateur décide.
  const maskSensitive = () => {
    if (!sensitiveRegions.length || !imageSize) return;
    const blockSize = pixelateBlockSize(imageSize);
    setShapes((list) => [
      ...list,
      ...sensitiveRegions.map((rect) => ({
        tool: 'blur',
        blockSize,
        // Un peu plus large que la mesure : les caractères débordent souvent
        // de leur rectangle (jambages, accents).
        rect: normalizeRect(
          { x: rect.x - 2, y: rect.y - 2 },
          { x: rect.x + rect.width + 2, y: rect.y + rect.height + 2 },
          imageSize
        ),
      })),
    ]);
    setMaskedSensitive(true);
  };

  // Position de la zone de saisie : le texte s'écrit LÀ où on a cliqué, à la
  // taille qu'il aura dans l'image.
  const textStyle = useMemo(() => {
    const canvas = canvasRef.current;
    if (!textInput || !canvas || !viewSize) return null;
    const scale = canvas.clientWidth / viewSize.width || 1;
    // Le champ se place dans la zone AFFICHÉE : avec un recadrage, l'origine
    // de l'image n'est plus le coin supérieur gauche de la toile.
    return {
      left: `${(textInput.at.x - origin.x) * scale}px`,
      top: `${(textInput.at.y - origin.y) * scale}px`,
      color: textInput.color,
      fontSize: `${Math.max(11, textFontSize(textInput.width) * scale)}px`,
    };
  }, [origin, textInput, viewSize]);

  const edited = shapes.length > 0 || Boolean(crop) || !adjustmentsAreNeutral(adjustments);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-bg-subtle/40 px-3 py-2">
        {TOOLS.map(({ tool: value, icon: Icon, key }) => (
          <button
            key={value}
            type="button"
            onClick={() => setTool(value)}
            title={t(key)}
            aria-label={t(key)}
            aria-pressed={tool === value}
            className={`rounded-lg p-2 transition ${
              tool === value
                ? 'bg-accent/20 text-accent'
                : 'text-text-muted hover:bg-bg-subtle hover:text-text-primary'
            }`}
          >
            <Icon size={16} />
          </button>
        ))}

        <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />

        <div className="flex items-center gap-1" role="group" aria-label={t('annotate.color')}>
          {ANNOTATION_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setColor(value)}
              title={t('annotate.color')}
              aria-label={`${t('annotate.color')} ${value}`}
              aria-pressed={color === value}
              className={`h-5 w-5 rounded-full border transition ${
                color === value ? 'scale-110 border-text-primary' : 'border-border/70'
              }`}
              style={{ background: value }}
            />
          ))}
        </div>

        <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />

        <div className="flex items-center gap-1" role="group" aria-label={t('annotate.width')}>
          {ANNOTATION_WIDTHS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setWidth(value)}
              title={t('annotate.width')}
              aria-label={`${t('annotate.width')} ${value}`}
              aria-pressed={width === value}
              className={`grid h-7 w-7 place-items-center rounded-lg transition ${
                width === value ? 'bg-accent/20' : 'hover:bg-bg-subtle'
              }`}
            >
              <span
                className="block rounded-full bg-text-primary"
                style={{ width: `${Math.min(16, value + 2)}px`, height: `${Math.min(10, value / 1.6 + 1.5)}px` }}
              />
            </button>
          ))}
        </div>

        <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />

        <button
          type="button"
          onClick={() => setShowAdjust((value) => !value)}
          aria-pressed={showAdjust}
          title={t('annotate.adjust')}
          className={`flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs transition ${
            showAdjust || !adjustmentsAreNeutral(adjustments)
              ? 'bg-accent/20 text-accent'
              : 'text-text-muted hover:bg-bg-subtle hover:text-text-primary'
          }`}
        >
          <Contrast size={16} />
          {t('annotate.adjust')}
        </button>

        {sensitiveRegions.length > 0 && (
          <button
            type="button"
            onClick={maskSensitive}
            disabled={maskedSensitive}
            title={t('annotate.maskSensitiveHint')}
            className="flex items-center gap-1.5 rounded-lg bg-amber-400/15 px-2.5 py-2 text-xs font-medium text-amber-200 transition hover:bg-amber-400/25 disabled:opacity-40"
          >
            <ShieldAlert size={15} />
            {maskedSensitive
              ? t('annotate.maskSensitiveDone')
              : t('annotate.maskSensitive', { count: sensitiveRegions.length })}
          </button>
        )}

        {crop && (
          <button
            type="button"
            onClick={() => setCrop(null)}
            title={t('annotate.cropResetHint')}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-text-muted transition hover:bg-bg-subtle hover:text-text-primary"
          >
            <RotateCcw size={14} />
            {t('annotate.cropReset')}
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={undo}
            disabled={!shapes.length}
            title={t('annotate.undo')}
            aria-label={t('annotate.undo')}
            className="rounded-lg p-2 text-text-muted transition hover:bg-bg-subtle hover:text-text-primary disabled:opacity-40"
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={!edited}
            title={t('annotate.clear')}
            aria-label={t('annotate.clear')}
            className="rounded-lg p-2 text-text-muted transition hover:bg-bg-subtle hover:text-error disabled:opacity-40"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {showAdjust && (
        <div className="grid gap-3 border-b border-border bg-bg-subtle/25 px-4 py-3 sm:grid-cols-3">
          {ADJUSTERS.map(({ key, icon: Icon, label, min, max }) => (
            <label key={key} className="flex items-center gap-2 text-xs text-text-muted">
              <Icon size={14} className="shrink-0" />
              <span className="w-20 shrink-0">{t(label)}</span>
              <input
                type="range"
                min={min}
                max={max}
                value={adjustments[key]}
                onChange={(event) =>
                  setAdjustments((current) =>
                    clampAdjustments({ ...current, [key]: Number(event.target.value) })
                  )
                }
                className="min-w-0 flex-1 accent-accent"
              />
              <span className="w-10 shrink-0 text-right tabular-nums">{adjustments[key]}%</span>
            </label>
          ))}
          <button
            type="button"
            onClick={() => setAdjustments(DEFAULT_ADJUSTMENTS)}
            disabled={adjustmentsAreNeutral(adjustments)}
            className="flex items-center gap-1.5 self-start text-xs text-text-muted transition hover:text-text-primary disabled:opacity-40 sm:col-span-3"
          >
            <RotateCcw size={13} /> {t('annotate.resetAdjust')}
          </button>
        </div>
      )}

      <div className="relative max-h-[62vh] overflow-auto bg-black/30 p-3">
        <div className="relative mx-auto w-fit">
          <canvas
            ref={canvasRef}
            width={viewSize?.width || 0}
            height={viewSize?.height || 0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label={alt}
            role="img"
            className="block h-auto max-h-[58vh] max-w-full touch-none rounded-lg object-contain shadow-xl"
            style={{ cursor: tool === 'text' ? 'text' : 'crosshair' }}
          />
          {textInput && textStyle && (
            <textarea
              autoFocus
              value={textInput.value}
              onChange={(event) => setText({ ...textInput, value: event.target.value })}
              onBlur={commitText}
              onKeyDown={(event) => {
                // Entrée valide, Maj+Entrée passe à la ligne, Échap abandonne
                // le texte sans fermer l'aperçu.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  commitText();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setText(null);
                }
              }}
              placeholder={t('annotate.textPlaceholder')}
              className="absolute z-10 min-w-[8rem] resize-none rounded border border-dashed border-white/60 bg-black/35 p-1 font-semibold leading-tight outline-none"
              style={textStyle}
              rows={1}
            />
          )}
        </div>
      </div>
    </div>
  );
});

export default ScreenshotEditor;
