import { useEffect, useState } from 'react';
import { Cpu, MemoryStick } from 'lucide-react';
import { useT } from '../../lib/i18n';

// Moniteur discret : charge CPU et mémoire de la machine, relevées toutes les
// 3 secondes par le main process (le renderer n'a pas accès à `os`).
const formatBytes = (n) => {
  if (!Number.isFinite(n)) return '—';
  const go = n / 1024 ** 3;
  return go >= 10 ? `${Math.round(go)} Go` : `${go.toFixed(1)} Go`;
};

export default function SystemWidget() {
  const t = useT();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!window.electronAPI?.getSystemStats) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const s = await window.electronAPI.getSystemStats();
        if (alive && s) setStats(s);
      } catch {
        /* le main process n'a pas répondu : on réessaie au prochain tour */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!stats) return null;
  const memPct = stats.memTotal ? (stats.memUsed / stats.memTotal) * 100 : 0;
  // Au-delà de 85 % on passe en rouge : c'est le moment où la machine rame.
  const tone = (v) => (v >= 85 ? 'text-error' : v >= 65 ? 'text-yellow-500' : 'text-text-secondary');

  return (
    <div
      className="app-no-drag h-8 px-2 rounded-lg flex items-center gap-2.5 text-xs"
      title={t('sys.tooltip', {
        cores: stats.cores,
        mem: `${formatBytes(stats.memUsed)} / ${formatBytes(stats.memTotal)}`,
      })}
    >
      <span className={`flex items-center gap-1 tabular-nums ${tone(stats.cpu ?? 0)}`}>
        <Cpu size={14} />
        {stats.cpu === null ? '—' : `${Math.round(stats.cpu)}%`}
      </span>
      <span className={`flex items-center gap-1 tabular-nums ${tone(memPct)}`}>
        <MemoryStick size={14} />
        {Math.round(memPct)}%
      </span>
    </div>
  );
}
