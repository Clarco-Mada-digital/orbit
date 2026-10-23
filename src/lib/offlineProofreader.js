const sharedRules = [
  {
    id: 'repeated-space',
    pattern: /[ \t]{2,}/g,
    message: {
      fr: 'Espaces répétés',
      en: 'Repeated spaces',
    },
    replace: () => ' ',
  },
  {
    id: 'space-before-punctuation',
    pattern: /[ \t]+([,.;])/g,
    message: {
      fr: 'Pas d’espace avant une virgule ou un point',
      en: 'Remove the space before this punctuation mark',
    },
    replace: (_match, punctuation) => punctuation,
  },
  {
    id: 'repeated-word',
    pattern: /(?<![\p{L}\p{N}_])(\p{L}{2,})[ \t]+\1(?![\p{L}\p{N}_])/giu,
    message: {
      fr: 'Mot répété',
      en: 'Repeated word',
    },
    replace: () => '',
    startOffset: (_match, word) => word.length,
  },
];

const frenchConjugations = [
  { id: 'être', forms: { je: 'suis', tu: 'es', singular: 'est', nous: 'sommes', vous: 'êtes', plural: 'sont' } },
  { id: 'avoir', forms: { je: 'ai', tu: 'as', singular: 'a', nous: 'avons', vous: 'avez', plural: 'ont' } },
  { id: 'aller', forms: { je: 'vais', tu: 'vas', singular: 'va', nous: 'allons', vous: 'allez', plural: 'vont' } },
  { id: 'faire', forms: { je: 'fais', tu: 'fais', singular: 'fait', nous: 'faisons', vous: 'faites', plural: 'font' } },
  { id: 'dire', forms: { je: 'dis', tu: 'dis', singular: 'dit', nous: 'disons', vous: 'dites', plural: 'disent' } },
  { id: 'pouvoir', forms: { je: 'peux', tu: 'peux', singular: 'peut', nous: 'pouvons', vous: 'pouvez', plural: 'peuvent' } },
  { id: 'vouloir', forms: { je: 'veux', tu: 'veux', singular: 'veut', nous: 'voulons', vous: 'voulez', plural: 'veulent' } },
  { id: 'venir', forms: { je: 'viens', tu: 'viens', singular: 'vient', nous: 'venons', vous: 'venez', plural: 'viennent' } },
  { id: 'prendre', forms: { je: 'prends', tu: 'prends', singular: 'prend', nous: 'prenons', vous: 'prenez', plural: 'prennent' } },
  { id: 'mettre', forms: { je: 'mets', tu: 'mets', singular: 'met', nous: 'mettons', vous: 'mettez', plural: 'mettent' } },
  { id: 'savoir', forms: { je: 'sais', tu: 'sais', singular: 'sait', nous: 'savons', vous: 'savez', plural: 'savent' } },
  { id: 'voir', forms: { je: 'vois', tu: 'vois', singular: 'voit', nous: 'voyons', vous: 'voyez', plural: 'voient' } },
  { id: 'devoir', forms: { je: 'dois', tu: 'dois', singular: 'doit', nous: 'devons', vous: 'devez', plural: 'doivent' } },
];

const frenchSubjectPronouns = {
  je: 'je',
  tu: 'tu',
  singular: '(?:il|elle|on)',
  nous: 'nous',
  vous: 'vous',
  plural: '(?:ils|elles)',
};

function createFrenchConjugationRules() {
  return frenchConjugations.flatMap(({ id, forms }) => Object.entries(frenchSubjectPronouns)
    .flatMap(([person, pronoun]) => {
      const correct = forms[person];
      const incorrectForms = [...new Set(Object.values(forms))]
        .filter((form) => form !== correct);
      if (!incorrectForms.length) return [];
      return [{
        id: `conjugation-${id}-${person}`,
        pattern: new RegExp(`\\b(${pronoun})\\s+(${incorrectForms.join('|')})\\b`, 'giu'),
        message: `La conjugaison de « ${id} » ne s’accorde pas avec ce sujet.`,
        replace: (_match, subject) => `${subject} ${correct}`,
      }];
    }));
}

const frenchRegularErStems = [
  'parl', 'aim', 'travaill', 'demand', 'regard', 'utilis', 'pens', 'jou',
  'mang', 'donn', 'rest', 'arriv', 'pass', 'achet', 'chang', 'continu',
];

