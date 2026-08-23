import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';
import { normalizeTopbar, DEFAULT_BOTTOMBAR } from '../lib/topbarLayout';
import { useTopbarModules } from './topbar/useTopbarModules';

// Barre du bas, optionnelle : même principe de composition que l'en-tête
// (Paramètres → Apparence → Barre du bas). Les menus s'ouvrent vers le haut.
export default function Bottombar({ onOpenQuickSwitcher }) {
  const settings = useStore((s) => s.settings);
  const t = useT();
  const renderModule = useTopbarModules({ onOpenQuickSwitcher, placement: 'bottom' });

  const layout = normalizeTopbar(settings?.bottombar, DEFAULT_BOTTOMBAR);
  const renderZone = (zone, className) => (
    <div className={className}>
      {(layout[zone] || []).map((id, i) => renderModule(id, `${zone}-${id}-${i}`))}
    </div>
  );

  return (
    <div className="h-10 bg-bg-secondary border-t border-border flex items-center gap-2 px-3 select-none flex-shrink-0 app-no-drag">
      {renderZone('left', 'flex items-center gap-2 min-w-0 flex-shrink-0')}

      {/* Zone centrale : absorbe l'espace libre */}
      {renderZone('center', 'flex-1 min-w-0 flex items-center justify-center gap-2')}

      {renderZone('right', 'flex items-center gap-1 flex-shrink-0')}
    </div>
  );
}
