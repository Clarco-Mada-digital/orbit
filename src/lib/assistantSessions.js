// ---------------------------------------------------------------------------
// Historique des conversations de l'assistant — LOGIQUE PURE.
//
// Une « session » garde une utilisation de l'assistant : la discussion libre
// (plusieurs allers-retours) ou une action rapide (corriger, reformuler,
// résumer) lancée depuis la fenêtre de relecture. Chaque session est rangée
// dans une catégorie (discussion, essentiels, rédaction, analyse, orbit) pour
// que l'historique se parcoure par thème.
//
// Les sessions restent LOCALES : elles ne partent pas dans la synchronisation
// entre machines (voir lib/syncMerge.js), et leur taille est plafonnée pour ne
// pas saturer le stockage du navigateur.
// ---------------------------------------------------------------------------
import { ASSISTANT_COMMANDS } from './assistantCommands.js';

export const MAX_ASSISTANT_SESSIONS = 40;
export const MAX_SESSION_MESSAGES = 30;
export const MAX_SESSION_MESSAGE_LENGTH = 4000;
export const MAX_SESSION_CHARS = 20_000;

export const SESSION_CATEGORIES = ['discussion', 'essentials', 'writing', 'analysis', 'orbit'];

const COMMAND_CATEGORIES = new Map(ASSISTANT_COMMANDS.map((command) => [command.id, command.category]));

// Une action rapide n'a pas de commande saisie : son mode tient lieu de commande.
const MODE_COMMANDS = { correct: 'fix', rewrite: 'rewrite', summarize: 'summarize' };

export function sessionCategory({ mode = 'chat', command = '' } = {}) {
  const commandId = command || MODE_COMMANDS[mode] || '';
  return COMMAND_CATEGORIES.get(commandId) || 'discussion';
}

export function sessionTitle(text, maxLength = 64) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > maxLength * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

export function createAssistantSession({
  mode = 'chat',
  command = '',
  agentId = '',
  text = '',
  now = Date.now(),
  id = '',
} = {}) {
  return {
    id: id || `session-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: sessionTitle(text),
    category: sessionCategory({ mode, command }),
    command: command || '',
    ...(agentId ? { agentId } : {}),
    mode,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (message) =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string'
    )
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, MAX_SESSION_MESSAGE_LENGTH),
      ...(typeof message.command === 'string' && message.command
        ? { command: message.command }
        : {}),
    }))
    .slice(-MAX_SESSION_MESSAGES);
}

// Une session ne doit pas dépasser un budget de caractères : on retire les
// messages les plus anciens, jamais le dernier échange.
function trimToBudget(messages) {
  let total = messages.reduce((sum, message) => sum + message.content.length, 0);
  let start = 0;
  while (total > MAX_SESSION_CHARS && start < messages.length - 1) {
    total -= messages[start].content.length;
    start += 1;
  }
  return messages.slice(start);
}

export function appendSessionMessages(session, messages, { now = Date.now(), command = '' } = {}) {
  if (!session || typeof session.id !== 'string') return null;
  const combined = trimToBudget(
    sanitizeMessages([...(Array.isArray(session.messages) ? session.messages : []), ...messages])
  );
  if (combined.length === 0) return session;
  const nextCommand = command || session.command || '';
  const firstUserText = combined.find((message) => message.role === 'user')?.content || '';
  return {
    ...session,
    title: session.title || sessionTitle(firstUserText),
    category: command ? sessionCategory({ mode: session.mode, command: nextCommand }) : session.category,
    command: nextCommand,
    updatedAt: now,
    messages: combined,
  };
}

export function setSessionTitle(session, title) {
  if (!session) return session;
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean ? { ...session, title: clean } : session;
}

export function sortSessions(sessions) {
  return [...(Array.isArray(sessions) ? sessions : [])]
    .filter((session) => session && typeof session.id === 'string')
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
}

// Insère ou remplace une session, puis ne garde que les plus récentes.
export function upsertAssistantSession(sessions, session) {
  if (!session?.id) return sortSessions(sessions);
  const others = (Array.isArray(sessions) ? sessions : []).filter(
    (item) => item && item.id !== session.id
  );
  return sortSessions([session, ...others]).slice(0, MAX_ASSISTANT_SESSIONS);
}

export function removeAssistantSession(sessions, id) {
  return (Array.isArray(sessions) ? sessions : []).filter((session) => session?.id !== id);
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

// Recherche dans le titre, la commande et le contenu des messages : retrouver
// « facture » dans une ancienne conversation doit fonctionner.
export function filterAssistantSessions(sessions, { query = '', category = '' } = {}) {
  const needle = normalizeSearch(query);
  return sortSessions(sessions).filter((session) => {
    if (category && session.category !== category) return false;
    if (!needle) return true;
    const haystack = [
      session.title,
      session.command,
      ...(Array.isArray(session.messages) ? session.messages.map((message) => message.content) : []),
    ];
    return haystack.some((value) => normalizeSearch(value).includes(needle));
  });
}

function startOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function sessionGroupId(updatedAt, now = Date.now()) {
  const today = startOfDay(now);
  const value = Number(updatedAt) || 0;
  if (value >= today) return 'today';
  if (value >= today - 86_400_000) return 'yesterday';
  if (value >= today - 6 * 86_400_000) return 'week';
  if (value >= today - 29 * 86_400_000) return 'month';
  return 'older';
}

export const SESSION_GROUPS = ['today', 'yesterday', 'week', 'month', 'older'];

export function groupAssistantSessions(sessions, now = Date.now()) {
  const buckets = new Map(SESSION_GROUPS.map((id) => [id, []]));
  for (const session of sortSessions(sessions)) {
    const groupId = sessionGroupId(session.updatedAt, now);
    buckets.get(groupId).push(session);
  }
  return SESSION_GROUPS
    .filter((id) => buckets.get(id).length > 0)
    .map((id) => ({ id, sessions: buckets.get(id) }));
}

export function countSessionsByCategory(sessions) {
  const counts = Object.fromEntries(SESSION_CATEGORIES.map((id) => [id, 0]));
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (session && Object.hasOwn(counts, session.category)) counts[session.category] += 1;
  }
  return counts;
}
