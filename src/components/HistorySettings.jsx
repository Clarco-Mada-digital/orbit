import { useEffect, useState } from 'react';
import { History, Trash2 } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useHistoryStore } from '../lib/historyStore';
import { countSince, hostLabel } from '../lib/historySearch';

// ---------------------------------------------------------------------------
// Réglages → Confidentialité → Historique de navigation
//
// L'historique alimente la recherche transverse d'Alt+K (« cette page vue
// hier »). Il était jusqu'ici invisible dans les réglages : on pouvait le
// consulter sans pouvoir ni l'arrêter ni le vider. Un journal qu'on ne peut pas
// effacer est un journal qu'on subit — d'où cet écran.
//
// Il reste LOCAL : il n'entre pas dans la synchronisation entre machines (voir
// lib/historyStore.js). Rien à envoyer, donc rien à révoquer ailleurs.
// ---------------------------------------------------------------------------
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export default function HistorySettings() {
  const t = useT();
  const entries = useHistoryStore((s) => s.entries);
  const enabled = useHistoryStore((s) => s.enabled);
  const setEnabled = useHistoryStore((s) => s.setEnabled);
  const forgetSince = useHistoryStore((s) => s.forgetSince);
  const clear = useHistoryStore((s) => s.clear);
  // Un vidage est irréversible : on demande confirmation sur le bouton même,
  // plutôt que par une modale qu'on valide sans lire.
  const [confirm, setConfirm] = useState(null); // null | 'hour' | 'day' | 'all'

  // L'heure courante est RELEVÉE APRÈS le rendu, pas pendant : lire l'horloge
  // en plein rendu donne une valeur différente à chaque passage (React le
  // signale comme impur). Le relevé est rafraîchi chaque minute, sinon
  // « dernière heure » finirait par compter une fenêtre glissante figée à
  // l'ouverture de l'écran.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // `null` tant que l'heure n'est pas relevée (le premier rendu) : on préfère
  // ne pas afficher de nombre plutôt qu'un nombre faux.
  const countFor = (ms) => (now ? countSince(entries, now - ms) : null);
  const ranges = [
    { id: 'hour', label: t('st.hist.lastHour'), count: countFor(HOUR) },
    { id: 'day', label: t('st.hist.today'), count: countFor(DAY) },
  ];

  const run = (id) => {
    if (confirm !== id) {
      setConfirm(id);
      return;
    }
    // On réutilise l'instant qui a servi à COMPTER, pas l'horloge du clic :
    // le bouton efface ainsi exactement ce qu'il annonçait. L'écart possible
    // (une minute au plus) n'a aucune portée pour « la dernière heure », alors
    // qu'un compteur qui ne correspond pas à l'effet, si.
    if (id === 'all') clear();
    else forgetSince(now - (id === 'hour' ? HOUR : DAY));
    setConfirm(null);
  };

  const label = (id, base, count) =>
    confirm === id ? t('st.hist.confirm') : count == null ? base : `${base} (${count})`;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-2">
        <History size={18} className="text-accent-primary" />
        <h4 className="font-semibold">{t('st.hist.title')}</h4>
      </div>
      <p className="text-sm text-text-muted mb-4">{t('st.hist.desc')}</p>

      <label className="flex items-center justify-between mb-4">
        <div>
          <div className="font-medium">{t('st.hist.record')}</div>
          <div className="text-sm text-text-muted">{t('st.hist.recordDesc')}</div>
        </div>
        <input
          type="checkbox"
          checked={enabled !== false}
          onChange={(e) => setEnabled(e.target.checked)}
          className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
        />
      </label>

      <div className="rounded-lg border border-border p-3 space-y-3">
        <div className="text-sm">
          {entries.length === 0 ? (
            t('st.hist.empty')
          ) : (
            <>
              <span className="font-medium">{t('st.hist.count', { n: entries.length })}</span>
              {/* Les sites les plus présents : ce qu'on veut savoir avant de
                  décider si on vide. */}
              <span className="text-text-muted"> — {topHosts(entries).join(', ')}</span>
            </>
          )}
        </div>

        {entries.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {ranges.map((range) => (
              <button
                key={range.id}
                onClick={() => run(range.id)}
                disabled={range.count === 0 && confirm !== range.id}
                className="btn btn-secondary btn-sm"
              >
                {label(range.id, range.label, range.count)}
              </button>
            ))}
            <button onClick={() => run('all')} className="btn btn-secondary btn-sm text-error">
              <Trash2 size={14} /> {label('all', t('st.hist.clearAll'))}
            </button>
            {confirm && (
              <button onClick={() => setConfirm(null)} className="btn btn-ghost btn-sm">
                {t('common.cancel')}
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-text-muted mt-3">{t('st.hist.hint')}</p>
    </div>
  );
}

// Trois hôtes les plus fréquents, pour donner une idée du contenu sans
// dérouler des centaines de lignes (et sans afficher d'URL complète, qui
// peut être bavarde).
function topHosts(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const host = hostLabel(entry.url);
    if (!host) continue;
    counts.set(host, (counts.get(host) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([host, n]) => `${host} (${n})`);
}
