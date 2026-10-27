export function applyImportedFields(existing, values, mode, timestamp = Date.now()) {
  const previousPassword = existing.password;
  let changed = false;
  for (const [field, value] of Object.entries(values)) {
    if (!value || (mode === 'merge' && existing[field])) continue;
    if (existing[field] !== value) {
      existing[field] = value;
      changed = true;
    }
  }
  if (!changed) return false;

  if (previousPassword && existing.password !== previousPassword) {
    existing.history = [
      { password: previousPassword, at: existing.passwordUpdatedAt || existing.updatedAt },
      ...(existing.history || []),
    ].slice(0, 5);
    existing.passwordUpdatedAt = timestamp;
  }
  existing.updatedAt = timestamp;
  return true;
}
