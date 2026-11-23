import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';

// ---------------------------------------------------------------------------
// Éditeur de code léger des outils développeur (.sql, .http, corps JSON).
//
// Une zone de texte, une marge numérotée et, quand `runnables` est fourni, un
// ▶ à la ligne de départ de chaque requête — comme les extensions SQL et
// REST Client de VS Code : on exécute une requête précise d'un fichier sans
// la sélectionner. Tabulation = deux espaces ; Ctrl/⌘+Entrée = `onRun`.
// ---------------------------------------------------------------------------
const LINE = 20; // hauteur de ligne en px (marge et texte doivent coïncider)

const CodeEditor = forwardRef(function CodeEditor(
  { value, onChange, onRun, runnables = [], onRunAt, placeholder, minHeight = 120, className = '', readOnly = false },
  ref
) {
  const area = useRef(null);
  const gutter = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const lines = useMemo(() => String(value || '').split('\n').length, [value]);
  const marks = useMemo(() => {
    const m = new Map();
    for (const r of runnables) if (!m.has(r.line)) m.set(r.line, r);
    return m;
  }, [runnables]);

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    selection: () => {
      const el = area.current;
      if (!el) return { start: 0, end: 0, text: '' };
      return { start: el.selectionStart, end: el.selectionEnd, text: el.value.slice(el.selectionStart, el.selectionEnd) };
    },
  }));

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onRun?.();
      return;
    }
    if (e.key === 'Tab' && !readOnly) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = el;
      const next = `${el.value.slice(0, s)}  ${el.value.slice(end)}`;
      onChange?.(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = s + 2;
      });
    }
  };

  return (
    <div
      className={`relative flex min-h-0 overflow-hidden rounded-lg border border-border bg-bg-primary font-mono text-[13px] ${className}`}
      style={{ minHeight }}
    >
      <div
        ref={gutter}
        className="relative w-12 flex-shrink-0 select-none overflow-hidden border-r border-border bg-bg-secondary text-right text-[11px] text-text-muted"
      >
        <div style={{ transform: `translateY(${-scrollTop}px)`, paddingTop: 8 }}>
          {Array.from({ length: lines }, (_, i) => {
            const mark = marks.get(i + 1);
            return (
              <div key={i} className="relative pr-2" style={{ height: LINE, lineHeight: `${LINE}px` }}>
                {mark ? (
                  <button
                    type="button"
                    onClick={() => onRunAt?.(mark)}
                    className="absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded text-success hover:bg-success/15"
                    title={mark.title || 'Exécuter cette requête'}
                  >
                    <Play size={11} fill="currentColor" />
                  </button>
                ) : null}
                {i + 1}
              </div>
            );
          })}
        </div>
      </div>
      <textarea
        ref={area}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        spellCheck={false}
        placeholder={placeholder}
        wrap="off"
        className="min-h-0 flex-1 resize-none bg-transparent p-2 text-text-primary outline-none placeholder:text-text-muted"
        style={{ lineHeight: `${LINE}px`, paddingTop: 8, tabSize: 2 }}
      />
    </div>
  );
});

export default CodeEditor;
