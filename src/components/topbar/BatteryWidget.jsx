import { useEffect, useState } from 'react';
import { BatteryFull, BatteryMedium, BatteryLow, BatteryWarning, BatteryCharging } from 'lucide-react';
import { useT } from '../../lib/i18n';

// Niveau de batterie de la machine (API navigateur). Sur un poste fixe sans
// batterie, l'API renvoie 100 % branché en permanence → on masque le widget.
export default function BatteryWidget() {
  const t = useT();
  const [info, setInfo] = useState(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    let battery = null;
    let alive = true;
    const update = () => {
      if (!alive || !battery) return;
      setInfo({
        level: Math.round(battery.level * 100),
        charging: battery.charging,
        // Temps restant en secondes (Infinity quand inconnu)
        remaining: battery.charging ? battery.chargingTime : battery.dischargingTime,
      });
    };
    if (typeof navigator.getBattery !== 'function') {
      setSupported(false);
      return undefined;
    }
    navigator
      .getBattery()
      .then((b) => {
        if (!alive) return;
        battery = b;
        ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((ev) =>
          b.addEventListener(ev, update)
        );
        update();
      })
      .catch(() => setSupported(false));
    return () => {
      alive = false;
      if (battery) {
        ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((ev) =>
          battery.removeEventListener(ev, update)
        );
      }
    };
  }, []);

  if (!supported || !info) return null;

  const Icon = info.charging
    ? BatteryCharging
    : info.level > 70
      ? BatteryFull
      : info.level > 35
        ? BatteryMedium
        : info.level > 15
          ? BatteryLow
          : BatteryWarning;
  const color = info.charging
    ? 'text-success'
    : info.level <= 15
      ? 'text-error'
      : info.level <= 35
        ? 'text-yellow-500'
        : 'text-text-secondary';

  // Autonomie estimée, quand le système la fournit
  const eta =
    Number.isFinite(info.remaining) && info.remaining > 0 && info.remaining < 86400
      ? `${Math.floor(info.remaining / 3600)} h ${String(Math.round((info.remaining % 3600) / 60)).padStart(2, '0')}`
      : null;

  return (
    <div
      className={`app-no-drag h-8 px-2 rounded-lg flex items-center gap-1.5 ${color}`}
      title={
        (info.charging ? t('battery.charging') : t('battery.onBattery')) +
        (eta ? ` — ${t('battery.remaining', { time: eta })}` : '')
      }
    >
      <Icon size={17} />
      <span className="text-xs font-medium tabular-nums">{info.level}%</span>
    </div>
  );
}
