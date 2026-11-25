// ---------------------------------------------------------------------------
// Mode lecture : extraction de l'article d'une page (Readability, la
// bibliothèque du mode lecture de Firefox) et préparation sûre de son HTML.
//
// L'extraction tourne DANS la page (webview.executeJavaScript) sur une COPIE
// du document : la page affichée n'est pas modifiée. Le HTML obtenu vient du
// site, donc il n'est jamais fait confiance : DOMPurify le nettoie, puis
// ReaderView l'affiche dans une iframe sans scripts.
// ---------------------------------------------------------------------------
import DOMPurify from 'dompurify';
import readabilitySource from '@mozilla/readability/Readability.js?raw';

// Plafond de ce qu'on rapatrie : un « article » de plusieurs Mo est une page
// d'application, pas un texte à lire.
export const MAX_ARTICLE_CHARS = 2_000_000;

export const READER_THEMES = {
  light: { bg: '#ffffff', fg: '#1f2328', muted: '#6b7280', link: '#2563eb', rule: '#e5e7eb' },
  sepia: { bg: '#f4ecd8', fg: '#5b4636', muted: '#8a7560', link: '#9a5b13', rule: '#e0d3b8' },
  dark: { bg: '#1c1b22', fg: '#e8e6e3', muted: '#9ca3af', link: '#8ab4f8', rule: '#33323a' },
};

export const READER_DEFAULTS = { theme: 'auto', fontSize: 19, font: 'serif', width: 'medium' };
export const READER_WIDTHS = { narrow: 560, medium: 680, wide: 840 };

export function extractionScript() {
  return `(() => {
    try {
      ${readabilitySource}
      const clone = document.cloneNode(true);
      const article = new Readability(clone, { charThreshold: 400 }).parse();
      if (!article || !article.content) return { ok: false, reason: 'no-article' };
      return {
        ok: true,
        title: String(article.title || document.title || ''),
        byline: String(article.byline || ''),
        siteName: String(article.siteName || location.hostname || ''),
        excerpt: String(article.excerpt || ''),
        lang: String(article.lang || document.documentElement.lang || ''),
        dir: String(article.dir || ''),
        publishedTime: String(article.publishedTime || ''),
        content: String(article.content).slice(0, ${MAX_ARTICLE_CHARS}),
        text: String(article.textContent || '').slice(0, ${MAX_ARTICLE_CHARS}),
        length: Number(article.length) || 0,
        url: location.href,
      };
    } catch (e) {
      return { ok: false, reason: 'error', message: String(e && e.message || e) };
    }
  })()`;
}

// Extrait l'article d'un <webview>. Renvoie { ok, ... } (jamais d'exception).
export async function extractArticle(webview) {
  if (!webview?.executeJavaScript) return { ok: false, reason: 'no-page' };
  try {
    const res = await webview.executeJavaScript(extractionScript());
    return res && typeof res === 'object' ? res : { ok: false, reason: 'error' };
  } catch (err) {
    return { ok: false, reason: 'error', message: String(err?.message || err) };
  }
}

const SAFE_URL = /^(?:https?:|mailto:|#)/i;
const SAFE_IMG = /^(?:https?:|data:image\/(?:png|jpe?g|gif|webp|avif);)/i;

// HTML de l'article → HTML sûr : ni script, ni style, ni formulaire, ni
// cadre, ni gestionnaire d'événement ; liens et images limités à http(s).
export function sanitizeArticle(html, baseUrl) {
  const purify = DOMPurify(window);
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.hasAttribute('href')) {
      let href = node.getAttribute('href') || '';
      try {
        href = new URL(href, baseUrl).href;
      } catch {
        href = '';
      }
      if (SAFE_URL.test(href)) node.setAttribute('href', href);
      else node.removeAttribute('href');
    }
    if (node.tagName === 'IMG') {
      let src = node.getAttribute('src') || '';
      try {
        src = new URL(src, baseUrl).href;
      } catch {
        src = '';
      }
      if (SAFE_IMG.test(src)) node.setAttribute('src', src);
      else node.remove();
      node.removeAttribute('srcset');
      node.setAttribute('loading', 'lazy');
      node.setAttribute('referrerpolicy', 'no-referrer');
    }
  });
  return purify.sanitize(String(html || ''), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'svg', 'math', 'video', 'audio', 'source'],
    FORBID_ATTR: ['style', 'class', 'id', 'srcset', 'sizes', 'width', 'height'],
    ALLOW_DATA_ATTR: false,
  });
}

export function resolveTheme(theme, prefersDark) {
  if (theme === 'light' || theme === 'sepia' || theme === 'dark') return theme;
  return prefersDark ? 'dark' : 'light';
}

// Feuille de style du document de lecture.
export function readerCss({ theme, fontSize, font, width }) {
  const c = READER_THEMES[theme] || READER_THEMES.light;
  const family =
    font === 'sans'
      ? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
      : 'Charter, "Bitstream Charter", "Iowan Old Style", Georgia, "Times New Roman", serif';
  const max = READER_WIDTHS[width] || READER_WIDTHS.medium;
  return `
    html { background: ${c.bg}; }
    body { margin: 0; padding: 48px 24px 120px; background: ${c.bg}; color: ${c.fg};
      font: ${Number(fontSize) || 19}px/1.65 ${family}; -webkit-font-smoothing: antialiased; }
    main { max-width: ${max}px; margin: 0 auto; overflow-wrap: anywhere; }
    header { margin-bottom: 2em; padding-bottom: 1.2em; border-bottom: 1px solid ${c.rule}; }
    .site { color: ${c.muted}; font: 600 0.75em/1.4 system-ui, sans-serif; text-transform: uppercase; letter-spacing: .06em; }
    h1.title { font-size: 1.9em; line-height: 1.2; margin: .35em 0 .4em; }
    .meta { color: ${c.muted}; font: 0.8em/1.5 system-ui, sans-serif; }
    h1, h2, h3, h4 { line-height: 1.3; margin: 1.6em 0 .5em; }
    p, ul, ol, blockquote, pre, table, figure { margin: 0 0 1.1em; }
    a { color: ${c.link}; }
    img { max-width: 100%; height: auto; border-radius: 6px; display: block; margin: 1.2em auto; }
    figcaption { color: ${c.muted}; font-size: .8em; text-align: center; }
    blockquote { margin-left: 0; padding-left: 1em; border-left: 3px solid ${c.rule}; color: ${c.muted}; }
    pre, code { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: .85em; }
    pre { overflow-x: auto; padding: 1em; background: ${c.rule}55; border-radius: 6px; }
    table { border-collapse: collapse; width: 100%; font-size: .9em; }
    td, th { border: 1px solid ${c.rule}; padding: .4em .6em; }
    hr { border: 0; border-top: 1px solid ${c.rule}; margin: 2em 0; }
    ::selection { background: ${c.link}44; }
  `;
}

// Durée de lecture estimée (230 mots par minute).
export function readingMinutes(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}
