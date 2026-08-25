import { useMemo, useState } from 'react';
import { AlertTriangle, XCircle, Info, Trash2, Copy, Check } from 'lucide-react';
import { useDiagnosticsStore, DIAGNOSTIC_LEVEL } from '../lib/diagnosticsStore';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';

// Journal des incidents des apps. Sert à répondre à « pourquoi cette app
// s'est-elle déconnectée / pourquoi ai-je dû recharger ? » : ces pannes sont
// intermittentes, et sans trace horodatée elles sont impossibles à corréler.
export default function Diagnostics() {
  const t = useT();
  const events = useDiagnosticsStore((s) => s.events);
  const clearEvents = useDiagnosticsStore((s) => s.clearEvents);
  const apps = useStore((s) => s.apps);
  const [filter, setFilter] = useState('all'); // 'all' | appId
  const [copied, setCopied] = useState(false);

  const shown = useMemo(
    () => (filter === 'all' ? events : events.filter((e) => e.appId === filter)),
    [events, filter]
  );

  // Apps qui ont réellement produit un événement — inutile de lister les autres
  const appsWithEvents = useMemo(() => {
    const ids = new Set(events.map((e) => e.appId));
    return apps.filter((a) => ids.has(a.id));
  }, [events, apps]);

  const fmt = (ts) =>
    new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  // Copie en texte brut : de quoi coller le journal dans un rapport de bug.
  const copyAll = () => {
    const text = shown
      .map(
        (e) =>
          `${new Date(e.at).toISOString()}  [${e.type}]  ${e.appName || e.appId}  ${e.message}${
            e.detail ? `  — ${e.detail}` : ''
          }`
      )
      .join('\n');
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  };

  const iconFor = (type) => {
    const level = DIAGNOSTIC_LEVEL[type] || 'info';
    if (level === 'error') return <XCircle size={15} className="text-error flex-shrink-0 mt-0.5" />;
    if (level === 'warn')
      return <AlertTriangle size={15} className="text-warning flex-shrink-0 mt-0.5" />;
    return <Info size={15} className="text-text-muted flex-shrink-0 mt-0.5" />;
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <h4 className="font-semibold mb-2">{t('dg.title')}</h4>
        <p className="text-sm text-text-muted">{t('dg.desc')}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="input max-w-xs"
        >
          <option value="all">{t('dg.allApps')}</option>
          {appsWithEvents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button onClick={copyAll} className="btn btn-sm" disabled={shown.length === 0}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {t('dg.copy')}
        </button>
        <button
          onClick={() => clearEvents(filter === 'all' ? undefined : filter)}
          className="btn btn-sm"
          disabled={shown.length === 0}
        >
          <Trash2 size={14} /> {t('dg.clear')}
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="card text-sm text-text-muted text-center py-8">{t('dg.empty')}</div>
      ) : (
        <div className="card p-0 divide-y divide-border max-h-[28rem] overflow-y-auto">
          {shown.map((e) => (
            <div key={e.id} className="flex items-start gap-3 px-4 py-2.5">
              {iconFor(e.type)}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-medium text-sm">{e.appName || e.appId}</span>
                  <span className="text-xs text-text-muted tabular-nums">{fmt(e.at)}</span>
                </div>
                <p className="text-sm text-text-secondary">{e.message}</p>
                {e.detail && (
                  <p className="text-xs text-text-muted break-all mt-0.5">{e.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-text-muted">{t('dg.note')}</p>
    </div>
  );
}
