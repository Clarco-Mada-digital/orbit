import { useTopbarModules } from './topbar/useTopbarModules';
import { normalizeTopbar } from '../lib/topbarLayout';
import { Minimize2 } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';

// Barre supérieure UNIFIÉE, style Station : pas de barre d'adresse — on
// n'entre jamais d'URL à la main. Logo + app active (zone de déplacement),
// navigation, et à droite notifications + contrôles de fenêtre.
// Les modules sont rendus par le hook partagé useTopbarModules (aussi utilisé
// par la barre du bas).
export default function Topbar({
  onOpenQuickSwitcher,
  isFullscreen = false,
  onToggleFullscreen,
}) {
  const renderModule = useTopbarModules({ onOpenQuickSwitcher, placement: 'top' });
  const settings = useStore((s) => s.settings);
  const t = useT();

  const layout = normalizeTopbar(settings?.topbar);
  const renderZone = (zone, className) => (
    <div className={className}>
      {(layout[zone] || []).map((id, i) => renderModule(id, `${zone}-${id}-${i}`, zone))}
    </div>
  );

  return (
    <div className="h-12 bg-bg-secondary border-b border-border flex items-center gap-2 px-3 select-none flex-shrink-0 app-drag">
      {renderZone('left', 'flex items-center gap-2 min-w-0 flex-shrink-0 app-no-drag')}

      {/* Zone centrale : elle absorbe l'espace libre — vide, elle sert de
          poignée pour déplacer la fenêtre. */}
      {renderZone('center', 'flex-1 min-w-0 flex items-center justify-center gap-2')}

      {renderZone('right', 'flex items-center gap-1 flex-shrink-0 app-no-drag')}

      <div className="w-px h-5 bg-border mx-1 flex-shrink-0"></div>

      {/* Contrôles de fenêtre — jamais configurables : ils restent à droite */}
      <div className="flex items-center gap-1 app-no-drag">
        <button
          onClick={() => window.electronAPI?.minimizeWindow?.()}
          className="w-10 h-8 hover:bg-bg-hover flex items-center justify-center transition-colors"
          title={t('tb.minimize')}
        >
          <svg width="12" height="2" viewBox="0 0 12 2" fill="currentColor">
            <rect width="12" height="2" />
          </svg>
        </button>
        {isFullscreen ? (
          /* Plein écran : le bouton agrandir devient « quitter le plein écran » */
          <button
            onClick={() => onToggleFullscreen?.()}
            className="w-10 h-8 hover:bg-bg-hover flex items-center justify-center transition-colors text-accent-primary"
            title={t('tb.exitFullscreen')}
          >
            <Minimize2 size={13} />
          </button>
        ) : (
          <button
            onClick={() => window.electronAPI?.maximizeWindow?.()}
            className="w-10 h-8 hover:bg-bg-hover flex items-center justify-center transition-colors"
            title={t('tb.maximize')}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="1" y="1" width="10" height="10" />
            </svg>
          </button>
        )}
        <button
          onClick={() => window.electronAPI?.closeWindow?.()}
          className="w-10 h-8 hover:bg-error flex items-center justify-center transition-colors"
          title={t('common.close')}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M1 1l10 10M11 1L1 11" />
          </svg>
        </button>
      </div>
    </div>
  );
}
