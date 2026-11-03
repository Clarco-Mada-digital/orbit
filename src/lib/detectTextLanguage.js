const TOKENS = {
  fr: new Set([
    'alors', 'avec', 'bonjour', 'car', 'ce', 'ces', 'comme', 'dans', 'des',
    'elle', 'elles', 'est', 'et', 'eux', 'il', 'ils', 'je', 'la', 'le', 'les',
    'mais', 'mes', 'mon', 'nous', 'on', 'ou', 'par', 'pas', 'pour', 'que',
    'qui', 'sa', 'se', 'son', 'sur', 'tu', 'un', 'une', 'vous', 'votre',
  ]),
  en: new Set([
    'about', 'after', 'all', 'and', 'are', 'as', 'at', 'be', 'but', 'can',
    'am', 'do', 'for', 'from', 'have', 'he', 'her', 'here', 'his', 'how', 'i',
    'if', 'in', 'is', 'it', 'me', 'my', 'need', 'of', 'on', 'or', 'our',
    'please', 'she', 'that', 'the',
    'their', 'them', 'there', 'they', 'this', 'to', 'was', 'we', 'were',
    'what', 'when', 'which', 'who', 'will', 'with', 'you', 'your', 'help',
  ]),
};

const FRENCH_MARKERS = /[àâçéèêëîïôùûüÿœæ]/iu;

export function detectTextLanguage(text, fallback = 'fr') {
  const source = String(text || '').toLocaleLowerCase();
  const words = source.match(/\p{L}+/gu) || [];
  if (words.length < 2) return fallback;

  const scores = {
    fr: words.reduce((score, word) => score + Number(TOKENS.fr.has(word)), 0),
    en: words.reduce((score, word) => score + Number(TOKENS.en.has(word)), 0),
  };
  if (FRENCH_MARKERS.test(source)) scores.fr += 2;

  const winner = scores.fr > scores.en ? 'fr' : scores.en > scores.fr ? 'en' : fallback;
  const confidence = Math.abs(scores.fr - scores.en);
  return confidence >= 2 ? winner : fallback;
}
