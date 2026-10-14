import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  ExternalLink,
  FileWarning,
  FolderOpen,
  Loader2,
  RefreshCw,
  WrapText,
} from 'lucide-react';
import { appPartition } from '../lib/session';
import { KIND, languageLabel } from '../lib/fileTypes';
import { parseMarkdown, parseInline } from '../lib/markdown';
import {
  formatBytes,
  hasBinaryContent,
  parseDelimited,
  prettyJson,
  textStats,
} from '../lib/documents';
import { useT } from '../lib/i18n';

// ---------------------------------------------------------------------------
// Visionneuse de documents (pages volantes : .md, .txt, .json, .csv, code…).
//
// POURQUOI ELLE EXISTE
//
// Confier ces fichiers au <webview> ne marche pas : Chromium n'affiche que le
// HTML, les images, les médias, le PDF et le texte brut. Pour tout le reste il
// suit le `Content-Type` / `Content-Disposition` du serveur et, s'il ne sait
// pas le montrer, il déclenche un TÉLÉCHARGEMENT — le cadre reste alors BLANC.
// Un NAS qui sert un .md en `application/octet-stream` suffit à reproduire la
// panne, alors que le même .md servi en `text/markdown` s'affiche… en texte
// brut, sans mise en forme.
//
// Orbit lit donc le document lui-même (IPC `documents:read` pour un fichier
// local que l'utilisateur a ouvert, `documents:fetch` pour une adresse, via la
// session jetable de la page) et le met en forme ici — indépendamment de ce que
// le serveur annonce.
//
// SÛRETÉ DU RENDU : aucun HTML n'est injecté. Le markdown devient des
// structures de données (lib/markdown.js) rendues en JSX, donc échappées par
// React. Les liens partent dans le navigateur du système (jamais dans cette
// fenêtre) et les images distantes ne sont pas chargées : un document reçu ne
// peut ni exécuter de code ni signaler sa lecture.
// ---------------------------------------------------------------------------

// Ouvrir un lien du document dans le NAVIGATEUR : `window.open` est redirigé
// vers le navigateur système par le processus principal, comme pour les apps.
function openExternally(href) {
  if (!href) return;
  window.open(href, '_blank');
}

// Lit le document et renvoie le PROCHAIN état (aucun setState ici : l'appelant
// décide quand publier, ce qui évite les mises à jour pendant le rendu et les
// réponses arrivées après le démontage).
async function readDocument(app) {
  const api = window.electronAPI?.documents;
  if (!api) return { status: 'error', reason: 'no-bridge' };
  let res;
  try {
    res = app.filePath
      ? await api.read({ path: app.filePath })
      : await api.fetch({ url: app.url, partition: appPartition(app, false) });
  } catch {
    res = { ok: false, reason: 'network' };
  }
  if (!res?.ok) {
    const reason = hasBinaryContent(res?.text) ? 'binary' : res?.reason || 'generic';
    return { status: 'error', reason, status_code: res?.status };
  }
  return {
    status: 'ready',
    text: res.text,
    bytes: res.bytes,
    truncated: res.truncated,
  };
}

function DocumentLink({ href, children }) {
  if (!href) return <span>{children}</span>; // lien neutralisé : texte simple
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        openExternally(href);
      }}
      className="text-accent-primary underline decoration-dotted underline-offset-2 hover:text-accent-hover break-all"
    >
      {children}
    </a>
  );
}

// --- Rendu inline (markdown) ----------------------------------------------
function Inline({ nodes }) {
  return (nodes || []).map((node, i) => {
    const key = `${node.type}-${i}`;
    if (node.type === 'text') return <span key={key}>{node.text}</span>;
    if (node.type === 'code')
      return (
        <code key={key} className="px-1 py-0.5 rounded bg-bg-hover font-mono text-[0.85em]">
          {node.text}
        </code>
      );
    if (node.type === 'strong')
      return (
        <strong key={key} className="font-semibold text-text-primary">
          <Inline nodes={node.children} />
        </strong>
      );
    if (node.type === 'em')
      return (
        <em key={key}>
          <Inline nodes={node.children} />
        </em>
      );
    if (node.type === 'del')
      return (
        <del key={key} className="text-text-muted">
          <Inline nodes={node.children} />
        </del>
      );
    if (node.type === 'link')
      return (
        <DocumentLink key={key} href={node.href}>
          {node.text}
        </DocumentLink>
      );
    if (node.type === 'image')
      return (
        <span
          key={key}
          role="button"
          tabIndex={0}
          onClick={() => openExternally(node.href)}
          title={node.href || ''}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-bg-elevated text-xs text-text-muted cursor-pointer hover:text-text-secondary"
        >
          🖼 {node.alt}
        </span>
      );
    return <span key={key}>{node.text}</span>;
  });
}

