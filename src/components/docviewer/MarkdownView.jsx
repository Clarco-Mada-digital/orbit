import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import 'katex/dist/katex.min.css';
import { AlertTriangle, Check, ClipboardCopy, ImageOff, Image as ImageIcon, Info, Lightbulb, ListTree, Loader2, OctagonAlert, ShieldAlert } from 'lucide-react';
import {
  SANITIZE_SCHEMA,
  remarkAlerts,
  countRemoteImages,
  extractFrontMatter,
  linkKind,
  resolveAgainst,
} from '../../lib/markdownDoc';

// ---------------------------------------------------------------------------
// Rendu markdown de la visionneuse — qualité « GitHub ».
//
// Chaîne : remark-gfm (tableaux, cases, notes, barré, autoliens) → remark-math
// → rehype-raw (le HTML des README devient un ARBRE) → rehype-sanitize (schéma
// GitHub : scripts, styles, gestionnaires et protocoles dangereux retirés) →
// rehype-katex (formules) → rehype-highlight (coloration) → rehype-slug
// (ancres des titres). React construit les éléments : aucun innerHTML venu
// du document.
//
// Deux exceptions d'injection, chacune circonscrite :
//   • KaTeX : sa sortie est générée à partir du TeX, `trust: false` ;
//   • Mermaid : SVG produit par la bibliothèque en `securityLevel: 'strict'`
//     (elle nettoie elle-même ses libellés), à partir du code du diagramme.
//
// Images :
//   • locales (README ouvert depuis le disque) → lues par le processus
//     principal, images uniquement, rien ne quitte la machine ;
//   • distantes → NON chargées tant que l'utilisateur ne le demande pas
//     (bandeau) : une URL unique dans un document reçu suffirait à signaler
//     qu'on l'a ouvert. Le choix « toujours » est retenu sur cet appareil.
// ---------------------------------------------------------------------------
const REMOTE_IMAGES_KEY = 'orbit-doc-remote-images';
const readRemotePref = () => {
  try {
    return localStorage.getItem(REMOTE_IMAGES_KEY) === 'always';
  } catch {
    return false;
  }
};

function openExternally(href) {
  if (href) window.open(href, '_blank');
}

