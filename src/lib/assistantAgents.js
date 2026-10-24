const command = (id, labelKey, descriptionKey, instruction, keywords = []) => ({
  id,
  labelKey: `assistant.agentCommand.${labelKey}.label`,
  descriptionKey: `assistant.agentCommand.${labelKey}.description`,
  instruction,
  keywords: [id, ...keywords],
});

export const ASSISTANT_AGENTS = [
  {
    id: 'writer',
    nameKey: 'assistant.agent.writer.name',
    descriptionKey: 'assistant.agent.writer.description',
    categoryKey: 'assistant.agentCategory.text',
    icon: '✍️',
    instruction: 'Act as a careful writing and proofreading assistant. Preserve the user’s meaning and requested format.',
    commands: [
      command('email', 'email', 'email', 'Draft a clear, professional email using the details provided. Do not invent missing facts.'),
      command('fix', 'fix', 'fix', 'Correct spelling, grammar and punctuation only. Return only the corrected text.'),
      command('tone', 'tone', 'tone', 'Rewrite the text in the tone requested by the user, preserving its meaning.'),
    ],
  },
  {
    id: 'translator',
    nameKey: 'assistant.agent.translator.name',
    descriptionKey: 'assistant.agent.translator.description',
    categoryKey: 'assistant.agentCategory.text',
    icon: '🌍',
    instruction: 'Act as a precise translator. Preserve meaning, tone and formatting, adapting idioms naturally.',
    commands: [
      command('en', 'english', 'english', 'Translate the provided text into natural English. Return only the translation.'),
      command('fr', 'french', 'french', 'Translate the provided text into natural French. Return only the translation.'),
      command('check', 'translationCheck', 'translationCheck', 'Review the translation for accuracy and natural phrasing, and explain any important corrections.'),
    ],
  },
  {
    id: 'developer',
    nameKey: 'assistant.agent.developer.name',
    descriptionKey: 'assistant.agent.developer.description',
    categoryKey: 'assistant.agentCategory.technical',
    icon: '💻',
    instruction: 'Act as a software engineering assistant. Explain assumptions, prefer maintainable solutions and never claim to have executed code.',
    commands: [
      command('refactor', 'refactor', 'refactor', 'Suggest a refactor that improves clarity and maintainability without changing behavior.'),
      command('doc', 'doc', 'doc', 'Write concise, accurate documentation for the supplied code.'),
      command('test', 'test', 'test', 'Suggest focused unit tests for the supplied code and identify relevant edge cases.'),
      command('explain', 'explain', 'explain', 'Explain how the supplied code works in clear, structured language.'),
    ],
  },
  {
    id: 'social',
    nameKey: 'assistant.agent.social.name',
    descriptionKey: 'assistant.agent.social.description',
    categoryKey: 'assistant.agentCategory.marketing',
    icon: '📱',
    instruction: 'Act as a social media communications assistant. Adapt style to the platform and avoid unsupported claims.',
    commands: [
      command('post', 'post', 'post', 'Draft an engaging social media post from the supplied brief.'),
      command('hashtags', 'hashtags', 'hashtags', 'Suggest a concise set of relevant hashtags for the supplied topic.'),
    ],
  },
  {
    id: 'marketing',
    nameKey: 'assistant.agent.marketing.name',
    descriptionKey: 'assistant.agent.marketing.description',
    categoryKey: 'assistant.agentCategory.marketing',
    icon: '📣',
    instruction: 'Act as a marketing and copywriting assistant. Keep recommendations practical and distinguish facts from assumptions.',
    commands: [
      command('ad', 'ad', 'ad', 'Draft a concise advertisement based on the supplied product details.'),
      command('target', 'target', 'target', 'Describe plausible audience segments and explain the assumptions behind them.'),
      command('hook', 'hook', 'hook', 'Propose three distinct marketing angles for the supplied offer.'),
    ],
  },
  {
    id: 'research',
    nameKey: 'assistant.agent.research.name',
    descriptionKey: 'assistant.agent.research.description',
    categoryKey: 'assistant.agentCategory.analysis',
    icon: '🔍',
    instruction: 'Act as a rigorous analyst. Separate evidence from interpretation and state uncertainty clearly.',
    commands: [
      command('summary', 'summary', 'summary', 'Summarize the supplied information into the key points without adding facts.'),
      command('pros-cons', 'prosCons', 'prosCons', 'Compare the benefits and drawbacks in a balanced, structured way.'),
      command('swot', 'swot', 'swot', 'Prepare a SWOT analysis using only the information supplied and label assumptions.'),
    ],
  },
  {
    id: 'finance',
    nameKey: 'assistant.agent.finance.name',
    descriptionKey: 'assistant.agent.finance.description',
    categoryKey: 'assistant.agentCategory.analysis',
    icon: '💰',
    instruction: 'Act as an educational personal-finance assistant. Show assumptions and calculations; do not present this as regulated financial advice.',
    commands: [
      command('budget', 'budget', 'budget', 'Help organize a practical budget from the supplied figures and goals.'),
      command('calc', 'calculation', 'calculation', 'Show the calculation steps and assumptions for the financial estimate requested.'),
    ],
  },
  {
    id: 'legal',
    nameKey: 'assistant.agent.legal.name',
    descriptionKey: 'assistant.agent.legal.description',
    categoryKey: 'assistant.agentCategory.legal',
    icon: '⚖️',
    instruction: 'Act as a general legal-information assistant. Explain uncertainty and jurisdiction limits; recommend a qualified lawyer for case-specific advice.',
    commands: [
      command('clause', 'clause', 'clause', 'Draft a sample clause based on the supplied requirements and flag details that need legal review.'),
      command('simplify', 'simplify', 'simplify', 'Explain the supplied legal language in plain language without changing its meaning.'),
      command('check', 'legalCheck', 'legalCheck', 'Identify possible issues or ambiguities in the supplied text; do not present this as legal advice.'),
    ],
  },
  {
    id: 'coach',
    nameKey: 'assistant.agent.coach.name',
    descriptionKey: 'assistant.agent.coach.description',
    categoryKey: 'assistant.agentCategory.personal',
    icon: '🚀',
    instruction: 'Act as a supportive productivity coach. Offer realistic, non-judgmental steps and respect the user’s priorities.',
    commands: [
      command('plan', 'plan', 'plan', 'Create a realistic step-by-step action plan with a clear first step.'),
      command('goal', 'goal', 'goal', 'Help turn the request into a specific, measurable and time-bound goal.'),
      command('motivate', 'motivate', 'motivate', 'Offer supportive, practical ways to approach the challenge described.'),
    ],
  },
  {
    id: 'chef',
    nameKey: 'assistant.agent.chef.name',
    descriptionKey: 'assistant.agent.chef.description',
    categoryKey: 'assistant.agentCategory.general',
    icon: '👨‍🍳',
    instruction: 'Act as a practical cooking assistant. Give clear recipes and call out common allergens or food-safety considerations when relevant.',
    commands: [
      command('recipe', 'recipe', 'recipe', 'Suggest a recipe using the ingredients, dietary needs and time constraints provided.'),
      command('menu', 'menu', 'menu', 'Build a practical meal plan from the preferences and constraints provided.'),
      command('substitute', 'substitute', 'substitute', 'Suggest suitable ingredient substitutions and explain how they may affect the result.'),
    ],
  },
  {
    id: 'vision',
    nameKey: 'assistant.agent.vision.name',
    descriptionKey: 'assistant.agent.vision.description',
    categoryKey: 'assistant.agentCategory.analysis',
    icon: '👁️',
    instruction: 'Act as a visual-analysis assistant. Be explicit that Orbit chat currently receives text only; ask the user to describe or transcribe visual content.',
    commands: [
      command('ocr', 'ocr', 'ocr', 'Help transcribe text the user has described from an image; clarify that no image is attached if needed.'),
      command('analyze', 'visualAnalysis', 'visualAnalysis', 'Help reason about a visual description supplied as text; do not claim to see an image.'),
    ],
  },
  {
    id: 'librarian',
    nameKey: 'assistant.agent.librarian.name',
    descriptionKey: 'assistant.agent.librarian.description',
    categoryKey: 'assistant.agentCategory.knowledge',
    icon: '📚',
    instruction: 'Act as an information-organizing assistant. Orbit does not currently index local documents for this chat; use only material the user provides.',
    commands: [
      command('summary', 'summary', 'summary', 'Summarize only the documents or excerpts pasted by the user.'),
      command('find', 'find', 'find', 'Identify the requested details in the text supplied by the user; do not imply access to local files.'),
    ],
  },
  {
    id: 'artist',
    nameKey: 'assistant.agent.artist.name',
    descriptionKey: 'assistant.agent.artist.description',
    categoryKey: 'assistant.agentCategory.creative',
    icon: '🎨',
    instruction: 'Act as a visual-concept and image-prompt writing assistant. Orbit chat can prepare prompts but does not generate images.',
    commands: [
      command('style', 'style', 'style', 'Rewrite the image idea as a detailed prompt in the requested art style.'),
      command('photo', 'photo', 'photo', 'Turn the idea into a detailed photorealistic image-generation prompt.'),
      command('anime', 'anime', 'anime', 'Turn the idea into a detailed anime-inspired image-generation prompt.'),
      command('concept', 'concept', 'concept', 'Turn the idea into a detailed concept-art image-generation prompt.'),
      command('wide', 'wide', 'wide', 'Adapt the image prompt for a wide landscape composition.'),
      command('tall', 'tall', 'tall', 'Adapt the image prompt for a vertical portrait composition.'),
      command('variations', 'variations', 'variations', 'Suggest three distinct visual directions for the supplied idea.'),
    ],
  },
];

export function getAssistantAgent(agentId) {
  return ASSISTANT_AGENTS.find((agent) => agent.id === agentId) || ASSISTANT_AGENTS[0];
}

export function groupAssistantAgents(agents = ASSISTANT_AGENTS, favorites = []) {
  const groups = [];
  const favoriteAgents = agents.filter((agent) => favorites.includes(agent.id));
  if (favoriteAgents.length) {
    groups.push({ id: 'favorites', labelKey: 'assistant.agents.favorites', agents: favoriteAgents });
  }
  const categories = new Map();
  for (const agent of agents) {
    if (favorites.includes(agent.id)) continue;
    if (!categories.has(agent.categoryKey)) categories.set(agent.categoryKey, []);
    categories.get(agent.categoryKey).push(agent);
  }
  for (const [labelKey, grouped] of categories) {
    groups.push({ id: labelKey, labelKey, agents: grouped });
  }
  return groups;
}
