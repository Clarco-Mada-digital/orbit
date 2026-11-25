import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Loader2, Minus, Plus, Square, Volume2, X } from 'lucide-react';
import { useStore } from '../stores/useStore';
import {
  READER_DEFAULTS,
  READER_THEMES,
  extractArticle,
  readerCss,
  readingMinutes,
  resolveTheme,
  sanitizeArticle,
} from '../lib/reader';

// ---------------------------------------------------------------------------
// Mode lecture (F9, palette, clic droit) : l'article de la page, sans menus,
// pubs ni barres latérales, avec la typographie choisie et la lecture à voix
// haute d'Orbit.
//
// SÉCURITÉ : le HTML vient du site. Il est nettoyé (DOMPurify, lib/reader.js)
// PUIS affiché dans une iframe `sandbox="allow-same-origin"` SANS
// `allow-scripts` : aucun script ne peut s'y exécuter, même si un passage
// échappait au nettoyage. `allow-same-origin` sert seulement à ce que
// l'interface règle le style et intercepte les clics sur les liens.
// ---------------------------------------------------------------------------

const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches;

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export default function ReaderView({ webview, onClose, onOpenLink }) {
  const saved = useStore((s) => s.settings.reader);
  const updateSettings = useStore((s) => s.updateSettings);
  const prefs = useMemo(() => ({ ...READER_DEFAULTS, ...(saved || {}) }), [saved]);
  const [article, setArticle] = useState(null); // null = en cours
  const [speaking, setSpeaking] = useState(false);
  const frameRef = useRef(null);
  const rootRef = useRef(null);

  const setPref = (patch) => updateSettings({ reader: { ...prefs, ...patch } });
  const theme = resolveTheme(prefs.theme, prefersDark());
  const colors = READER_THEMES[theme];

  useEffect(() => {
    let alive = true;
    extractArticle(webview).then((res) => alive && setArticle(res));
    return () => {
      alive = false;
    };
  }, [webview]);

  useEffect(() => {
    rootRef.current?.focus();
    const off = window.electronAPI?.tts?.onSpeaking?.(setSpeaking);
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  // Fermer le mode lecture arrête la lecture qu'il a lancée.
  const close = useCallback(() => {
    if (speaking) window.electronAPI?.tts?.stop?.();
    onClose();
  }, [speaking, onClose]);
  // Refs : le document de l'article n'est écrit qu'une fois, ses écouteurs
  // doivent voir les dernières fonctions sans le réécrire.
  const closeRef = useRef(close);
  const linkRef = useRef(onOpenLink);
  useEffect(() => {
    closeRef.current = close;
    linkRef.current = onOpenLink;
  });

  const body = useMemo(() => {
    if (!article?.ok) return '';
    const meta = [article.byline, article.length ? `${readingMinutes(article.text)} min de lecture` : '']
      .filter(Boolean)
      .map(escapeHtml)
      .join(' · ');
    return `<main lang="${escapeHtml(article.lang)}" dir="${article.dir === 'rtl' ? 'rtl' : 'ltr'}">
      <header>
        <div class="site">${escapeHtml(article.siteName)}</div>
        <h1 class="title">${escapeHtml(article.title)}</h1>
        ${meta ? `<div class="meta">${meta}</div>` : ''}
      </header>
      ${sanitizeArticle(article.content, article.url)}
    </main>`;
  }, [article]);

  // Le document est écrit UNE fois par article ; le style se met à jour sur
  // place (changer la taille ne ramène pas en haut de page).
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || !body) return;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><style id="reader-css"></style></head><body>${body}</body></html>`);
    doc.close();
    doc.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) {
        doc.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (/^https?:/i.test(href)) linkRef.current?.(href);
    });
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeRef.current();
    });
  }, [body]);

  useEffect(() => {
    const el = frameRef.current?.contentDocument?.getElementById('reader-css');
    if (el) el.textContent = readerCss({ ...prefs, theme });
  }, [prefs, theme, body]);

  const speak = () => {
    if (speaking) {
      window.electronAPI?.tts?.stop?.();
      return;
    }
    const text = [article?.title, article?.text].filter(Boolean).join('.\n');
    window.electronAPI?.tts?.speak?.(text);
  };

  const btn = 'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs hover:bg-bg-hover disabled:opacity-40';

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(e) => e.key === 'Escape' && close()}
      className="fixed inset-0 z-[10000] flex flex-col outline-none animate-fade-in"
      style={{ background: colors.bg }}
      role="dialog"
      aria-label="Mode lecture"
    >
      <div className="app-drag flex flex-wrap items-center gap-1 border-b border-border bg-bg-elevated px-3 py-1.5 text-text-primary">
        <BookOpen size={16} className="mr-1 text-accent-primary" />
        <span className="mr-auto truncate text-sm font-medium">{article?.ok ? article.siteName || 'Mode lecture' : 'Mode lecture'}</span>
        <div className="app-no-drag flex flex-wrap items-center gap-1">
          <button type="button" className={btn} onClick={() => setPref({ fontSize: Math.max(14, prefs.fontSize - 1) })} title="Texte plus petit">
            <Minus size={14} />
          </button>
          <span className="w-8 text-center text-xs tabular-nums text-text-muted">{prefs.fontSize}</span>
          <button type="button" className={btn} onClick={() => setPref({ fontSize: Math.min(30, prefs.fontSize + 1) })} title="Texte plus grand">
            <Plus size={14} />
          </button>
          <select value={prefs.font} onChange={(e) => setPref({ font: e.target.value })} className="input h-8 w-auto py-0 text-xs" title="Police">
            <option value="serif">Serif</option>
            <option value="sans">Sans serif</option>
          </select>
          <select value={prefs.width} onChange={(e) => setPref({ width: e.target.value })} className="input h-8 w-auto py-0 text-xs" title="Largeur">
            <option value="narrow">Étroit</option>
            <option value="medium">Moyen</option>
            <option value="wide">Large</option>
          </select>
          <div className="flex items-center gap-1 px-1" role="radiogroup" aria-label="Thème">
            {[
              ['auto', 'Auto', 'linear-gradient(135deg,#fff 50%,#1c1b22 50%)'],
              ['light', 'Clair', READER_THEMES.light.bg],
              ['sepia', 'Sépia', READER_THEMES.sepia.bg],
              ['dark', 'Sombre', READER_THEMES.dark.bg],
            ].map(([id, label, swatch]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={prefs.theme === id}
                title={label}
                onClick={() => setPref({ theme: id })}
                className={`h-6 w-6 rounded-full border ${prefs.theme === id ? 'border-accent-primary ring-2 ring-accent-primary/40' : 'border-border'}`}
                style={{ background: swatch }}
              />
            ))}
          </div>
          <button type="button" className={btn} onClick={speak} disabled={!article?.ok} title="Lire l’article à voix haute">
            {speaking ? <Square size={13} /> : <Volume2 size={14} />} {speaking ? 'Arrêter' : 'Écouter'}
          </button>
          <button type="button" className={btn} onClick={close} title="Quitter le mode lecture (Échap)">
            <X size={15} />
          </button>
        </div>
      </div>

      {article === null ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm" style={{ color: colors.muted }}>
          <Loader2 size={16} className="animate-spin" /> Préparation de l’article…
        </div>
      ) : !article.ok ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" style={{ color: colors.fg }}>
          <BookOpen size={32} style={{ color: colors.muted }} />
          <p className="max-w-md text-sm">
            Cette page ne contient pas d’article à mettre en forme : le mode lecture convient aux articles, billets de blog et
            pages de documentation, pas aux applications (messagerie, tableaux de bord…).
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={close}>
            Revenir à la page
          </button>
        </div>
      ) : (
        <iframe ref={frameRef} title={article.title || 'Article'} sandbox="allow-same-origin" className="w-full flex-1 border-0" />
      )}
    </div>
  );
}