// --- Images -----------------------------------------------------------------
function DocImage({ src, alt, width, height, title, align, doc, allowRemote, onRequestRemote }) {
  const kind = linkKind(src);
  const remoteSrc = kind === 'web' ? src : kind === 'relative' && doc.url && !doc.filePath ? resolveAgainst(src, doc.url) : null;
  const [local, setLocal] = useState({ src: null, failed: false });
  const isLocal = kind === 'relative' && doc.filePath;

  useEffect(() => {
    if (!isLocal) return undefined;
    let alive = true;
    window.electronAPI?.documents
      ?.asset({ base: doc.filePath, src })
      .then((r) => alive && setLocal(r?.ok ? { src: r.dataUrl, failed: false } : { src: null, failed: true }))
      .catch(() => alive && setLocal({ src: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [isLocal, doc.filePath, src]);

  const common = {
    alt: alt || '',
    title: title || alt || undefined,
    width: width || undefined,
    height: height || undefined,
    align: align || undefined,
    loading: 'lazy',
    className: 'orbit-md-img',
  };

  if (isLocal) {
    if (local.src) return <img {...common} src={local.src} />;
    return (
      <span className="orbit-md-imgph" title={src}>
        {local.failed ? <ImageOff size={13} /> : <Loader2 size={13} className="animate-spin" />}
        {alt || src}
      </span>
    );
  }
  if (remoteSrc && allowRemote) {
    return <img {...common} src={remoteSrc} referrerPolicy="no-referrer" />;
  }
  if (remoteSrc) {
    return (
      <span role="button" tabIndex={0} className="orbit-md-imgph is-button" title={remoteSrc} onClick={onRequestRemote} onKeyDown={(e) => e.key === 'Enter' && onRequestRemote()}>
        <ImageIcon size={13} /> {alt || 'image distante'}
      </span>
    );
  }
  return (
    <span className="orbit-md-imgph" title={src}>
      <ImageOff size={13} /> {alt || src || 'image'}
    </span>
  );
}

// --- Blocs de code ------------------------------------------------------------
function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node.props) return textOf(node.props.children);
  return '';
}

let mermaidModule = null;
let mermaidSeq = 0;
function MermaidBlock({ code }) {
  const [state, setState] = useState({ svg: null, error: null });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!mermaidModule) {
          mermaidModule = (await import('mermaid')).default;
        }
        const light = document.documentElement.dataset.theme === 'light';
        mermaidModule.initialize({ startOnLoad: false, securityLevel: 'strict', theme: light ? 'default' : 'dark', fontFamily: 'inherit' });
        mermaidSeq += 1;
        const { svg } = await mermaidModule.render(`orbit-mermaid-${mermaidSeq}`, code);
        if (alive) setState({ svg, error: null });
      } catch (err) {
        if (alive) setState({ svg: null, error: String(err?.message || err).split('\n')[0] });
      }
    })();
    return () => {
      alive = false;
    };
  }, [code]);
  if (state.error) {
    return (
      <div className="orbit-md-mermaid-error">
        <div>Diagramme Mermaid illisible : {state.error}</div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  if (!state.svg) {
    return (
      <div className="orbit-md-mermaid is-loading">
        <Loader2 size={14} className="animate-spin" /> Diagramme…
      </div>
    );
  }
  // SVG produit par Mermaid en mode strict (voir l'en-tête du fichier).
  // argus-ignore SEC-DANGEROUS-HTML
  return <div className="orbit-md-mermaid" dangerouslySetInnerHTML={{ __html: state.svg }} />;
}

function CodeBlock({ children, ...props }) {
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const className = child?.props?.className || '';
  const lang = (/language-([\w+#.-]+)/.exec(className) || [])[1] || '';
  const raw = textOf(child?.props?.children).replace(/\n$/, '');
  if (lang === 'mermaid') return <MermaidBlock code={raw} />;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* presse-papiers indisponible */
    }
  };
  return (
    <div className="orbit-md-code">
      <div className="orbit-md-code-bar">
        <span>{lang}</span>
        <button type="button" onClick={copy} title="Copier">
          {copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}

// --- Alertes GitHub -----------------------------------------------------------
const ALERTS = {
  note: { label: 'Note', icon: Info },
  tip: { label: 'Astuce', icon: Lightbulb },
  important: { label: 'Important', icon: ShieldAlert },
  warning: { label: 'Attention', icon: AlertTriangle },
  caution: { label: 'Prudence', icon: OctagonAlert },
};

function Blockquote({ node: _node, className = '', children, ...props }) {
  const kind = (/markdown-alert-(\w+)/.exec(className) || [])[1];
  const alert = ALERTS[kind];
  if (!alert) return <blockquote className={className} {...props}>{children}</blockquote>;
  const Icon = alert.icon;
  return (
    <div className={`orbit-md-alert is-${kind}`}>
      <div className="orbit-md-alert-title">
        <Icon size={15} /> {alert.label}
      </div>
      {children}
    </div>
  );
}

// --- Vue ----------------------------------------------------------------------
export default function MarkdownView({ text, doc, showToc = true }) {
  const root = useRef(null);
  const [allowRemote, setAllowRemote] = useState(readRemotePref);
  const [toc, setToc] = useState([]);
  const [active, setActive] = useState(null);
  const [tocOpen, setTocOpen] = useState(true);
  const { data: frontMatter, body } = useMemo(() => extractFrontMatter(text), [text]);
  const remoteCount = useMemo(() => countRemoteImages(body), [body]);

  const scrollTo = useCallback((id) => {
    const el = root.current?.querySelector(`[id="${CSS.escape(id)}"]`) || root.current?.querySelector(`[id="user-content-${CSS.escape(id)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActive(id);
    }
  }, []);

  const onLink = useCallback(
    (href) => {
      const kind = linkKind(href);
      if (kind === 'anchor') return scrollTo(decodeURIComponent(href.slice(1)));
      if (kind === 'web') return openExternally(href);
      if (kind === 'relative') {
        if (doc.filePath) {
          window.electronAPI?.documents?.openRelative({ base: doc.filePath, href });
        } else {
          const abs = resolveAgainst(href, doc.url);
          if (abs) openExternally(abs);
        }
      }
      return undefined;
    },
    [doc.filePath, doc.url, scrollTo]
  );

  // Sommaire : lu dans le rendu lui-même (ids réels posés par rehype-slug).
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const t = setTimeout(() => {
      const items = [...el.querySelectorAll('h1[id],h2[id],h3[id],h4[id]')].map((h) => ({
        id: h.id,
        level: Number(h.tagName[1]),
        text: h.textContent || '',
      }));
      setToc(items);
    }, 0);
    return () => clearTimeout(t);
  }, [body]);

  // Section courante, suivie au défilement.
  useEffect(() => {
    const el = root.current;
    const scroller = el?.closest('[data-doc-scroll]');
    if (!el || !scroller || toc.length < 2) return undefined;
    const onScroll = () => {
      const top = scroller.getBoundingClientRect().top + 80;
      let current = toc[0]?.id;
      for (const item of toc) {
        const h = el.querySelector(`[id="${CSS.escape(item.id)}"]`);
        if (h && h.getBoundingClientRect().top <= top) current = item.id;
      }
      setActive(current);
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [toc]);

  const components = useMemo(
    () => ({
      a: ({ href, children, node: _node, ...rest }) => {
        const kind = linkKind(href);
        if (kind === 'blocked') return <span>{children}</span>;
        return (
          <a
            {...rest}
            href={href}
            title={kind === 'relative' ? `Ouvrir ${href}` : href}
            onClick={(e) => {
              e.preventDefault();
              onLink(href);
            }}
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt, width, height, title, align }) => (
        <DocImage
          src={src}
          alt={alt}
          width={width}
          height={height}
          title={title}
          align={align}
          doc={doc}
          allowRemote={allowRemote}
          onRequestRemote={() => setAllowRemote(true)}
        />
      ),
      pre: CodeBlock,
      blockquote: Blockquote,
      table: ({ node: _node, ...props }) => (
        <div className="orbit-md-table">
          <table {...props} />
        </div>
      ),
      // Case d'une liste de tâches (`- [x]`) : lecture seule, avec un nom
      // accessible — le lecteur d'écran annonce l'état, pas « case à cocher ».
      input: ({ node: _node, ...props }) => (
        <input {...props} disabled aria-label={props.checked ? 'Tâche faite' : 'Tâche à faire'} />
      ),
    }),
    [doc, allowRemote, onLink]
  );

  const showSidebar = showToc && tocOpen && toc.length >= 3;

  return (
    <div className="flex min-h-0 gap-6">
      {showSidebar ? (
        <nav className="sticky top-0 hidden max-h-[calc(100vh-9rem)] w-56 flex-shrink-0 self-start overflow-auto lg:block" aria-label="Sommaire">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            <span className="flex items-center gap-1.5">
              <ListTree size={12} /> Sommaire
            </span>
            <button className="hover:text-text-primary" onClick={() => setTocOpen(false)} title="Masquer le sommaire">
              ✕
            </button>
          </div>
          <ul className="space-y-0.5 border-l border-border">
            {toc.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => scrollTo(item.id)}
                  className={`-ml-px block w-full truncate border-l-2 py-0.5 pr-1 text-left text-xs transition-colors ${
                    active === item.id ? 'border-accent-primary text-accent-primary' : 'border-transparent text-text-muted hover:text-text-primary'
                  }`}
                  style={{ paddingLeft: `${(item.level - 1) * 10 + 10}px` }}
                  title={item.text}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <div className="min-w-0 max-w-4xl flex-1">
        {!showSidebar && showToc && toc.length >= 3 ? (
          <button className="mb-2 flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary" onClick={() => setTocOpen(true)}>
            <ListTree size={12} /> Afficher le sommaire
          </button>
        ) : null}

        {remoteCount > 0 && !allowRemote ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-secondary">
            <ImageIcon size={14} className="text-text-muted" />
            <span className="flex-1">
              {remoteCount} image{remoteCount > 1 ? 's' : ''} distante{remoteCount > 1 ? 's' : ''} non chargée{remoteCount > 1 ? 's' : ''} — leur serveur saurait que vous lisez ce document.
            </span>
            <button className="btn btn-secondary btn-sm" onClick={() => setAllowRemote(true)}>
              Afficher
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                try {
                  localStorage.setItem(REMOTE_IMAGES_KEY, 'always');
                } catch {
                  /* stockage indisponible : vaut pour ce document seulement */
                }
                setAllowRemote(true);
              }}
            >
              Toujours afficher
            </button>
          </div>
        ) : null}

        {frontMatter.length ? (
          <table className="mb-4 w-full overflow-hidden rounded-lg border border-border text-xs">
            <tbody>
              {frontMatter.map(([k, v]) => (
                <tr key={k} className="border-b border-border last:border-0">
                  <th className="w-40 bg-bg-elevated px-3 py-1.5 text-left font-medium text-text-muted">{k}</th>
                  <td className="px-3 py-1.5 text-text-secondary">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <article ref={root} className="orbit-md">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath, remarkAlerts]}
            rehypePlugins={[
              rehypeRaw,
              [rehypeSanitize, SANITIZE_SCHEMA],
              [rehypeKatex, { throwOnError: false, strict: false, trust: false }],
              [rehypeHighlight, { detect: false, ignoreMissing: true }],
              rehypeSlug,
            ]}
            components={components}
          >
            {body}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