function Heading({ level, children }) {
  const sizes = [
    'text-2xl font-bold',
    'text-xl font-bold',
    'text-lg font-semibold',
    'text-base font-semibold',
    'text-sm font-semibold uppercase tracking-wide',
    'text-sm font-semibold text-text-muted',
  ];
  const cls = sizes[Math.min(level, 6) - 1] || sizes[5];
  // h1 du document → h2 dans l'interface : la page a déjà son propre titre.
  const Tag = `h${Math.min(level + 1, 6)}`;
  return <Tag className={`${cls} text-text-primary mt-2`}>{children}</Tag>;
}

function ListItem({ item }) {
  if (item.checked !== null && item.checked !== undefined) {
    return (
      <li className="flex items-start gap-2 list-none -ml-6">
        <span className="mt-0.5 w-4 h-4 rounded border border-border flex items-center justify-center flex-shrink-0 bg-bg-elevated">
          {item.checked ? <Check size={11} className="text-accent-primary" /> : null}
        </span>
        <span>
          <Inline nodes={parseInline(item.text)} />
          {item.children?.length ? <NestedLists items={item.children} /> : null}
        </span>
      </li>
    );
  }
  return (
    <li>
      <Inline nodes={parseInline(item.text)} />
      {item.children?.length ? <NestedLists items={item.children} /> : null}
    </li>
  );
}

function NestedLists({ items }) {
  return (
    <div className="mt-1 space-y-1">
      {items.map((child, i) => (
        <MarkdownBlock key={`nested-${i}`} block={child} keyPrefix={`nested-${i}-`} />
      ))}
    </div>
  );
}