function createFrenchRegularErRules() {
  return frenchRegularErStems.flatMap((stem) => [
    {
      id: `conjugation-er-tu-${stem}`,
      pattern: new RegExp(`\\b(tu)\\s+(${stem}e)\\b`, 'giu'),
      message: 'Avec « tu », ce verbe prend la terminaison « -es » au présent.',
      replace: (_match, subject, verb) => `${subject} ${verb}s`,
    },
    {
      id: `conjugation-er-singular-${stem}`,
      pattern: new RegExp(`\\b((?:il|elle|on))\\s+(${stem}es)\\b`, 'giu'),
      message: 'Avec « il », « elle » ou « on », ce verbe prend la terminaison « -e » au présent.',
      replace: (_match, subject, verb) => `${subject} ${verb.slice(0, -1)}`,
    },
    {
      id: `conjugation-er-plural-${stem}`,
      pattern: new RegExp(`\\b((?:ils|elles))\\s+(${stem}(?:e|es))\\b`, 'giu'),
      message: 'Avec « ils » ou « elles », ce verbe prend la terminaison « -ent » au présent.',
      replace: (_match, subject, verb) => `${subject} ${verb.slice(0, verb.endsWith('es') ? -2 : -1)}ent`,
    },
  ]);
}

const frenchPastParticiples = {
  être: 'été',
  avoir: 'eu',
  faire: 'fait',
  prendre: 'pris',
  mettre: 'mis',
  voir: 'vu',
  pouvoir: 'pu',
  vouloir: 'voulu',
  devoir: 'dû',
  dire: 'dit',
  écrire: 'écrit',
  lire: 'lu',
  boire: 'bu',
  savoir: 'su',
  venir: 'venu',
  partir: 'parti',
  ouvrir: 'ouvert',
  finir: 'fini',
  choisir: 'choisi',
  répondre: 'répondu',
};

const frenchAvoirAuxiliaries = '(?:ai|as|a|avons|avez|ont)';

