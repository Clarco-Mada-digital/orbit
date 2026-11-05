// ---------------------------------------------------------------------------
// Données sensibles dans une capture — LOGIQUE PURE.
//
// Partager une capture d'écran, c'est partager ce qu'on n'avait pas vu : une
// adresse e-mail dans un en-tête, un IBAN dans un tableau, un numéro de carte
// dans un formulaire. Orbit les repère DANS LA PAGE (là où le texte est encore
// du texte, avec ses coordonnées) et propose de les masquer d'un clic.
//
// Les motifs sont définis ici une seule fois : le processus principal les
// sérialise dans le script qu'il injecte dans la page, et `node --test` les
// vérifie sans navigateur. Ils restent volontairement conservateurs — un faux
// positif masque un morceau utile de la capture, et l'utilisateur garde la main
// (chaque zone proposée est une forme comme une autre, annulable).
// ---------------------------------------------------------------------------

// `source` est une chaîne : elle doit survivre à `JSON.stringify` pour partir
// dans le script injecté.
export const SENSITIVE_PATTERNS = [
  {
    kind: 'email',
    label: 'Adresse e-mail',
    source: '[\\w.+-]+@[\\w-]+\\.[\\w.-]{2,}',
    flags: 'g',
  },
  {
    kind: 'iban',
    // Deux lettres de pays, deux chiffres de contrôle, puis 11 à 30 caractères
    // alphanumériques, espaces autorisés par groupes de quatre.
    label: 'IBAN',
    source: '\\b[A-Z]{2}\\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\\b',
    flags: 'g',
  },
  {
    kind: 'card',
    // 13 à 19 chiffres en groupes : la validation de Luhn est faite ensuite,
    // sinon toute référence de commande serait masquée.
    label: 'Numéro de carte',
    source: '\\b(?:\\d[ -]?){12,18}\\d\\b',
    flags: 'g',
  },
  {
    kind: 'phone',
    label: 'Numéro de téléphone',
    source: '(?:\\+\\d{1,3}[ .-]?)?(?:\\(\\d{1,4}\\)[ .-]?)?\\d(?:[ .-]?\\d){7,12}\\b',
    flags: 'g',
  },
];

// Clé de Luhn — ce qui distingue un numéro de carte d'une suite de chiffres.
export function looksLikeCardNumber(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum > 0 && sum % 10 === 0;
}

// Un IBAN se vérifie aussi (modulo 97), ce qui écarte les immatriculations et
// les références qui commencent par deux lettres.
export function looksLikeIban(value) {
  const compact = String(value || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    const part = code >= 65 ? String(code - 55) : char; // A→10 … Z→35
    for (const digit of part) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

// Un « numéro de téléphone » n'en est un que s'il a assez de chiffres et pas
// trop : sans ça, une année, un prix ou un identifiant seraient masqués.
export function looksLikePhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

export function sensitiveMatchIsValid(kind, value) {
  if (kind === 'card') return looksLikeCardNumber(value);
  if (kind === 'iban') return looksLikeIban(value);
  if (kind === 'phone') return looksLikePhone(value);
  return Boolean(String(value || '').trim());
}

// Occurrences sensibles d'un texte, position comprise (indispensable pour
// retrouver ensuite le rectangle correspondant dans la page).
export function findSensitiveMatches(text) {
  const value = String(text || '');
  if (!value.trim()) return [];
  const found = [];
  for (const pattern of SENSITIVE_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(value)) !== null) {
      if (!match[0]) {
        regex.lastIndex += 1;
        continue;
      }
      if (!sensitiveMatchIsValid(pattern.kind, match[0])) continue;
      found.push({ kind: pattern.kind, value: match[0], start: match.index, end: match.index + match[0].length });
    }
  }
  // Une adresse e-mail contient parfois une suite de chiffres : on garde la
  // correspondance la plus LONGUE quand deux se chevauchent, et on trie pour
  // que le résultat soit stable.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const match of found) {
    const previous = kept[kept.length - 1];
    if (previous && match.start < previous.end) continue;
    kept.push(match);
  }
  return kept;
}

// Rectangles mesurés dans la page (pixels CSS) → pixels de l'image capturée.
//
// L'échelle n'est pas devinée à partir du zoom et de la densité d'écran (deux
// sources d'erreur, et un masque mal placé est PIRE que pas de masque) : elle
// est mesurée, en comparant la largeur de l'image produite à celle que la page
// a rapportée.
export function scaleSensitiveRects(rects, pageWidth, imageWidth) {
  const page = Number(pageWidth) || 0;
  const image = Number(imageWidth) || 0;
  if (!page || !image) return [];
  const scale = image / page;
  return (Array.isArray(rects) ? rects : [])
    .map((rect) => ({
      kind: String(rect?.kind || 'unknown'),
      x: Math.max(0, Math.round((Number(rect?.x) || 0) * scale)),
      y: Math.max(0, Math.round((Number(rect?.y) || 0) * scale)),
      width: Math.round((Number(rect?.width) || 0) * scale),
      height: Math.round((Number(rect?.height) || 0) * scale),
    }))
    // Une zone de moins de 4 px n'est pas du texte lisible : la masquer
    // n'apporte rien et trahirait une mesure fausse.
    .filter((rect) => rect.width >= 4 && rect.height >= 4);
}
