import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  FileCode2,
  FolderOpen,
  FolderPlus,
  Globe,
  Import,
  Loader2,
  Plus,
  Save,
  Send,
  Settings2,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import CodeEditor from './CodeEditor';
import Modal from './Modal';
import {
  METHODS,
  buildFinalRequest,
  emptyRequest,
  formatBytes,
  importAny,
  joinUrlParams,
  newId,
  parseCurl,
  parseHttpFile,
  prettyBody,
  splitUrlParams,
  toCurl,
  toHttpFile,
  unresolvedVariables,
} from '../../lib/httpRequests';
import { useApiStore, useDevToolsStore } from '../../lib/devToolsStore';

// ---------------------------------------------------------------------------
// API — app native d'Orbit (extension « Orbit API »).
//
// Deux façons de travailler, comme on le fait dans VS Code ou Postman :
//   • requêtes en formulaire, rangées dans des collections, avec
//     environnements ({{baseUrl}}, {{token}}…) et historique ;
//   • fichiers .http / .rest (format REST Client) : un ▶ par requête dans la
//     marge, variables @x = …, réponses nommées réutilisables.
// Import : cURL (« Copier en cURL » des outils de développement), .http,
// OpenAPI/Swagger JSON, collections Postman.
// ---------------------------------------------------------------------------
const METHOD_COLORS = {
  GET: 'text-emerald-500',
  POST: 'text-amber-500',
  PUT: 'text-sky-500',
  PATCH: 'text-violet-500',
  DELETE: 'text-red-500',
  HEAD: 'text-text-muted',
  OPTIONS: 'text-text-muted',
};

function statusColor(status) {
  if (status >= 500) return 'bg-red-500/15 text-red-500';
  if (status >= 400) return 'bg-amber-500/15 text-amber-500';
  if (status >= 300) return 'bg-sky-500/15 text-sky-500';
  return 'bg-emerald-500/15 text-emerald-500';
}

const HTTP_TEMPLATE = `@baseUrl = https://jsonplaceholder.typicode.com

### Liste des articles
# @name posts
GET {{baseUrl}}/posts?_limit=3
Accept: application/json

### Détail du premier (réutilise la réponse « posts »)
GET {{baseUrl}}/posts/{{posts.response.body.$[0].id}}

### Création
POST {{baseUrl}}/posts
Content-Type: application/json

{
  "title": "Bonjour depuis Orbit",
  "body": "Envoyé le {{$datetime iso8601}}",
  "userId": {{$randomInt 1 10}}
}
`;

