// Ressources partagées pour les icônes d'applications (boutique, édition…)

// Emojis disponibles pour une app (fallback quand pas de favicon/image)
export const EMOJI_CHOICES = [
  // Web & général
  '🌐', '💬', '📧', '📝', '🎵', '🎬', '📰', '🛒', '🏦', '📈',
  '🎮', '🏋️', '🍔', '✈️', '🚗', '📚', '🧠', '💻', '🔧', '🗓️',
  // Communication
  '📨', '📣', '☎️', '📞', '🤝', '👥', '🗣️', '💌', '📢',
  // Productivité & outils
  '⚡', '✅', '📋', '🎯', '📊', '📐', '🗂️', '⏰', '💰', '🖥️',
  // Cloud & stockage
  '☁️', '💾', '📁', '🗄️', '🔒', '🔑', '🛡️',
  // Média & loisirs
  '🎧', '🎤', '🎥', '📺', '🎨', '🎭', '⚽', '🏀', '🎳', '♟️',
  // Social
  '🌍', '⭐', '🔥', '💡', '❤️', '👍', '🎁', '🎉',
  // Dev & IA
  '🤖', '🐙', '🐍', '☕', '📦', '🧩', '🔍', '🧪',
  // Divers
  '🛰️', '🚀', '🌙', '☀️', '🏠', '💼', '🎓', '🩺', '⚖️', '🛠️',
];

export const COLOR_CHOICES = [
  '#6366f1', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#f59e0b', '#84cc16', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#6b7280', '#000000',
];

// Nom de domaine d'une URL (pour le favicon)
export function getHostname(url) {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return '';
  }
}

// URL de favicon via un service public. icon.horse en premier : il renvoie
// de VRAIES icônes de marque (WhatsApp, Messenger, GitHub…) alors que
// Google s2 renvoie un placeholder générique 16×16 pour certains sites
// (ex. web.whatsapp.com → 404 → image de secours qui se charge SANS erreur,
// donc on restait bloqué sur l'icône générique au lieu du vrai logo).
// Google s2 reste en repli pour les domaines qu'icon.horse ne connaît pas.
export function faviconServiceUrl(url, useFallback = false) {
  const host = getHostname(url);
  if (!host) return '';
  return useFallback
    ? `https://www.google.com/s2/favicons?domain=${host}&sz=64`
    : `https://icon.horse/icon/${host}`;
}
