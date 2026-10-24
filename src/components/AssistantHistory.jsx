import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Compass,
  CheckSquare,
  Lightbulb,
  Mail,
  MessageCircle,
  Download,
  PenLine,
  Plus,
  Search,
  SpellCheck,
  Trash2,
  Square,
  X,
} from 'lucide-react';
import { useT } from '../lib/i18n';
import {
  SESSION_CATEGORIES,
  countSessionsByCategory,
  filterAssistantSessions,
  groupAssistantSessions,
} from '../lib/assistantSessions';

// Chaque catégorie garde la même icône et la même couleur que dans le menu
// des commandes : on retrouve le thème d'une session d'un coup d'œil.
const CATEGORY_ICONS = {
  discussion: MessageCircle,
  essentials: SpellCheck,
  writing: Mail,
  analysis: Lightbulb,
  orbit: Compass,
};

const CATEGORY_LOOKS = {
  discussion: {
    chip: 'bg-accent-primary/10 text-accent-primary',
    dot: 'bg-accent-primary',
  },
  essentials: {
    chip: 'bg-emerald-500/10 text-emerald-500',
    dot: 'bg-emerald-500',
  },
  writing: {
    chip: 'bg-violet-500/10 text-violet-400',
    dot: 'bg-violet-400',
  },
  analysis: {
    chip: 'bg-sky-500/10 text-sky-400',
    dot: 'bg-sky-400',
  },
  orbit: {
    chip: 'bg-amber-500/10 text-amber-400',
    dot: 'bg-amber-400',
  },
};

