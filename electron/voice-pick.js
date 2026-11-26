// ---------------------------------------------------------------------------
// Choix de la voix selon la langue du texte — LOGIQUE PURE.
//
// La voix choisie dans Réglages → Lecture vocale reste la règle. Mais lire une
// page anglaise avec une voix française (ou une page traduite en français avec
// une voix anglaise) donne un charabia : si une voix Piper INSTALLÉE parle la
// langue du texte, on la prend pour cette lecture. Rien n'est téléchargé.
// ---------------------------------------------------------------------------

// Langue d'un identifiant de voix Piper : « fr_FR-siwis-low » → « fr ».
export function voiceLang(id) {
  const m = /^([a-z]{2,3})_/i.exec(String(id || ''));
  return m ? m[1].toLowerCase() : '';
}

// Code de langue normalisé à 2-3 lettres (« en-US » → « en »), ou ''.
export function baseLang(lang) {
  const m = /^([a-z]{2,3})(?:[-_][a-z0-9]{2,8})*$/i.exec(String(lang || '').trim());
  return m ? m[1].toLowerCase() : '';
}

export function pickVoiceFor(lang, chosen, installed = []) {
  const base = baseLang(lang);
  if (!base || !chosen || voiceLang(chosen) === base) return chosen;
  return installed.find((id) => voiceLang(id) === base) || chosen;
}
