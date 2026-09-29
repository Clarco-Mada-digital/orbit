// ---------------------------------------------------------------------------
// i18n léger, sans dépendance. Dictionnaires fr/en + hook réactif useT().
//
// Usage : const t = useT(); t('welcome.title'); t('key', { name: 'X' })
// La langue vient de settings.language ('auto' | 'fr' | 'en') ; 'auto' se base
// sur la langue du système. Le fr sert toujours de repli.
//
// La migration des chaînes se fait composant par composant : toute clé absente
// retombe sur le français, donc rien ne casse en cours de route.
// ---------------------------------------------------------------------------
import { useStore } from '../stores/useStore.js';
import { fr, en } from './i18n.dict.js';

export { fr, en };

const dicts = { fr, en };

export function resolveLang(setting) {
  if (setting === 'fr' || setting === 'en') return setting;
  const nav = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'fr')
    .toLowerCase();
  return nav.startsWith('en') ? 'en' : 'fr';
}

export function translate(lang, key, vars) {
  const d = dicts[lang] || dicts.fr;
  let s = d[key] ?? dicts.fr[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.split(`{${k}}`).join(String(vars[k]));
    }
  }
  return s;
}

// Hook réactif : se re-rend quand la langue (settings.language) change.
export function useT() {
  const setting = useStore((s) => s.settings?.language);
  const lang = resolveLang(setting);
  return (key, vars) => translate(lang, key, vars);
}