function ageLabel(updatedAt, now, t) {
  const elapsed = Math.max(0, now - (Number(updatedAt) || 0));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return t('assistant.history.time.now');
  if (minutes < 60) return t('assistant.history.time.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('assistant.history.time.hours', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('assistant.history.time.days', { count: days });
  return new Date(Number(updatedAt) || 0).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

export default function AssistantHistory({
  sessions = [],
  activeSessionId = '',
  onSelect,
  onNew,
  onRename,
  onDelete,
  onExport,
  onExportMany,
  onExportAll,
  onDeleteMany,
  onClear,
  onClose,
  busy = false,
  embedded = false,
  hideHeader = false,
  hideNew = false,
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [editingId, setEditingId] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const searchRef = useRef(null);

  useEffect(() => {
    searchRef.current?.focus();
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const counts = useMemo(() => countSessionsByCategory(sessions), [sessions]);
  const visible = useMemo(
    () => filterAssistantSessions(sessions, { query, category }),
    [category, query, sessions]
  );
  const groups = useMemo(() => groupAssistantSessions(visible, now), [now, visible]);

  const startRename = (session) => {
    setEditingId(session.id);
    setDraftTitle(session.title || '');
  };

  const cancelRename = () => {
    setEditingId('');
    setDraftTitle('');
  };

  const commitRename = () => {
    if (!editingId) return;
    const title = draftTitle.trim();
    if (title) onRename?.(editingId, title);
    cancelRename();
  };
  const selectVisible = () => {
    setSelectedIds((current) => (
      visible.every((session) => current.includes(session.id))
        ? current.filter((id) => !visible.some((session) => session.id === id))
        : [...new Set([...current, ...visible.map((session) => session.id)])]
    ));
  };

  return (
    <aside
      aria-label={t('assistant.history.title')}
      className={`flex min-h-0 min-w-0 flex-col ${
        embedded ? 'w-full flex-1 bg-transparent' : 'w-72 shrink-0 border-r border-border bg-bg-primary/40'
      }`}
    >
      {!hideHeader && (
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          <Clock size={13} />
          {t('assistant.history.title')}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setSelecting((value) => !value);
              setSelectedIds([]);
            }}
            aria-pressed={selecting}
            title={t('assistant.history.select')}
            className={`rounded-md p-1 transition-colors ${
              selecting ? 'text-accent-primary' : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            <CheckSquare size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('assistant.history.close')}
            title={t('assistant.history.close')}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      )}

      <div className="space-y-2 border-b border-border px-3 pb-3">
        {selecting && (
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <button type="button" onClick={selectVisible} className="text-text-muted hover:text-text-primary">
              {t('assistant.history.selectVisible')}
            </button>
            <span className="text-text-muted">{selectedIds.length}</span>
          </div>
        )}
        {selecting && selectedIds.length > 0 && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onExportMany?.(selectedIds)}
              className="btn btn-ghost btn-sm min-w-0 flex-1 justify-center"
            >
              <Download size={13} /> {t('assistant.history.exportSelected')}
            </button>
            <button
              type="button"
              onClick={() => {
                onDeleteMany?.(selectedIds);
                setSelectedIds([]);
                setSelecting(false);
              }}
              className="btn btn-ghost btn-sm min-w-0 flex-1 justify-center text-red-400 hover:text-red-300"
            >
              <Trash2 size={13} /> {t('assistant.history.deleteSelected')}
            </button>
          </div>
        )}
        {selecting && sessions.length > 0 && (
          <button
            type="button"
            onClick={onExportAll}
            className="w-full rounded-md px-2 py-1 text-left text-[11px] text-text-muted hover:bg-bg-hover hover:text-text-primary"
          >
            <Download size={12} className="mr-1 inline" />
            {t('assistant.history.exportAll')}
          </button>
        )}
        {!hideNew && <button
          type="button"
          onClick={onNew}
          disabled={busy}
          className="btn btn-primary btn-sm w-full justify-center"
        >
          <Plus size={14} />
          {t('assistant.history.new')}
        </button>}
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('assistant.history.search')}
            aria-label={t('assistant.history.search')}
            className="w-full rounded-lg border border-border bg-bg-elevated py-1.5 pl-8 pr-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent-primary"
          />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('assistant.history.filterLabel')}>
          <button
            type="button"
            onClick={() => setCategory('')}
            aria-pressed={category === ''}
            className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              category === ''
                ? 'border-accent-primary/50 bg-accent-primary/10 text-accent-primary'
                : 'border-border text-text-muted hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            {t('assistant.history.filterAll')}
            <span className="ml-1 opacity-60">{sessions.length}</span>
          </button>
          {SESSION_CATEGORIES.filter((id) => counts[id] > 0).map((id) => {
            const Look = CATEGORY_LOOKS[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => setCategory(category === id ? '' : id)}
                aria-pressed={category === id}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  category === id
                    ? 'border-accent-primary/50 bg-accent-primary/10 text-text-primary'
                    : 'border-border text-text-muted hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${Look.dot}`} />
                {t(`assistant.history.category.${id}`)}
                <span className="opacity-60">{counts[id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <div className="rounded-xl border border-border bg-bg-elevated p-2.5 text-text-muted">
              <Clock size={18} />
            </div>
            <p className="text-xs leading-5 text-text-muted">
              {sessions.length === 0
                ? t('assistant.history.empty')
                : t('assistant.history.emptySearch')}
            </p>
          </div>
        ) : groups.map((group) => (
          <section key={group.id} className="mb-2 last:mb-0">
            <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {t(`assistant.history.group.${group.id}`)}
            </p>
            <ul className="space-y-0.5">
              {group.sessions.map((session) => {
                const Icon = CATEGORY_ICONS[session.category] || MessageCircle;
                const Look = CATEGORY_LOOKS[session.category] || CATEGORY_LOOKS.discussion;
                const active = session.id === activeSessionId;
                const count = Array.isArray(session.messages) ? session.messages.length : 0;
                const preview = session.messages?.at(-1)?.content || t('assistant.history.untitled');
                if (editingId === session.id) {
                  return (
                    <li key={session.id} className="rounded-xl border border-accent-primary/40 bg-bg-elevated p-1.5">
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          commitRename();
                        }}
                        className="flex items-center gap-1"
                      >
                        <input
                          autoFocus
                          value={draftTitle}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelRename();
                            }
                          }}
                          maxLength={80}
                          aria-label={t('assistant.history.rename')}
                          className="min-w-0 flex-1 rounded-md border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-primary"
                        />
                        <button
                          type="submit"
                          aria-label={t('assistant.history.saveRename')}
                          title={t('assistant.history.saveRename')}
                          className="rounded-md p-1 text-emerald-500 transition-colors hover:bg-emerald-500/10"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          aria-label={t('assistant.history.cancelRename')}
                          title={t('assistant.history.cancelRename')}
                          className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                        >
                          <X size={13} />
                        </button>
                      </form>
                    </li>
                  );
                }
                return (
                  <li
                    key={session.id}
                    className={`group relative rounded-xl border transition-colors ${
                      active
                        ? 'border-accent-primary/40 bg-accent-primary/5'
                        : 'border-transparent hover:border-border hover:bg-bg-elevated/70'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (selecting) {
                          setSelectedIds((current) => (
                            current.includes(session.id)
                              ? current.filter((id) => id !== session.id)
                              : [...current, session.id]
                          ));
                        } else {
                          onSelect?.(session);
                        }
                      }}
                      aria-current={active ? 'true' : undefined}
                      className="flex w-full items-start gap-2.5 rounded-xl p-2 pr-20 text-left"
                    >
                      {selecting && (
                        <span className="mt-1 shrink-0 text-text-muted">
                          {selectedIds.includes(session.id)
                            ? <CheckSquare size={13} className="text-accent-primary" />
                            : <Square size={13} />}
                        </span>
                      )}
                      <span className={`mt-0.5 shrink-0 rounded-lg p-1.5 ${Look.chip}`}>
                        <Icon size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text-primary">
                          {session.title || t('assistant.history.untitled')}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] leading-4 text-text-muted">
                          {preview}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
                          <span className={`h-1.5 w-1.5 rounded-full ${Look.dot}`} />
                          {t(`assistant.history.category.${session.category}`)}
                          <span aria-hidden="true">·</span>
                          {t(
                            count === 1
                              ? 'assistant.history.messageCount.one'
                              : 'assistant.history.messageCount.many',
                            { count }
                          )}
                          <span aria-hidden="true">·</span>
                          {ageLabel(session.updatedAt, now, t)}
                        </span>
                      </span>
                    </button>
                    <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => onExport?.(session)}
                        aria-label={t('assistant.history.export')}
                        title={t('assistant.history.export')}
                        className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                      >
                        <Download size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => startRename(session)}
                        aria-label={t('assistant.history.rename')}
                        title={t('assistant.history.rename')}
                        className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                      >
                        <PenLine size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete?.(session.id)}
                        aria-label={t('assistant.history.delete')}
                        title={t('assistant.history.delete')}
                        className="rounded-md p-1 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {sessions.length > 0 && (
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={onClear}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 size={12} />
            {t('assistant.history.clear')}
          </button>
        </div>
      )}
    </aside>
  );
}
