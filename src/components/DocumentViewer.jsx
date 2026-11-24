import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ClipboardCopy,
  Database,
  ExternalLink,
  FileWarning,
  FolderOpen,
  Globe,
  Loader2,
  RefreshCw,
  WrapText,
} from 'lucide-react';
import { appPartition } from '../lib/session';
import { KIND, languageLabel } from '../lib/fileTypes';
import { formatBytes, hasBinaryContent, parseDelimited, textStats } from '../lib/documents';
import { useStore } from '../stores/useStore';
import { openNativeApp } from '../lib/nativeApps';
import { useDevToolsStore } from '../lib/devToolsStore';

// Rendus riches chargés À LA DEMANDE : un .txt n'a pas à télécharger le moteur
// markdown, KaTeX, la coloration syntaxique ni l'explorateur JSON.
const MarkdownView = lazy(() => import('./docviewer/MarkdownView'));
const JsonExplorer = lazy(() => import('./docviewer/JsonExplorer'));
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
// SÛRETÉ DU RENDU : voir docviewer/MarkdownView.jsx — le HTML d'un README est
// analysé en arbre et NETTOYÉ (schéma GitHub) avant de devenir des éléments
// React ; aucun innerHTML venu du document. Les liens web partent dans le
// navigateur du système ; les images distantes attendent l'accord du lecteur.
// Le JSON est exploré, analysé et modifiable (docviewer/JsonExplorer.jsx).
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
  // Base SQLite : un fichier binaire, jamais lu comme du texte — l'app Base de
  // données s'en charge (voir DatabaseFile).
  if (app.kind === KIND.database) return { status: 'database' };
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
const Lazy = ({ children }) => (
  <Suspense
    fallback={
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 size={15} className="animate-spin" /> Mise en forme…
      </div>
    }
  >
    {children}
  </Suspense>
);

function DocumentBody({ kind, text, showSource, wrap, t, app }) {
  if (kind === KIND.markdown && !showSource) {
    return (
      <Lazy>
        <MarkdownView text={text} doc={app} />
      </Lazy>
    );
  }
  if (kind === KIND.csv && !showSource) return <CsvBody text={text} t={t} />;
  return <CodeBody text={text} wrap={wrap} />;
}

// Base SQLite ouverte depuis le système : on la confie à l'app Base de
// données, ou on dit quelle extension le permet.
function DatabaseFile({ app }) {
  const available = useStore((s) => Array.isArray(s.nativeApps) && s.nativeApps.includes('database'));
  const open = () => {
    useDevToolsStore.getState().openFile({ kind: 'sqlite', path: app.filePath, name: app.name });
    openNativeApp('database');
  };
  return (
    <div className="mx-auto mt-10 max-w-md space-y-3 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-primary/15">
        <Database size={22} className="text-accent-primary" />
      </div>
      <p className="text-sm font-medium text-text-primary">Base de données SQLite</p>
      {available && app.filePath ? (
        <>
          <p className="text-sm text-text-muted">Tables, données, requêtes SQL et diagramme des relations dans l’app Base de données.</p>
          <button className="btn btn-primary btn-sm" onClick={open}>
            <Database size={13} /> Ouvrir dans Base de données
          </button>
        </>
      ) : (
        <p className="text-sm text-text-muted">
          Installez l’extension <strong>Orbit Base de données</strong> (Réglages → Extensions) pour explorer cette base : tables, données, requêtes et diagramme des relations.
        </p>
      )}
    </div>
  );
}

// Un fichier qu'une app d'Orbit sait EXÉCUTER (.http → API, .sql → Base de
// données) : on le propose, ou on dit quelle extension l'ajoute.
const RUNNABLE = {
  http: { app: 'api', label: 'API', icon: Globe, verb: 'Exécuter ces requêtes dans l’app API', missing: 'Orbit API' },
  rest: { app: 'api', label: 'API', icon: Globe, verb: 'Exécuter ces requêtes dans l’app API', missing: 'Orbit API' },
  sql: { app: 'database', label: 'Base de données', icon: Database, verb: 'Ouvrir ce script dans l’app Base de données', missing: 'Orbit Base de données' },
};

function RunnableBanner({ app, text }) {
  const ext = String(app.name || app.url || '').toLowerCase().split('.').pop();
  const spec = RUNNABLE[ext];
  const available = useStore((s) => Array.isArray(s.nativeApps) && spec && s.nativeApps.includes(spec.app));
  if (!spec) return null;
  const Icon = spec.icon;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-secondary">
      <Icon size={14} className="text-accent-primary" />
      {available ? (
        <>
          <span className="flex-1">Ce fichier s’exécute dans l’app {spec.label}.</span>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              useDevToolsStore.getState().openFile({ kind: ext === 'sql' ? 'sql' : 'http', path: app.filePath || null, name: app.name, text });
              openNativeApp(spec.app);
            }}
          >
            {spec.verb}
          </button>
        </>
      ) : (
        <span className="flex-1">
          Installez l’extension <strong>{spec.missing}</strong> (Réglages → Extensions) pour exécuter ce fichier directement dans Orbit.
        </span>
      )}
    </div>
  );
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

      {/* JSON : l'explorateur occupe tout le corps (barres d'outils, arbre
          virtualisé, inspecteur) — il gère lui-même son défilement. */}
      {state.status === 'ready' && app.kind === KIND.json ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {state.truncated && (
            <p className="border-b border-border bg-bg-elevated px-3 py-2 text-xs text-text-muted">
              {t('doc.truncated', { size: formatBytes(4 * 1024 * 1024) })}
            </p>
          )}
          <Lazy>
            <JsonExplorer text={state.text} doc={app} wrap={wrap} />
          </Lazy>
        </div>
      ) : (
      <div className="flex-1 overflow-auto px-5 py-4 min-h-0" data-doc-scroll>
        {state.status === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 size={15} className="animate-spin" />
            {t('doc.loading')}
          </div>
        )}

        {state.status === 'database' && <DatabaseFile app={app} />}

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
            <RunnableBanner app={app} text={state.text} />
            <DocumentBody kind={app.kind} text={state.text} showSource={showSource} wrap={wrap} t={t} app={app} />
          </div>
        )}
      </div>
      )}
    </div>
  );
}
