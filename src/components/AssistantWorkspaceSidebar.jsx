import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Plus,
  Search,
  Star,
} from 'lucide-react';
import { useT } from '../lib/i18n';
import { ASSISTANT_AGENTS, groupAssistantAgents } from '../lib/assistantAgents';
import AssistantHistory from './AssistantHistory';

export default function AssistantWorkspaceSidebar({
  sessions,
  activeSessionId,
  activeAgentId,
  activeTab,
  expanded,
  favorites,
  onTabChange,
  onExpandedChange,
  onSelect,
  onNew,
  onSelectAgent,
  onToggleFavorite,
  onRename,
  onDelete,
  onExport,
  onExportMany,
  onExportAll,
  onDeleteMany,
  onClear,
  busy,
}) {
  const t = useT();
  const [agentQuery, setAgentQuery] = useState('');
  const [flyout, setFlyout] = useState('');
  const closeTimer = useRef(null);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const groups = useMemo(() => {
    const query = agentQuery.trim().toLocaleLowerCase();
    return groupAssistantAgents(ASSISTANT_AGENTS, favorites)
      .map((group) => ({
        ...group,
        agents: query
          ? group.agents.filter((agent) => (
            t(agent.nameKey).toLocaleLowerCase().includes(query) ||
            t(agent.descriptionKey).toLocaleLowerCase().includes(query)
          ))
          : group.agents,
      }))
      .filter((group) => group.agents.length > 0);
  }, [agentQuery, favorites, t]);

  const showFlyout = (target) => {
    clearTimeout(closeTimer.current);
    setFlyout(target);
  };
  const scheduleFlyoutClose = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setFlyout(''), 260);
  };

  const renderAgents = (flyoutMode = false) => (
    <>
      <div className="relative px-3 pb-2">
        <Search size={13} className="pointer-events-none absolute left-5 top-2.5 text-text-muted" />
        <input
          type="search"
          value={agentQuery}
          onChange={(event) => setAgentQuery(event.target.value)}
          placeholder={t('assistant.agents.search')}
          aria-label={t('assistant.agents.search')}
          className="w-full rounded-lg border border-border bg-bg-primary/60 py-2 pl-8 pr-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent-primary"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-text-muted">{t('assistant.agents.empty')}</p>
        ) : groups.map((group) => (
          <section key={group.id} className="mb-2 last:mb-0">
            <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {t(group.labelKey)}
            </p>
            {group.agents.map((agent) => {
              const favorite = favorites.includes(agent.id);
              const active = agent.id === activeAgentId;
              return (
                <div
                  key={agent.id}
                  className={`group flex items-center gap-2 rounded-xl border px-2 py-2 transition-colors ${
                    active
                      ? 'border-accent-primary/30 bg-accent-primary/10'
                      : 'border-transparent hover:bg-bg-hover'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectAgent(agent.id);
                      if (flyoutMode) setFlyout('');
                    }}
                    aria-current={active ? 'true' : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="shrink-0 text-base">{agent.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-xs font-medium ${
                        active ? 'text-accent-primary' : 'text-text-primary'
                      }`}>{t(agent.nameKey)}</span>
                      <span className="block truncate text-[10px] text-text-muted">{t(agent.descriptionKey)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(agent.id)}
                    aria-label={t(favorite ? 'assistant.agents.unfavorite' : 'assistant.agents.favorite')}
                    title={t(favorite ? 'assistant.agents.unfavorite' : 'assistant.agents.favorite')}
                    className={`shrink-0 p-1 transition-colors ${
                      favorite
                        ? 'text-amber-400'
                        : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-amber-400'
                    }`}
                  >
                    <Star size={13} fill={favorite ? 'currentColor' : 'none'} />
                  </button>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );

  if (!expanded) {
    return (
      <nav
        aria-label={t('assistant.chat.navigation')}
        className="relative flex w-12 shrink-0 flex-col items-center gap-2 border-r border-border bg-bg-primary/70 py-3"
      >
        <button
          type="button"
          onClick={onNew}
          disabled={busy}
          aria-label={t('assistant.history.new')}
          title={t('assistant.history.new')}
          className="rounded-xl bg-accent-primary p-2 text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Plus size={18} />
        </button>
        {[
          { id: 'conversations', Icon: MessageCircle, title: t('assistant.history.title') },
          { id: 'agents', Icon: Bot, title: t('assistant.agents.title') },
        ].map(({ id, Icon, title }) => (
          <div
            key={id}
            className="relative"
            onMouseEnter={() => showFlyout(id)}
            onMouseLeave={scheduleFlyoutClose}
          >
            <button
              type="button"
              onClick={() => {
                onTabChange(id);
                onExpandedChange(true);
              }}
              aria-label={title}
              title={title}
              className={`rounded-lg p-2 transition-colors ${
                activeTab === id || flyout === id
                  ? 'bg-accent-primary/10 text-accent-primary'
                  : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
              }`}
            >
              <Icon size={17} />
            </button>
            {flyout === id && (
              <div
                className="absolute left-full top-0 z-20 ml-2 flex h-[min(68vh,620px)] w-[300px] flex-col overflow-hidden rounded-2xl border border-border bg-bg-elevated shadow-2xl"
                onMouseEnter={() => showFlyout(id)}
                onMouseLeave={scheduleFlyoutClose}
              >
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    {id === 'agents' ? t('assistant.agents.title') : t('assistant.history.title')}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onTabChange(id);
                      onExpandedChange(true);
                      setFlyout('');
                    }}
                    className="text-[11px] font-semibold text-accent-primary hover:underline"
                  >
                    {t('assistant.agents.open')}
                  </button>
                </div>
                {id === 'agents'
                  ? renderAgents(true)
                  : (
                    <AssistantHistory
                      embedded
                      hideNew
                      sessions={sessions}
                      activeSessionId={activeSessionId}
                      onSelect={(session) => {
                        onSelect(session);
                        setFlyout('');
                      }}
                      onNew={onNew}
                      onRename={onRename}
                      onDelete={onDelete}
                      onExport={onExport}
                      onExportMany={onExportMany}
                      onExportAll={onExportAll}
                      onDeleteMany={onDeleteMany}
                      onClear={onClear}
                      onClose={() => setFlyout('')}
                      busy={busy}
                    />
                  )}
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => onExpandedChange(true)}
          aria-label={t('assistant.agents.expand')}
          title={t('assistant.agents.expand')}
          className="mt-auto rounded-lg p-2 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <ChevronRight size={17} />
        </button>
      </nav>
    );
  }

  return (
    <aside className="flex w-[270px] shrink-0 flex-col border-r border-border bg-bg-primary/60">
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNew}
            disabled={busy}
            className="btn btn-primary btn-sm min-w-0 flex-1 justify-center"
          >
            <Plus size={14} />
            <span className="truncate">{t('assistant.history.new')}</span>
          </button>
          <button
            type="button"
            onClick={() => onExpandedChange(false)}
            aria-label={t('assistant.agents.collapse')}
            title={t('assistant.agents.collapse')}
            className="rounded-lg p-2 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <ChevronLeft size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 rounded-lg bg-bg-primary/60 p-1" role="tablist">
          {[
            ['conversations', t('assistant.chat.discussions')],
            ['agents', t('assistant.agents.title')],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => onTabChange(id)}
              className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                activeTab === id
                  ? 'bg-bg-elevated text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {activeTab === 'agents' ? (
        <div className="flex min-h-0 flex-1 flex-col pt-3">
          {renderAgents()}
        </div>
      ) : (
        <AssistantHistory
          embedded
          hideHeader
          hideNew
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={onSelect}
          onNew={onNew}
          onRename={onRename}
          onDelete={onDelete}
          onExport={onExport}
          onExportMany={onExportMany}
          onExportAll={onExportAll}
          onDeleteMany={onDeleteMany}
          onClear={onClear}
          onClose={() => onExpandedChange(false)}
          busy={busy}
        />
      )}
    </aside>
  );
}
