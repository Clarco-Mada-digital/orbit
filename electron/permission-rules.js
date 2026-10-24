export const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'media',
  'mediaKeySystem',
  'geolocation',
  'fullscreen',
  'clipboard-read',
  'clipboard-sanitized-write',
  'pointerLock',
  'background-sync',
  'openExternal',
  'display-capture',
  'desktop-capture',
  'fileSystem',
]);

export const ASKABLE_PERMISSIONS = new Set([
  'media',
  'geolocation',
  'notifications',
  'display-capture',
  'desktop-capture',
  'midiSysex',
  'clipboard-read',
  'idle-detection',
  'window-management',
  'fileSystem',
]);

export function permissionRequestDecision(permission, mode, origin, remembered) {
  if (remembered === 'allow' || remembered === 'deny') return remembered;
  if (!ASKABLE_PERMISSIONS.has(permission)) {
    return ALLOWED_PERMISSIONS.has(permission) ? 'allow' : 'deny';
  }
  if (!origin || mode === 'deny') return 'deny';
  if (mode === 'ask') return 'ask';
  return mode === 'allow' && ALLOWED_PERMISSIONS.has(permission) ? 'allow' : 'deny';
}

export function permissionCheckAllowed(permission, mode, remembered, origin) {
  if (remembered === 'allow') return true;
  if (remembered === 'deny') return false;
  if (!ASKABLE_PERMISSIONS.has(permission)) return ALLOWED_PERMISSIONS.has(permission);
  return Boolean(origin) && mode === 'allow' && ALLOWED_PERMISSIONS.has(permission);
}
