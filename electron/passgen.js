// Génération de mots de passe et de phrases de passe.
//
// Isolé de vault.js : ne dépend QUE de `crypto` (aucune API Electron), donc
// testable en Node pur — c'est du code sécurité, il mérite des tests.

import crypto from 'node:crypto';

const SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz', // sans « l »
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // sans « I », « O »
  digits: '23456789', // sans « 0 », « 1 »
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
};
const ALL = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
};

// Tirage uniforme sans biais modulo (rejet des valeurs hors plage).
function pick(alphabet) {
  const max = 256 - (256 % alphabet.length);
  let byte;
  do {
    byte = crypto.randomBytes(1)[0];
  } while (byte >= max);
  return alphabet[byte % alphabet.length];
}

export function generatePassword(opts = {}) {
  const length = Math.min(128, Math.max(8, Number(opts.length) || 20));
  const readable = opts.readable !== false; // évite l1I0O par défaut
  const src = readable ? SETS : ALL;
  const groups = [];
  if (opts.lower !== false) groups.push(src.lower);
  if (opts.upper !== false) groups.push(src.upper);
  if (opts.digits !== false) groups.push(src.digits);
  if (opts.symbols) groups.push(src.symbols);
  if (groups.length === 0) groups.push(src.lower);

  // Un caractère garanti par groupe (sinon « au hasard » produit parfois un
  // mot de passe sans chiffre, que le site refuse), puis remplissage, puis
  // mélange de Fisher-Yates pour ne pas trahir la position des garanties.
  const chars = groups.map((g) => pick(g));
  const pool = groups.join('');
  while (chars.length < length) chars.push(pick(pool));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return { success: true, password: chars.join('') };
}

// Phrase de passe : plus facile à retenir pour un mot de passe MAÎTRE.
const WORDS = ('able acide agile alerte amande ancre arbre argile atlas aurore avion bambou baleine banc barque basalte bison blason bougie boussole branche brique bruine cactus calme canal carbone cascade cendre cercle chalet chêne cible ciel citron clairon cobalt colline comète corail coteau coupole crayon cristal cuivre dauphin dune éclair écorce écume émeraude épine érable étoile falaise fanal ferme feuille figue flamme flèche forêt fougère fresque galet givre glacier grain granit grive hameau harpe hérisson horizon hublot ivoire jardin jonque lagune lande lanterne lavande lierre limon lucarne lueur lynx marée menthe mésange meule miroir mousse muraille nacre navire nectar neige nuage océan olive ombre orage orchidée osier palme papyrus phare pierre pinède pivoine plaine platane pluie prisme quartz racine rameau récif remous renard rivage rocher rosée roseau ruche sable safran saphir saule sentier silex sillon sirocco source sphinx steppe sureau tamis tempête terrasse tilleul torrent tourbe trèfle vague vallon vanille velours verger vigne violon voile zénith').split(' ');

export function generatePassphrase(words = 5) {
  const n = Math.min(10, Math.max(3, Number(words) || 5));
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(WORDS[crypto.randomInt(WORDS.length)]);
  // Un chiffre final : beaucoup de sites exigent un chiffre.
  return { success: true, password: `${out.join('-')}-${crypto.randomInt(10, 100)}` };
}
