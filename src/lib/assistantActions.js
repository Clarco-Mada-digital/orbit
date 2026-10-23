const normalize = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function proposeOrbitAction(message, apps) {
  if (typeof message !== 'string' || !Array.isArray(apps)) return null;
  const normalized = normalize(message);
  const addCommand = message.trim().match(
    /^(ajoute|ajouter|add|create)\s+(?:(?:une?|un)\s+)?(application|app|raccourci|shortcut)\s+(?:pour\s+)?(.+)$/iu
  );
  if (addCommand) {
    const urlMatch = addCommand[3].match(/https?:\/\/[^\s<>"']+/iu);
    if (urlMatch) {
      const rawUrl = urlMatch[0].replace(/[),.;!?]+$/u, '');
      try {
        const url = new URL(rawUrl);
        const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (
          (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback)) &&
          !url.username &&
          !url.password
        ) {
          const name = addCommand[3]
            .replace(urlMatch[0], '')
            .replace(/\s+(sur|at|to)\s*$/iu, '')
            .trim()
            .slice(0, 60) || url.hostname;
          return {
            type: 'create-app',
            name,
            url: url.href,
          };
        }
      } catch {
        return null;
      }
    }
  }
  const themeCommand = normalized.match(
    /^(?:mets?|passe|change|set|switch)\s+(?:le\s+theme\s+(?:en\s+|to\s+)?|theme\s+(?:to\s+)?|en\s+mode\s+|to\s+)(clair|sombre|light|dark)$/u
  );
  if (themeCommand) {
    return {
      type: 'setting',
      setting: 'theme',
      value: ['clair', 'light'].includes(themeCommand[1]) ? 'light' : 'dark',
    };
  }
  const command = normalized.match(/^(ouvre|ouvrir|open|affiche|va dans|go to)\s+(.+)$/);
  if (!command) return null;
  const target = command[2];
  if (/^(les\s+)?(parametres|reglages|settings|preferences)(\s|$)/.test(target)) {
    return { type: 'settings' };
  }

  const candidates = apps
    .filter((app) => app && typeof app.id === 'string' && typeof app.name === 'string')
    .sort((a, b) => b.name.length - a.name.length);
  const app = candidates.find((item) => {
    const name = normalize(item.name);
    return name && (target === name || target.startsWith(`${name} `));
  });
  return app ? { type: 'app', appId: app.id, profileId: app.profileId, name: app.name } : null;
}