const languageRules = {
  fr: [
    ...createFrenchConjugationRules(),
    ...createFrenchRegularErRules(),
    {
      id: 'auxiliary-infinitive-er',
      pattern: new RegExp(`\\b(${frenchAvoirAuxiliaries})\\s+(?!aller\\b)(\\p{L}+er)\\b`, 'giu'),
      message: 'Après cet auxiliaire, on emploie le participe passé et non l’infinitif.',
      replace: (_match, auxiliary, infinitive) => `${auxiliary} ${infinitive.slice(0, -2)}é`,
    },
    ...Object.entries(frenchPastParticiples).map(([infinitive, participle]) => ({
      id: `auxiliary-infinitive-${infinitive}`,
      pattern: new RegExp(`\\b(${frenchAvoirAuxiliaries})\\s+(${infinitive})\\b`, 'giu'),
      message: 'Après cet auxiliaire, on emploie le participe passé et non l’infinitif.',
      replace: (_match, auxiliary) => `${auxiliary} ${participle}`,
    })),
    {
      id: 'ca-va',
      pattern: /\b(?:sa|ca)\s+(va|marche|fonctionne|passe)\b/giu,
      message: 'Dans cette expression, « ça » prend une cédille.',
      replace: (_match, verb) => `ça ${verb}`,
    },
    {
      id: 'jai-ete',
      pattern: /\b(j['’]ai|tu as|il a|elle a|on a|nous avons|vous avez|ils ont|elles ont)\s+était\b/giu,
      message: 'Après « avoir », on écrit le participe passé « été ».',
      replace: (_match, subject) => `${subject} été`,
    },
    {
      id: 'ils-on',
      pattern: /\b(ils|elles)\s+on(?=\s|$)/giu,
      message: 'Avec « ils » ou « elles », le verbe « avoir » s’écrit « ont ».',
      replace: (_match, subject) => `${subject} ont`,
    },
    {
      id: 'ils-son',
      pattern: /\b(ils|elles)\s+son(?=\s|$)/giu,
      message: 'Avec « ils » ou « elles », le verbe « être » s’écrit « sont ».',
      replace: (_match, subject) => `${subject} sont`,
    },
    {
      id: 'nous-somme',
      pattern: /\b(nous)\s+somme\b/giu,
      message: 'Avec « nous », le verbe « être » s’écrit « sommes ».',
      replace: (_match, subject) => `${subject} sommes`,
    },
    {
      id: 'a-versus-a-grave',
      pattern: /(?<![\p{L}\p{N}_])(il|elle|on)\s+à(?![\p{L}\p{N}_])/giu,
      message: 'Le verbe « avoir » s’écrit « a » sans accent.',
      replace: (_match, subject) => `${subject} a`,
    },
    {
      id: 'beaucoup',
      pattern: /\bbeaucoups\b/giu,
      message: '« Beaucoup » ne prend pas de s.',
      replace: () => 'beaucoup',
    },
    {
      id: 'parmi',
      pattern: /\bparmis\b/giu,
      message: '« Parmi » ne prend pas de s.',
      replace: () => 'parmi',
    },
    {
      id: 'accueillir',
      pattern: /\bacceuillir\b/giu,
      message: 'La graphie correcte est « accueillir ».',
      replace: () => 'accueillir',
    },
    {
      id: 'french-punctuation-space',
      pattern: /([^\s\d])([!?;:])(?=\s|$)/gu,
      message: 'En français, une espace insécable précède ce signe.',
      replace: (_match, _before, punctuation) => `\u00a0${punctuation}`,
      startOffset: (_match, before) => before.length,
    },
  ],
  en: [
    {
      id: 'your-welcome',
      pattern: /\byour\s+welcome\b/giu,
      message: 'The expression is “you’re welcome”.',
      replace: () => "you're welcome",
    },
    {
      id: 'their-is',
      pattern: /\btheir\s+(is|are)\b/giu,
      message: 'Use “there” to introduce this sentence.',
      replace: (_match, verb) => `there ${verb}`,
    },
    {
      id: 'could-of',
      pattern: /\b(could|should|would)\s+of\b/giu,
      message: 'Use “have” after this modal verb.',
      replace: (_match, verb) => `${verb} have`,
    },
    {
      id: 'a-lot',
      pattern: /\balot\b/giu,
      message: '“A lot” is written as two words.',
      replace: () => 'a lot',
    },
  ],
};

function matchCase(source, replacement) {
  if (!replacement) return replacement;
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] && source[0] === source[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function findRuleIssues(text, rules, language) {
  const issues = [];
  for (const rule of rules) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (const match of text.matchAll(pattern)) {
      const source = match[0];
      const start = match.index + (rule.startOffset?.(source, ...match.slice(1)) || 0);
      const original = source.slice(start - match.index);
      const replacement = matchCase(
        original,
        rule.replace(source, ...match.slice(1))
      );
      if (replacement === original) continue;

      issues.push({
        id: `${rule.id}:${start}`,
        ruleId: rule.id,
        start,
        end: start + original.length,
        original,
        replacement,
        message: typeof rule.message === 'string' ? rule.message : rule.message[language],
      });
    }
  }
  return issues;
}

export function analyzeText(text, language = 'fr') {
  if (typeof text !== 'string' || !text) return [];
  if (language !== 'fr' && language !== 'en') {
    throw new RangeError(`Unsupported proofreading language: ${language}`);
  }

  const found = [
    ...findRuleIssues(text, sharedRules, language),
    ...findRuleIssues(text, languageRules[language], language),
  ].sort((a, b) => a.start - b.start || b.end - a.end);

  const issues = [];
  let previousEnd = -1;
  for (const issue of found) {
    if (issue.start < previousEnd) continue;
    issues.push(issue);
    previousEnd = issue.end;
  }
  return issues;
}

export function applyIssues(text, issues, selectedIds) {
  if (typeof text !== 'string' || !Array.isArray(issues) || !(selectedIds instanceof Set)) {
    throw new TypeError('Invalid proofreading input');
  }

  const selected = issues
    .filter((issue) => selectedIds.has(issue.id))
    .sort((a, b) => b.start - a.start);
  let result = text;
  for (const issue of selected) {
    if (
      !Number.isInteger(issue.start) ||
      !Number.isInteger(issue.end) ||
      issue.start < 0 ||
      issue.end > result.length ||
      result.slice(issue.start, issue.end) !== issue.original
    ) {
      throw new RangeError('Proofreading issue does not match the source text');
    }
    result = result.slice(0, issue.start) + issue.replacement + result.slice(issue.end);
  }
  return result;
}
