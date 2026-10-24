// Commandes saisies dans la discussion IA avec le préfixe « / ».
//
// Chaque commande est une consigne ajoutée au prompt système : elle ne change
// pas le fournisseur ni le mode de la fenêtre, elle cadre simplement la
// réponse demandée (corriger, résumer, traduire…). Les libellés affichés sont
// des clés i18n pour rester traduisibles.

export const ASSISTANT_COMMAND_CATEGORIES = [
  { id: 'essentials', labelKey: 'assistant.commands.category.essentials' },
  { id: 'writing', labelKey: 'assistant.commands.category.writing' },
  { id: 'analysis', labelKey: 'assistant.commands.category.analysis' },
  { id: 'orbit', labelKey: 'assistant.commands.category.orbit' },
];

export const ASSISTANT_COMMANDS = [
  {
    id: 'chat',
    category: 'essentials',
    labelKey: 'assistant.commands.chat.label',
    descriptionKey: 'assistant.commands.chat.description',
    keywords: ['discussion', 'discuter', 'question', 'chat', 'conversation'],
    instruction: 'Answer the user normally, without applying a special formatting task.',
  },
  {
    id: 'fix',
    category: 'essentials',
    labelKey: 'assistant.commands.fix.label',
    descriptionKey: 'assistant.commands.fix.description',
    keywords: ['corriger', 'correction', 'orthographe', 'grammaire', 'fix', 'correct', 'spelling'],
    instruction:
      'Correct spelling, grammar and punctuation in the user text. Preserve the meaning, tone and every fact. Return only the corrected text unless the user asks for explanations.',
  },
  {
    id: 'rewrite',
    category: 'essentials',
    labelKey: 'assistant.commands.rewrite.label',
    descriptionKey: 'assistant.commands.rewrite.description',
    keywords: ['reformuler', 'reformulation', 'rewrite', 'paraphrase', 'ameliorer'],
    instruction:
      'Rewrite the user text to be clearer and more natural while preserving every fact and intention. Return only the rewritten text unless the user asks otherwise.',
  },
  {
    id: 'summarize',
    category: 'essentials',
    labelKey: 'assistant.commands.summarize.label',
    descriptionKey: 'assistant.commands.summarize.description',
    keywords: ['resumer', 'resume', 'synthese', 'summarize', 'summary', 'condense'],
    instruction:
      'Summarize the user text concisely, keeping the important facts. Do not invent information that is not present.',
  },
  {
    id: 'email',
    category: 'writing',
    labelKey: 'assistant.commands.email.label',
    descriptionKey: 'assistant.commands.email.description',
    keywords: ['email', 'mail', 'courriel', 'message', 'rediger', 'write'],
    instruction:
      'Help the user write a clear, professional email or message. Use placeholders when key details are missing, and keep it ready to send.',
  },
  {
    id: 'reply',
    category: 'writing',
    labelKey: 'assistant.commands.reply.label',
    descriptionKey: 'assistant.commands.reply.description',
    keywords: ['repondre', 'reponse', 'reply', 'answer', 'message'],
    instruction:
      'Draft a reply to the message provided by the user. Match the context and tone, and keep the reply concise.',
  },
  {
    id: 'ideas',
    category: 'writing',
    labelKey: 'assistant.commands.ideas.label',
    descriptionKey: 'assistant.commands.ideas.description',
    keywords: ['idee', 'idees', 'brainstorm', 'suggestions', 'inspiration'],
    instruction:
      'Offer a short, practical list of concrete ideas or options for the user request. Avoid filler and explain each idea in one line.',
  },
  {
    id: 'explain',
    category: 'analysis',
    labelKey: 'assistant.commands.explain.label',
    descriptionKey: 'assistant.commands.explain.description',
    keywords: ['expliquer', 'explication', 'explain', 'definition', 'comprendre'],
    instruction:
      'Explain the topic or text provided by the user in plain language. Add a short example when it helps understanding.',
  },
  {
    id: 'translate',
    category: 'analysis',
    labelKey: 'assistant.commands.translate.label',
    descriptionKey: 'assistant.commands.translate.description',
    keywords: ['traduire', 'traduction', 'translate', 'translation', 'langue'],
    instruction:
      'Translate the user text. If no target language is given, translate French to English or English to French based on the source language. Return only the translation.',
  },
  {
    id: 'orbit',
    category: 'orbit',
    labelKey: 'assistant.commands.orbit.label',
    descriptionKey: 'assistant.commands.orbit.description',
    keywords: ['orbit', 'aide', 'help', 'reglages', 'settings', 'fonctionnalites'],
    instruction:
      'Help the user with Orbit features such as profiles, apps, split screen, shortcuts, privacy and AI settings. Do not claim to perform an action; propose steps the user can confirm.',
  },
];

const COMMAND_INPUT = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/i;

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

export function getAssistantCommand(commandId) {
  if (typeof commandId !== 'string') return null;
  const id = commandId.trim().toLocaleLowerCase();
  return ASSISTANT_COMMANDS.find((command) => command.id === id) || null;
}

// « /fix Bonjour » → { command: fix, text: 'Bonjour' }.
// Une commande inconnue (ou un simple « / ») reste un message normal : on ne
// veut surtout pas avaler un chemin ou un texte qui commence par un slash.
export function parseAssistantCommand(input, commands = ASSISTANT_COMMANDS) {
  const raw = typeof input === 'string' ? input : '';
  const match = COMMAND_INPUT.exec(raw.trimStart());
  if (!match) return { command: null, text: raw.trim() };
  const id = match[1].trim().toLocaleLowerCase();
  const command = commands.find((item) => item.id === id) || null;
  if (!command) return { command: null, text: raw.trim() };
  return { command, text: (match[2] || '').trim() };
}

export function filterAssistantCommands(query, commands = ASSISTANT_COMMANDS) {
  const needle = normalizeSearch(query);
  if (!needle) return commands;
  return commands.filter((command) => (
    command.id.startsWith(needle) ||
    command.keywords.some((keyword) => normalizeSearch(keyword).startsWith(needle))
  ));
}
