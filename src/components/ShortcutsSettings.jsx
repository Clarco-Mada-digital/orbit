import { useMemo, useState } from 'react';
import { Search, X, Keyboard } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '../lib/i18n';
import { shortcutKeys, filterShortcuts, SHORTCUT_GROUPS } from '../lib/shortcuts';

// ---------------------------------------------------------------------------
// Réglages → Raccourcis.
//
// La liste a grandi (écran partagé, pages, outils…) : elle est rangée par
// groupe et se filtre à la frappe — par description, par groupe ou par
// touches (« partagé », « zoom », « ⇧ x », « maj »). Sans accents ni casse.
// ---------------------------------------------------------------------------
export default function ShortcutsSettings() {
  const t = useT();
  const settings = useStore(
    useShallow((s) => ({
      assistantChatEnabled: s.settings.assistantChatEnabled,
      assistantChatShortcutEnabled: s.settings.assistantChatShortcutEnabled,
      assistantChatShortcutKey: s.settings.assistantChatShortcutKey,
      keyboardSwitcher: s.settings.keyboardSwitcher,
    })),
  );
  const updateSettings = useStore((s) => s.updateSettings);
  const [query, setQuery] = useState('');

  const all = useMemo(
    () =>
      shortcutKeys(t, {
        assistantChatEnabled: settings.assistantChatEnabled !== false,
        assistantChatShortcutEnabled: settings.assistantChatShortcutEnabled !== false,
        assistantChatShortcutKey: settings.assistantChatShortcutKey,
      }),
    [t, settings.assistantChatEnabled, settings.assistantChatShortcutEnabled, settings.assistantChatShortcutKey],
  );
  const groupLabel = (id) => t(`sc.group.${id}`);
  const visible = filterShortcuts(all, query, groupLabel);
  const groups = SHORTCUT_GROUPS.map((id) => ({
    id,
    items: visible.filter((s) => s.group === id),
  })).filter((g) => g.items.length);

  return (
    <div className="space-y-4">
      <div className="card !p-3 sticky top-0 z-10">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              }
            }}
            placeholder={t('sc.searchPlaceholder')}
            spellCheck={false}
            autoFocus
            className="input w-full pl-9 pr-24"
          />
          <span className="absolute right-9 top-1/2 -translate-y-1/2 text-xs text-text-muted pointer-events-none">
            {t('sc.count', { n: visible.length })}
          </span>
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon"
              title={t('common.close')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Alt+Page↓/↑ : sélecteur discret (défaut) ou bascule immédiate. */}
      <label className="card flex cursor-pointer items-start gap-3 !p-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-accent-primary"
          checked={settings.keyboardSwitcher !== false}
          onChange={(e) => updateSettings({ keyboardSwitcher: e.target.checked })}
        />
        <span>
          <span className="block text-sm font-medium">Choisir avant d’ouvrir (apps et profils)</span>
          <span className="block text-xs text-text-muted">
            Avec Alt+Page↓ / Alt+Page↑ (⇧ pour les profils), une petite barre montre où vous allez ; seule la cible s’ouvre, en
            relâchant Alt, avec Entrée ou après une courte pause. Décoché : chaque appui ouvre directement l’élément suivant.
          </span>
        </span>
      </label>

      {groups.length === 0 && (
        <div className="card text-sm text-text-muted flex items-center gap-2">
          <Keyboard size={16} />
          {t('sc.searchEmpty', { q: query.trim() })}
        </div>
      )}

      {groups.map((group) => (
        <div key={group.id} className="card">
          <h4 className="text-xs font-semibold text-text-muted uppercase mb-2">{groupLabel(group.id)}</h4>
          <div className="divide-y divide-border">
            {group.items.map((s) => (
              <div key={`${s.group}-${s.desc}`} className="flex items-center justify-between gap-4 py-2">
                <span className="text-sm">{s.desc}</span>
                <span className="flex items-center gap-1 flex-shrink-0">
                  {s.keys.map((k, j) => (
                    <span key={j} className="flex items-center">
                      {j > 0 && <span className="text-text-muted mx-0.5 text-xs">+</span>}
                      <kbd className="px-2 py-1 bg-bg-elevated border border-border rounded font-mono text-xs">{k}</kbd>
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