function MarkdownBlock({ block, keyPrefix = '' }) {
  const key = `${keyPrefix}${block.type}`;
  switch (block.type) {
    case 'heading':
      return (
        <Heading key={key} level={block.level}>
          <Inline nodes={parseInline(block.text)} />
        </Heading>
      );
    case 'paragraph':
      return (
        <p key={key} className="text-text-secondary leading-relaxed">
          <Inline nodes={parseInline(block.text)} />
        </p>
      );
    case 'code':
      return (
        <pre
          key={key}
          className="rounded-lg border border-border bg-bg-elevated p-3 overflow-x-auto text-xs font-mono text-text-secondary"
        >
          <code>{block.text}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote
          key={key}
          className="border-l-2 border-accent-primary/50 pl-3 text-text-muted italic"
        >
          {(block.blocks || []).map((b, i) => (
            <MarkdownBlock key={`${key}-${i}`} block={b} keyPrefix={`${key}-${i}-`} />
          ))}
        </blockquote>
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List
          key={key}
          start={block.ordered ? block.start || 1 : undefined}
          className={`${block.ordered ? 'list-decimal' : 'list-disc'} pl-6 space-y-1 text-text-secondary`}
        >
          {(block.items || []).map((item, i) => (
            <ListItem key={`${key}-${i}`} item={item} />
          ))}
        </List>
      );
    }
    case 'table':
      return (
        <div key={key} className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-bg-elevated">
              <tr>
                {(block.header || []).map((cell, i) => (
                  <th
                    key={`${key}-h-${i}`}
                    className="px-2.5 py-1.5 text-left font-semibold text-text-primary whitespace-nowrap"
                  >
                    <Inline nodes={parseInline(cell)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(block.rows || []).map((row, r) => (
                <tr key={`${key}-r-${r}`} className="border-t border-border">
                  {row.map((cell, c) => (
                    <td key={`${key}-r-${r}-${c}`} className="px-2.5 py-1.5 text-text-secondary">
                      <Inline nodes={parseInline(cell)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'hr':
      return <hr key={key} className="border-border" />;
    default:
      return null;
  }
}

// --- Code / texte : numéros de ligne --------------------------------------
function CodeBody({ text, wrap }) {
  const lines = useMemo(() => String(text || '').split('\n'), [text]);
  return (
    <table className="w-full border-collapse font-mono text-xs leading-5">
      <tbody>
        {lines.map((line, i) => (
          <tr key={i}>
            <td className="w-10 pr-3 text-right align-top select-none text-text-muted/60 tabular-nums">
              {i + 1}
            </td>
            <td
              className={`align-top text-text-secondary ${
                wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
              }`}
            >
              {line || ' '}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- CSV / TSV -------------------------------------------------------------
function CsvBody({ text, t }) {
  const { rows, columns, truncated } = useMemo(() => parseDelimited(text), [text]);
  if (!rows.length) return null;
  const [header, ...body] = rows;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="text-xs">
          <thead className="bg-bg-elevated">
            <tr>
              {header.map((cell, i) => (
                <th
                  key={i}
                  className="px-2.5 py-1.5 text-left font-semibold text-text-primary whitespace-nowrap border-r border-border last:border-r-0"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="border-t border-border hover:bg-bg-hover/60">
                {Array.from({ length: columns }, (_, c) => (
                  <td
                    key={c}
                    className="px-2.5 py-1.5 text-text-secondary whitespace-nowrap border-r border-border last:border-r-0"
                  >
                    {row[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <p className="text-xs text-text-muted">{t('doc.csvLimit', { count: body.length })}</p>
      )}
    </div>
  );
}

// --- Corps du document -----------------------------------------------------
function DocumentBody({ kind, text, showSource, wrap, jsonResult, t }) {
  if (kind === KIND.markdown && !showSource) {
    const blocks = parseMarkdown(text);
    return (
      <article className="max-w-3xl space-y-3">
        {blocks.map((block, i) => (
          <MarkdownBlock key={i} block={block} keyPrefix={`b${i}-`} />
        ))}
      </article>
    );
  }
  if (kind === KIND.json && !showSource) {
    if (jsonResult.ok) return <CodeBody text={jsonResult.text} wrap={wrap} />;
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{t('doc.jsonError', { error: jsonResult.error })}</span>
        </div>
        <CodeBody text={text} wrap={wrap} />
      </div>
    );
  }
  if (kind === KIND.csv && !showSource) return <CsvBody text={text} t={t} />;
  return <CodeBody text={text} wrap={wrap} />;
}

// Message d'erreur : la cause exacte du refus, jamais un texte générique muet.
const ERROR_KEYS = new Set([
  'no-bridge',
  'not-allowed',
  'binary',
  'missing',
  'not-a-file',
  'bad-path',
  'bad-url',
  'bad-partition',
  'network',
  'timeout',
  'http',
  'read-failed',
  'generic',
]);

export default function DocumentViewer({ app, visible = true, flexLayout = false }) {
  const t = useT();
  const [state, setState] = useState({ status: 'loading' });
  const [showSource, setShowSource] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);

  // Chargement initial et à chaque changement de document. Le setState est
  // dans le callback de la promesse : rien n'est publié pendant le rendu, et
  // une réponse arrivée après le démontage est ignorée.
  useEffect(() => {
    let cancelled = false;
    readDocument(app).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [app]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    readDocument(app).then(setState);
  }, [app]);

  const jsonResult = useMemo(
    () =>
      state.status === 'ready' && app.kind === KIND.json
        ? prettyJson(state.text)
        : { ok: false, text: '', error: '' },
    [app.kind, state.status, state.text]
  );

  const stats = useMemo(
    () => (state.status === 'ready' ? textStats(state.text) : { lines: 0, words: 0, chars: 0 }),
    [state.status, state.text]
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.text || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* presse-papier indisponible : on ne signale rien de plus */
    }
  };

  const canToggleSource = app.kind === KIND.markdown || app.kind === KIND.csv;
  const formatLabel = languageLabel(app.url) || languageLabel(app.name);

  return (
    <div
      // Même logique de masquage que <WebView> : un document non affiché reste
      // MONTÉ mais invisible (on garde la position de défilement du lecteur),
      // et en écran partagé il remplit sa cellule. Sans ça, toutes les pages
      // volantes de documents s'empileraient au même endroit.
      style={{
        position: visible ? 'relative' : 'absolute',
        inset: visible ? undefined : 0,
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: visible ? 'auto' : 'none',
        zIndex: visible ? 1 : 0,
        ...(visible && flexLayout ? { width: '100%', height: '100%' } : {}),
      }}
      className="w-full h-full flex flex-col min-w-0 min-h-0 bg-bg-secondary"
      // Repères stables (nature + nom du document) : sans effet sur le rendu,
      // ils permettent de vérifier ce qui est réellement affiché.
      data-document={app.kind}
      data-document-name={app.name}
      data-document-status={state.status}
    >
      {/* En-tête : quel document, quel poids, et les actions utiles */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-elevated flex-shrink-0">
        <span className="text-base leading-none flex-shrink-0">{app.icon}</span>
        <span className="font-medium text-sm truncate">{app.name}</span>
        {formatLabel && (
          <span className="px-1.5 py-0.5 rounded border border-border text-[10px] uppercase tracking-wide text-text-muted flex-shrink-0">
            {formatLabel}
          </span>
        )}
        {state.status === 'ready' && (
          <span className="text-[11px] text-text-muted flex-shrink-0 tabular-nums">
            {formatBytes(state.bytes)} · {stats.lines} {t('doc.lines')}
          </span>
        )}
        <div className="flex-1" />
        {state.status === 'ready' && canToggleSource && (
          <button
            onClick={() => setShowSource((v) => !v)}
            className="btn btn-ghost btn-sm"
            title={showSource ? t('doc.rendered') : t('doc.source')}
          >
            {showSource ? t('doc.rendered') : t('doc.source')}
          </button>
        )}
        {state.status === 'ready' && (
          <>
            <button
              onClick={() => setWrap((v) => !v)}
              className={`btn-icon w-7 h-7 ${wrap ? 'text-accent-primary' : 'text-text-muted'}`}
              title={t('doc.wrap')}
            >
              <WrapText size={14} />
            </button>
            <button onClick={copy} className="btn-icon w-7 h-7" title={t('doc.copy')}>
              {copied ? <Check size={14} className="text-success" /> : <ClipboardCopy size={14} />}
            </button>
          </>
        )}
        {app.filePath && (
          <button
            onClick={() => window.electronAPI?.documents?.reveal?.({ path: app.filePath })}
            className="btn-icon w-7 h-7"
            title={t('doc.reveal')}
          >
            <FolderOpen size={14} />
          </button>
        )}
        <button
          onClick={() => openExternally(app.url)}
          className="btn-icon w-7 h-7"
          title={t('doc.browser')}
        >
          <ExternalLink size={14} />
        </button>
        <button onClick={reload} className="btn-icon w-7 h-7" title={t('doc.reload')}>
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Corps */}
      <div className="flex-1 overflow-auto px-5 py-4 min-h-0">
        {state.status === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 size={15} className="animate-spin" />
            {t('doc.loading')}
          </div>
        )}

        {state.status === 'error' && (
          <div className="max-w-md mx-auto mt-10 text-center space-y-3">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-warning/15 flex items-center justify-center">
              <FileWarning size={22} className="text-warning" />
            </div>
            <p className="text-sm text-text-secondary">
              {t(ERROR_KEYS.has(state.reason) ? `doc.err.${state.reason}` : 'doc.err.generic', {
                status: state.status_code,
              })}
            </p>
            <div className="flex items-center justify-center gap-2">
              <button onClick={reload} className="btn btn-secondary btn-sm">
                <RefreshCw size={13} /> {t('doc.retry')}
              </button>
              <button onClick={() => openExternally(app.url)} className="btn btn-primary btn-sm">
                <ExternalLink size={13} /> {t('doc.browser')}
              </button>
            </div>
          </div>
        )}

        {state.status === 'ready' && (
          <div className="space-y-3">
            {state.truncated && (
              <p className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-muted">
                {t('doc.truncated', { size: formatBytes(4 * 1024 * 1024) })}
              </p>
            )}
            <DocumentBody
              kind={app.kind}
              text={state.text}
              showSource={showSource}
              wrap={wrap}
              jsonResult={jsonResult}
              t={t}
            />
          </div>
        )}
      </div>
    </div>
  );
}