// ---------------------------------------------------------------------------
// Tableau clé / valeur (paramètres, en-têtes, formulaires)
// ---------------------------------------------------------------------------
function KeyValueTable({ rows, onChange, allowFiles = false, keyPlaceholder = 'Clé', valuePlaceholder = 'Valeur' }) {
  const list = [...(rows || []), { key: '', value: '', enabled: true, _new: true }];
  const update = (i, patch) => {
    const next = list.map((r, j) => (j === i ? { ...r, ...patch } : r)).filter((r) => !r._new || r.key || r.value);
    onChange(next.map(({ _new, ...r }) => r));
  };
  const remove = (i) => onChange(list.filter((r, j) => j !== i && !r._new).map(({ _new, ...r }) => r));
  const pickFile = async (i) => {
    const res = await window.electronAPI?.devFiles?.pick({ title: 'Fichier à envoyer' });
    if (res?.success) update(i, { value: res.path, type: 'file' });
  };
  return (
    <table className="w-full text-xs">
      <tbody>
        {list.map((r, i) => (
          <tr key={i} className="group">
            <td className="w-6 py-0.5">
              {!r._new ? <input type="checkbox" checked={r.enabled !== false} onChange={(e) => update(i, { enabled: e.target.checked })} /> : null}
            </td>
            <td className="py-0.5 pr-1">
              <input className="input w-full px-2 py-1 font-mono text-xs" placeholder={keyPlaceholder} value={r.key} onChange={(e) => update(i, { key: e.target.value })} />
            </td>
            <td className="py-0.5 pr-1">
              <div className="flex gap-1">
                {allowFiles && !r._new ? (
                  <select className="input w-20 px-1 py-1 text-xs" value={r.type || 'text'} onChange={(e) => update(i, { type: e.target.value, value: '' })}>
                    <option value="text">Texte</option>
                    <option value="file">Fichier</option>
                  </select>
                ) : null}
                {r.type === 'file' ? (
                  <button className="input flex-1 truncate px-2 py-1 text-left text-xs" onClick={() => pickFile(i)}>
                    {r.value || 'Choisir un fichier…'}
                  </button>
                ) : (
                  <input className="input w-full px-2 py-1 font-mono text-xs" placeholder={valuePlaceholder} value={r.value} onChange={(e) => update(i, { value: e.target.value })} />
                )}
              </div>
            </td>
            <td className="w-6">
              {!r._new ? (
                <button className="btn-icon h-6 w-6 opacity-0 hover:text-error group-hover:opacity-100" onClick={() => remove(i)}>
                  <X size={12} />
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Réponse
// ---------------------------------------------------------------------------
function ResponseView({ res, final }) {
  const [view, setView] = useState('body');
  const [raw, setRaw] = useState(false);
  if (!res) return <div className="flex flex-1 items-center justify-center text-sm text-text-muted">Envoyez la requête pour voir la réponse (Ctrl+Entrée).</div>;
  if (res.loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-text-muted">
        <Loader2 size={16} className="animate-spin" /> Envoi…
      </div>
    );
  }
  if (!res.success) {
    return (
      <div className="m-3 rounded-lg border border-error/40 bg-error/10 p-3 text-sm text-error">
        <div className="font-semibold">La requête n’a pas abouti</div>
        <div className="mt-1 break-words font-mono text-xs">{res.error}</div>
        {final ? <div className="mt-2 break-all font-mono text-[11px] text-text-muted">{final.method} {final.url}</div> : null}
      </div>
    );
  }
  const isImage = /^image\//i.test(res.contentType) && res.base64;
  const isHtml = /html/i.test(res.contentType);
  const body = raw ? res.text : prettyBody(res.text, res.contentType);
  const saveBody = () =>
    window.electronAPI?.devFiles?.save({ defaultPath: /json/.test(res.contentType) ? 'reponse.json' : 'reponse.txt', content: res.text ?? '' });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <span className={`rounded px-2 py-0.5 font-semibold ${statusColor(res.status)}`}>
          {res.status} {res.statusText}
        </span>
        <span className="text-text-muted" title={`Premier octet : ${res.timing.firstByte} ms · téléchargement : ${res.timing.download} ms`}>
          {res.timing.total} ms
        </span>
        <span className="text-text-muted">{formatBytes(res.size)}</span>
        {res.redirected ? <span className="truncate text-text-muted" title={res.url}>→ redirigé</span> : null}
        <div className="ml-auto flex items-center gap-1">
          {['body', 'headers', 'curl'].map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded px-2 py-0.5 ${view === v ? 'bg-bg-hover font-medium' : 'text-text-muted hover:bg-bg-hover'}`}>
              {{ body: 'Corps', headers: `En-têtes (${res.headers.length})`, curl: 'cURL' }[v]}
            </button>
          ))}
        </div>
      </div>
      {view === 'body' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {res.text !== null ? (
            <div className="flex items-center gap-2 px-3 py-1 text-[11px] text-text-muted">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> Brut
              </label>
              {res.truncated ? <span className="text-amber-500">Réponse tronquée à 20 Mo</span> : null}
              <button className="ml-auto hover:text-text-primary" onClick={() => navigator.clipboard?.writeText(res.text || '')}>
                Copier
              </button>
              <button className="hover:text-text-primary" onClick={saveBody}>
                Enregistrer
              </button>
            </div>
          ) : null}
          {isImage ? (
            <div className="flex flex-1 items-center justify-center overflow-auto p-3">
              <img src={`data:${res.contentType.split(';')[0]};base64,${res.base64}`} alt="" className="max-h-full max-w-full" />
            </div>
          ) : res.text === null ? (
            <div className="p-3 text-sm text-text-muted">Contenu binaire ({res.contentType || 'type inconnu'}, {formatBytes(res.size)}).</div>
          ) : isHtml && !raw ? (
            <iframe title="Aperçu" sandbox="" srcDoc={res.text} className="min-h-0 flex-1 bg-white" />
          ) : (
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all px-3 pb-3 font-mono text-xs select-text">{body}</pre>
          )}
        </div>
      ) : null}
      {view === 'headers' ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <table className="w-full font-mono text-xs">
            <tbody>
              {res.headers.map(([k, v], i) => (
                <tr key={i} className="border-b border-border align-top">
                  <td className="py-1 pr-3 font-semibold">{k}</td>
                  <td className="break-all py-1 select-text">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {view === 'curl' && final ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <pre className="whitespace-pre-wrap break-all rounded-lg bg-bg-secondary p-3 font-mono text-xs select-text">{toCurl(final)}</pre>
          <button className="btn btn-secondary btn-sm mt-2" onClick={() => navigator.clipboard?.writeText(toCurl(final))}>
            Copier la commande
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Envoi (partagé entre formulaire et fichier .http)
// ---------------------------------------------------------------------------
function useSender() {
  const pushHistory = useApiStore((s) => s.pushHistory);
  const setNamedResponse = useApiStore((s) => s.setNamedResponse);
  const current = useRef(null);
  return useMemo(
    () => ({
      async send(request, vars, onResult) {
        const responses = useApiStore.getState().namedResponses;
        const final = buildFinalRequest(request, { vars, responses });
        const id = newId('x');
        current.current = id;
        onResult({ loading: true }, final);
        const res = await window.electronAPI?.apiClient?.send({ id, ...final, timeoutMs: 60000 });
        onResult(res || { success: false, error: 'Pas de réponse' }, final);
        pushHistory({
          request: { ...request, id: newId() },
          status: res?.status,
          ms: res?.timing?.total,
          error: res?.success ? undefined : res?.error,
        });
        if (request.requestName && res?.success) {
          setNamedResponse(request.requestName, {
            request: { body: final.body?.text || '', headers: final.headers },
            response: { body: res.text || '', headers: res.headers, status: res.status },
          });
        }
        return res;
      },
      cancel() {
        if (current.current) window.electronAPI?.apiClient?.cancel(current.current);
      },
    }),
    [pushHistory, setNamedResponse]
  );
}

// ---------------------------------------------------------------------------
// Onglet requête (formulaire)
// ---------------------------------------------------------------------------
function RequestTab({ tab, vars, onChange, onSave }) {
  const req = tab.request;
  const [section, setSection] = useState('params');
  const [res, setRes] = useState(tab.lastResponse || null);
  const [final, setFinal] = useState(null);
  const sender = useSender();
  const set = (patch) => onChange({ request: { ...req, ...patch }, dirty: true });
  const { base, params } = splitUrlParams(req.url);
  const missing = useMemo(() => {
    const text = [req.url, ...(req.headers || []).map((h) => h.value), req.body?.text, req.auth?.token].join(' ');
    return [...new Set(unresolvedVariables(text))].filter((v) => !v.startsWith('$') && !(v in vars) && !/\.response\./.test(v));
  }, [req, vars]);

  const send = () =>
    sender.send(req, vars, (r, f) => {
      setRes(r);
      setFinal(f);
    });

  const onUrlPaste = (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (/^\s*curl\s/i.test(text)) {
      e.preventDefault();
      try {
        const parsed = parseCurl(text);
        onChange({ request: { ...parsed, id: req.id }, title: parsed.name, dirty: true });
      } catch {
        /* collé tel quel */
      }
    }
  };

  const body = req.body || { kind: 'none' };
  const auth = req.auth || { type: 'none' };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <select className={`input w-28 py-1.5 font-mono text-sm font-semibold ${METHOD_COLORS[req.method] || ''}`} value={req.method} onChange={(e) => set({ method: e.target.value })}>
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          className="input min-w-0 flex-1 py-1.5 font-mono text-sm"
          value={req.url}
          onChange={(e) => set({ url: e.target.value })}
          onPaste={onUrlPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder="https://api.exemple.com/v1/ressource   — ou collez une commande cURL"
        />
        {res?.loading ? (
          <button className="btn btn-secondary btn-sm flex items-center gap-1.5" onClick={() => sender.cancel()}>
            <Square size={13} /> Annuler
          </button>
        ) : (
          <button className="btn btn-primary btn-sm flex items-center gap-1.5" onClick={send}>
            <Send size={13} /> Envoyer
          </button>
        )}
        <button className="btn-icon" onClick={onSave} title="Enregistrer dans une collection">
          <Save size={15} className={tab.dirty ? 'text-accent-primary' : ''} />
        </button>
        <button className="btn-icon" title="Copier en cURL" onClick={() => navigator.clipboard?.writeText(toCurl(buildFinalRequest(req, { vars, responses: useApiStore.getState().namedResponses })))}>
          <Clipboard size={15} />
        </button>
      </div>
      {missing.length ? (
        <div className="border-b border-border bg-amber-500/10 px-3 py-1 text-[11px] text-amber-600">
          Variables non définies : {missing.map((m) => `{{${m}}}`).join(', ')} — définissez-les dans l’environnement ou la collection.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 flex-col border-border lg:w-1/2 lg:border-r" style={{ minHeight: 180 }}>
          <div className="flex gap-1 border-b border-border px-3 pt-2 text-sm">
            {[
              ['params', `Paramètres${params.length ? ` (${params.length})` : ''}`],
              ['headers', `En-têtes${req.headers?.length ? ` (${req.headers.length})` : ''}`],
              ['body', 'Corps'],
              ['auth', 'Auth'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setSection(id)} className={`-mb-px border-b-2 px-2 py-1 ${section === id ? 'border-accent-primary font-medium' : 'border-transparent text-text-muted'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {section === 'params' ? <KeyValueTable rows={params} onChange={(next) => set({ url: joinUrlParams(base, next) })} /> : null}
            {section === 'headers' ? <KeyValueTable rows={req.headers} onChange={(headers) => set({ headers })} keyPlaceholder="En-tête" /> : null}
            {section === 'body' ? (
              <div className="flex h-full min-h-0 flex-col gap-2">
                <div className="flex flex-wrap gap-1 text-xs">
                  {[
                    ['none', 'Aucun'],
                    ['json', 'JSON'],
                    ['text', 'Texte'],
                    ['xml', 'XML'],
                    ['form', 'Formulaire'],
                    ['multipart', 'Multipart'],
                    ['graphql', 'GraphQL'],
                    ['binary', 'Fichier'],
                  ].map(([k, label]) => (
                    <button key={k} onClick={() => set({ body: { ...body, kind: k } })} className={`rounded px-2 py-0.5 ${body.kind === k ? 'bg-accent-primary/15 font-medium text-accent-primary' : 'text-text-muted hover:bg-bg-hover'}`}>
                      {label}
                    </button>
                  ))}
                  {body.kind === 'json' ? (
                    <button
                      className="ml-auto rounded px-2 py-0.5 text-text-muted hover:bg-bg-hover"
                      onClick={() => {
                        try {
                          set({ body: { ...body, text: JSON.stringify(JSON.parse(body.text || ''), null, 2) } });
                        } catch {
                          /* JSON invalide : on laisse tel quel */
                        }
                      }}
                    >
                      Formater
                    </button>
                  ) : null}
                </div>
                {['json', 'text', 'xml'].includes(body.kind) ? (
                  <CodeEditor value={body.text || ''} onChange={(text) => set({ body: { ...body, text } })} onRun={send} className="flex-1" />
                ) : null}
                {body.kind === 'graphql' ? (
                  <>
                    <CodeEditor value={body.text || ''} onChange={(text) => set({ body: { ...body, text } })} onRun={send} placeholder="query { ... }" className="flex-1" />
                    <span className="text-xs text-text-muted">Variables (JSON)</span>
                    <CodeEditor value={body.variables || ''} onChange={(variables) => set({ body: { ...body, variables } })} minHeight={70} />
                  </>
                ) : null}
                {body.kind === 'form' || body.kind === 'multipart' ? (
                  <KeyValueTable rows={body.fields} allowFiles={body.kind === 'multipart'} onChange={(fields) => set({ body: { ...body, fields } })} />
                ) : null}
                {body.kind === 'binary' ? (
                  <button
                    className="btn btn-secondary btn-sm self-start"
                    onClick={async () => {
                      const r = await window.electronAPI?.devFiles?.pick({ title: 'Fichier à envoyer' });
                      if (r?.success) set({ body: { ...body, file: r.path } });
                    }}
                  >
                    {body.file || 'Choisir un fichier…'}
                  </button>
                ) : null}
              </div>
            ) : null}
            {section === 'auth' ? (
              <div className="max-w-md space-y-2 text-sm">
                <select className="input w-full" value={auth.type} onChange={(e) => set({ auth: { type: e.target.value } })}>
                  <option value="none">Aucune</option>
                  <option value="bearer">Bearer token</option>
                  <option value="basic">Basic (utilisateur / mot de passe)</option>
                  <option value="apikey">Clé d’API</option>
                </select>
                {auth.type === 'bearer' ? <input className="input w-full font-mono text-xs" placeholder="{{token}}" value={auth.token || ''} onChange={(e) => set({ auth: { ...auth, token: e.target.value } })} /> : null}
                {auth.type === 'basic' ? (
                  <>
                    <input className="input w-full" placeholder="Utilisateur" value={auth.username || ''} onChange={(e) => set({ auth: { ...auth, username: e.target.value } })} />
                    <input className="input w-full" type="password" placeholder="Mot de passe" value={auth.password || ''} onChange={(e) => set({ auth: { ...auth, password: e.target.value } })} />
                  </>
                ) : null}
                {auth.type === 'apikey' ? (
                  <>
                    <input className="input w-full font-mono text-xs" placeholder="Nom (ex. X-API-Key)" value={auth.key || ''} onChange={(e) => set({ auth: { ...auth, key: e.target.value } })} />
                    <input className="input w-full font-mono text-xs" placeholder="Valeur" value={auth.value || ''} onChange={(e) => set({ auth: { ...auth, value: e.target.value } })} />
                    <select className="input w-full" value={auth.in || 'header'} onChange={(e) => set({ auth: { ...auth, in: e.target.value } })}>
                      <option value="header">Dans un en-tête</option>
                      <option value="query">Dans l’URL</option>
                    </select>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col border-t border-border lg:border-t-0">
          <ResponseView res={res} final={final} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet fichier .http
// ---------------------------------------------------------------------------
function HttpFileTab({ tab, envVars, onChange }) {
  const parsed = useMemo(() => parseHttpFile(tab.text || ''), [tab.text]);
  const [res, setRes] = useState(null);
  const [final, setFinal] = useState(null);
  const [lastLine, setLastLine] = useState(null);
  const sender = useSender();
  const editor = useRef(null);
  const vars = useMemo(() => ({ ...envVars, ...parsed.variables }), [envVars, parsed.variables]);

  const run = (r) => {
    setLastLine(r.line);
    sender.send(r, vars, (out, f) => {
      setRes(out);
      setFinal(f);
    });
  };
  const runAtCursor = () => {
    const sel = editor.current?.selection();
    const line = (tab.text || '').slice(0, sel?.start ?? 0).split('\n').length;
    const target = [...parsed.requests].reverse().find((r) => r.line <= line) || parsed.requests[0];
    if (target) run(target);
  };
  const save = async () => {
    const r = await window.electronAPI?.devFiles?.save({ path: tab.file, defaultPath: 'requetes.http', content: tab.text || '', filters: [{ name: 'HTTP', extensions: ['http', 'rest'] }] });
    if (r?.success) onChange({ file: r.path, title: r.name, dirty: false });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-col border-border p-2 lg:w-1/2 lg:border-r">
        <div className="mb-2 flex items-center gap-2 text-xs text-text-muted">
          <span>
            {parsed.requests.length} requête(s) · ▶ dans la marge ou Ctrl+Entrée
          </span>
          <button className="btn-icon ml-auto h-7 w-7" onClick={save} title={tab.file || 'Enregistrer en .http'}>
            <Save size={14} className={tab.dirty ? 'text-accent-primary' : ''} />
          </button>
        </div>
        <CodeEditor
          ref={editor}
          value={tab.text || ''}
          onChange={(text) => onChange({ text, dirty: true })}
          onRun={runAtCursor}
          runnables={parsed.requests.map((r) => ({ ...r, title: `${r.method} ${r.url}` }))}
          onRunAt={run}
          className="flex-1"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t border-border lg:border-t-0">
        {lastLine ? <div className="border-b border-border px-3 py-1 text-[11px] text-text-muted">Requête de la ligne {lastLine}</div> : null}
        <ResponseView res={res} final={final} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Environnements
// ---------------------------------------------------------------------------
function EnvironmentsDialog({ onClose }) {
  const { environments, addEnvironment, updateEnvironment, removeEnvironment, activeEnvId, setActiveEnv } = useApiStore();
  const [selected, setSelected] = useState(activeEnvId || environments[0]?.id || null);
  const env = environments.find((e) => e.id === selected);
  const rows = Object.entries(env?.variables || {}).map(([key, value]) => ({ key, value, enabled: true }));
  return (
    <Modal onClose={onClose} className="flex h-[70vh] max-w-3xl overflow-hidden">
        <div className="flex w-52 flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border p-3 text-sm font-semibold">
            Environnements
            <button className="btn-icon h-6 w-6" onClick={() => setSelected(addEnvironment(`Env ${environments.length + 1}`))}>
              <Plus size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-1">
            {environments.map((e) => (
              <button key={e.id} onClick={() => setSelected(e.id)} className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${e.id === selected ? 'bg-bg-hover' : 'hover:bg-bg-hover'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${e.id === activeEnvId ? 'bg-success' : 'bg-transparent'}`} />
                <span className="truncate">{e.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs text-text-muted">Utilisez-les partout avec {'{{nom}}'}.</span>
            <button className="btn-icon" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
          {env ? (
            <>
              <div className="mb-3 flex gap-2">
                <input className="input flex-1" value={env.name} onChange={(e) => updateEnvironment(env.id, { name: e.target.value })} />
                <button className="btn btn-secondary btn-sm" onClick={() => setActiveEnv(env.id)} disabled={env.id === activeEnvId}>
                  {env.id === activeEnvId ? 'Actif' : 'Activer'}
                </button>
                <button className="btn-icon hover:text-error" onClick={() => removeEnvironment(env.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <KeyValueTable
                  rows={rows}
                  keyPlaceholder="baseUrl"
                  valuePlaceholder="https://api.exemple.com"
                  onChange={(next) => updateEnvironment(env.id, { variables: Object.fromEntries(next.filter((r) => r.key).map((r) => [r.key, r.value])) })}
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-text-muted">Créez un environnement (Local, Recette, Production…) pour changer d’URL ou de jeton en un clic.</p>
          )}
        </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
function ImportDialog({ onClose, onImported }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const doImport = (content, name) => {
    try {
      onImported(importAny(content, name));
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal onClose={onClose} className="max-w-2xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Importer</h3>
          <button className="btn-icon" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <p className="mb-2 text-sm text-text-muted">Collez une commande cURL, un fichier .http, une spécification OpenAPI/Swagger (JSON) ou une collection Postman — ou ouvrez le fichier.</p>
        <textarea className="input h-56 w-full resize-none font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder="curl https://… / { &quot;openapi&quot;: &quot;3.0.0&quot;, … }" />
        {error ? <div className="mt-2 rounded bg-error/10 px-3 py-2 text-xs text-error">{error}</div> : null}
        <div className="mt-3 flex justify-between">
          <button
            className="btn btn-secondary btn-sm flex items-center gap-1.5"
            onClick={async () => {
              const r = await window.electronAPI?.devFiles?.open({
                title: 'Importer',
                filters: [
                  { name: 'API (http, json)', extensions: ['http', 'rest', 'json', 'txt'] },
                  { name: 'Tous', extensions: ['*'] },
                ],
              });
              if (r?.success) doImport(r.content, r.name);
            }}
          >
            <FolderOpen size={13} /> Ouvrir un fichier…
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => doImport(text, '')} disabled={!text.trim()}>
            Importer
          </button>
        </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function ApiApp({ onClose }) {
  const store = useApiStore();
  const { collections, environments, activeEnvId, history } = store;
  const [tabs, setTabs] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const [side, setSide] = useState('collections');
  const [open, setOpen] = useState({});
  const [dialog, setDialog] = useState(null); // 'env' | 'import' | { save: tabId }
  const env = environments.find((e) => e.id === activeEnvId);
  const envVars = useMemo(() => env?.variables || {}, [env]);

  const openTab = useCallback((t) => {
    setTabs((list) => {
      const existing = t.request?.id && list.find((x) => x.request?.id === t.request.id && x.collectionId === t.collectionId);
      if (existing) {
        setActiveTab(existing.id);
        return list;
      }
      const id = newId('t');
      setActiveTab(id);
      return [...list, { id, ...t }];
    });
  }, []);

  const newRequest = () => openTab({ type: 'request', title: 'Nouvelle requête', request: emptyRequest() });
  const newHttpFile = () => openTab({ type: 'http', title: 'requetes.http', text: HTTP_TEMPLATE, dirty: true });
  const openHttpFile = async () => {
    const r = await window.electronAPI?.devFiles?.open({ title: 'Ouvrir un fichier .http', filters: [{ name: 'HTTP', extensions: ['http', 'rest'] }, { name: 'Tous', extensions: ['*'] }] });
    if (r?.success) openTab({ type: 'http', title: r.name, file: r.path, text: r.content });
  };

  // Fichier .http confié par le système (double-clic) ou la visionneuse.
  const pendingFile = useDevToolsStore((s) => s.pendingFile);
  useEffect(() => {
    if (pendingFile?.kind !== 'http') return undefined;
    const t = setTimeout(() => {
      const file = useDevToolsStore.getState().takePendingFile(['http']);
      if (file) openTab({ type: 'http', title: file.name || 'requetes.http', file: file.path || undefined, text: file.text || '' });
    }, 0);
    return () => clearTimeout(t);
  }, [pendingFile, openTab]);

  useEffect(() => {
    if (useDevToolsStore.getState().pendingFile?.kind === 'http') return undefined;
    if (tabs.length === 0) {
      const t = setTimeout(() => {
        if (useApiStore.getState().collections.length === 0) newHttpFile();
        else newRequest();
      }, 0);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateTab = (id, patch) => setTabs((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const closeTab = (id) =>
    setTabs((list) => {
      const t = list.find((x) => x.id === id);
      if (t?.dirty && t.type === 'http' && !window.confirm('Fermer sans enregistrer le fichier ?')) return list;
      const next = list.filter((x) => x.id !== id);
      if (activeTab === id) setActiveTab(next[next.length - 1]?.id || null);
      return next;
    });

  const saveTab = (tab, collectionId) => {
    let target = collectionId || tab.collectionId;
    if (!target) {
      setDialog({ save: tab.id });
      return;
    }
    const request = { ...tab.request, name: tab.request.name || tab.title };
    store.saveRequest(target, request);
    updateTab(tab.id, { collectionId: target, dirty: false, title: request.name });
  };

  const tab = tabs.find((t) => t.id === activeTab);
  const collectionVars = (id) => collections.find((c) => c.id === id)?.variables || {};

  const folders = (col) => {
    const g = new Map();
    for (const r of col.requests) {
      const f = r.folder || '';
      if (!g.has(f)) g.set(f, []);
      g.get(f).push(r);
    }
    return [...g.entries()];
  };

  const RequestRow = ({ r, colId }) => (
    <div className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs hover:bg-bg-hover">
      <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => openTab({ type: 'request', title: r.name, collectionId: colId, request: r })}>
        <span className={`w-11 flex-shrink-0 font-mono text-[10px] font-bold ${METHOD_COLORS[r.method] || ''}`}>{r.method}</span>
        <span className="truncate">{r.name || r.url}</span>
      </button>
      <button className="btn-icon h-5 w-5 opacity-0 hover:text-error group-hover:opacity-100" onClick={() => store.removeRequest(colId, r.id)}>
        <Trash2 size={11} />
      </button>
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0">
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-border bg-bg-secondary">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Globe size={16} className="text-accent-primary" />
          <span className="flex-1 text-sm font-semibold">API</span>
          <button className="btn-icon h-7 w-7" onClick={() => setDialog('import')} title="Importer (cURL, .http, OpenAPI, Postman)">
            <Import size={15} />
          </button>
          <button className="btn-icon h-7 w-7" onClick={onClose} title="Fermer (Échap)">
            <X size={15} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1 p-2">
          <button className="btn btn-secondary btn-sm flex items-center justify-center gap-1 px-1 text-xs" onClick={newRequest} title="Nouvelle requête">
            <Plus size={12} /> Requête
          </button>
          <button className="btn btn-secondary btn-sm flex items-center justify-center gap-1 px-1 text-xs" onClick={newHttpFile} title="Nouveau fichier .http">
            <FileCode2 size={12} /> .http
          </button>
          <button className="btn btn-secondary btn-sm flex items-center justify-center gap-1 px-1 text-xs" onClick={openHttpFile} title="Ouvrir un fichier .http">
            <FolderOpen size={12} /> Ouvrir
          </button>
        </div>
        <div className="flex gap-1 border-b border-border px-2 text-xs">
          {[
            ['collections', 'Collections'],
            ['history', `Historique`],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setSide(id)} className={`-mb-px border-b-2 px-2 py-1 ${side === id ? 'border-accent-primary font-medium' : 'border-transparent text-text-muted'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1.5">
          {side === 'collections' ? (
            <>
              <button className="mb-1 flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-text-muted hover:bg-bg-hover" onClick={() => store.addCollection({ name: `Collection ${collections.length + 1}` })}>
                <FolderPlus size={12} /> Nouvelle collection
              </button>
              {collections.map((col) => (
                <div key={col.id} className="mb-1">
                  <div className="group flex items-center gap-1 rounded px-1 py-1 hover:bg-bg-hover">
                    <button className="btn-icon h-5 w-5" onClick={() => setOpen((o) => ({ ...o, [col.id]: !o[col.id] }))}>
                      {open[col.id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    <input
                      className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                      value={col.name}
                      onChange={(e) => store.updateCollection(col.id, { name: e.target.value })}
                    />
                    <span className="text-[10px] text-text-muted">{col.requests.length}</span>
                    <button
                      className="btn-icon h-5 w-5 opacity-0 group-hover:opacity-100"
                      title="Exporter en .http"
                      onClick={() => window.electronAPI?.devFiles?.save({ defaultPath: `${col.name}.http`, content: toHttpFile(col.requests, col.variables) })}
                    >
                      <Save size={11} />
                    </button>
                    <button
                      className="btn-icon h-5 w-5 opacity-0 hover:text-error group-hover:opacity-100"
                      onClick={() => {
                        if (window.confirm(`Supprimer la collection « ${col.name} » ?`)) store.removeCollection(col.id);
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  {open[col.id] ? (
                    <div className="pl-4">
                      {Object.keys(col.variables || {}).length ? (
                        <div className="mb-1 truncate px-1.5 text-[10px] text-text-muted" title={JSON.stringify(col.variables, null, 1)}>
                          Variables : {Object.keys(col.variables).join(', ')}
                        </div>
                      ) : null}
                      {folders(col).map(([folder, list]) => (
                        <div key={folder}>
                          {folder ? <div className="mt-1 px-1.5 text-[10px] font-semibold uppercase text-text-muted">{folder}</div> : null}
                          {list.map((r) => (
                            <RequestRow key={r.id} r={r} colId={col.id} />
                          ))}
                        </div>
                      ))}
                      {col.requests.length === 0 ? <div className="px-1.5 text-[11px] text-text-muted">Vide — enregistrez une requête ici (💾).</div> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </>
          ) : (
            <>
              {history.length ? (
                <button className="mb-1 w-full rounded px-2 py-1 text-left text-xs text-text-muted hover:bg-bg-hover hover:text-error" onClick={() => store.clearHistory()}>
                  Effacer l’historique
                </button>
              ) : (
                <p className="p-2 text-xs text-text-muted">Aucune requête envoyée.</p>
              )}
              {history.map((h, i) => (
                <button
                  key={i}
                  onClick={() => openTab({ type: 'request', title: h.request.name || h.request.url, request: { ...h.request, id: newId() } })}
                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-bg-hover"
                  title={new Date(h.at).toLocaleString()}
                >
                  <span className={`w-11 flex-shrink-0 font-mono text-[10px] font-bold ${METHOD_COLORS[h.request.method] || ''}`}>{h.request.method}</span>
                  <span className="min-w-0 flex-1 truncate">{h.request.url}</span>
                  <span className={`flex-shrink-0 text-[10px] ${h.error ? 'text-error' : h.status >= 400 ? 'text-amber-500' : 'text-text-muted'}`}>{h.error ? '✕' : h.status}</span>
                </button>
              ))}
            </>
          )}
        </div>
        <div className="flex items-center gap-1 border-t border-border p-2">
          <select className="input min-w-0 flex-1 py-1 text-xs" value={activeEnvId || ''} onChange={(e) => store.setActiveEnv(e.target.value)}>
            <option value="">Aucun environnement</option>
            {environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button className="btn-icon h-7 w-7" onClick={() => setDialog('env')} title="Gérer les environnements">
            <Settings2 size={14} />
          </button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border bg-bg-secondary px-1 pt-1">
          {tabs.map((t) => (
            <div
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`group flex max-w-[15rem] flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-xs ${t.id === activeTab ? 'bg-bg-primary font-medium' : 'text-text-muted hover:bg-bg-hover'}`}
              title={t.file || t.title}
            >
              {t.type === 'http' ? <FileCode2 size={12} /> : <span className={`font-mono text-[10px] font-bold ${METHOD_COLORS[t.request?.method] || ''}`}>{t.request?.method}</span>}
              <span className="truncate">{t.title}</span>
              {t.dirty ? <span className="h-1.5 w-1.5 rounded-full bg-accent-primary" /> : null}
              <button
                className="btn-icon h-4 w-4 opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
          <button className="btn-icon ml-1 h-6 w-6 flex-shrink-0" onClick={newRequest} title="Nouvelle requête">
            <Plus size={13} />
          </button>
        </div>
        {tab?.type === 'request' ? (
          <RequestTab
            key={tab.id}
            tab={tab}
            vars={{ ...collectionVars(tab.collectionId), ...envVars }}
            onChange={(patch) => updateTab(tab.id, patch.request?.name ? { ...patch, title: patch.title || patch.request.name } : patch)}
            onSave={() => saveTab(tab)}
          />
        ) : null}
        {tab?.type === 'http' ? <HttpFileTab key={tab.id} tab={tab} envVars={envVars} onChange={(patch) => updateTab(tab.id, patch)} /> : null}
        {!tab ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Globe size={40} className="text-accent-primary" />
            <p className="max-w-md text-sm text-text-muted">Testez une API en formulaire, ou ouvrez un fichier .http pour exécuter chaque requête d’un clic.</p>
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={newRequest}>
                Nouvelle requête
              </button>
              <button className="btn btn-secondary btn-sm" onClick={newHttpFile}>
                Fichier .http d’exemple
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {dialog === 'env' ? <EnvironmentsDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'import' ? (
        <ImportDialog
          onClose={() => setDialog(null)}
          onImported={(col) => {
            setDialog(null);
            if (col.requests.length === 1 && !Object.keys(col.variables || {}).length) {
              openTab({ type: 'request', title: col.requests[0].name, request: col.requests[0], dirty: true });
              return;
            }
            const id = store.addCollection(col);
            setOpen((o) => ({ ...o, [id]: true }));
            setSide('collections');
          }}
        />
      ) : null}
      {dialog?.save ? (
        <Modal onClose={() => setDialog(null)} className="max-w-sm p-4">
            <h3 className="mb-3 font-semibold">Enregistrer dans…</h3>
            <div className="max-h-60 space-y-1 overflow-auto">
              {collections.map((c) => (
                <button
                  key={c.id}
                  className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-bg-hover"
                  onClick={() => {
                    const t = tabs.find((x) => x.id === dialog.save);
                    setDialog(null);
                    if (t) saveTab(t, c.id);
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <button
              className="btn btn-secondary btn-sm mt-3 w-full"
              onClick={() => {
                const id = store.addCollection({ name: 'Ma collection' });
                const t = tabs.find((x) => x.id === dialog.save);
                setDialog(null);
                if (t) saveTab(t, id);
                setOpen((o) => ({ ...o, [id]: true }));
              }}
            >
              + Nouvelle collection
            </button>
        </Modal>
      ) : null}
    </div>
  );
}
