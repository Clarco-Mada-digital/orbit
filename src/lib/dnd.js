// « Ne pas déranger » : détermine si les notifications doivent être coupées,
// manuellement (dnd) ou selon les plages horaires (quiet hours).

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

// Heure courante dans la plage [start, end[ ? Gère les plages qui passent
// minuit (ex. 22:00 → 07:00).
export function withinQuietHours(start, end, date = new Date()) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  return s < e ? now >= s && now < e : now >= s || now < e;
}

// Notifications coupées maintenant ? (DND manuel ou plage horaire active)
export function notificationsSilenced(settings, date = new Date()) {
  if (!settings) return false;
  if (settings.dnd) return true;
  if (settings.quietHoursEnabled && withinQuietHours(settings.quietStart, settings.quietEnd, date)) {
    return true;
  }
  return false;
}
