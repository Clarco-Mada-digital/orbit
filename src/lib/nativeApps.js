// ---------------------------------------------------------------------------
// Ouverture d'une app native fournie par une extension (`orbit.nativeApp`).
//
// Une extension native n'a ni panneau ni page : la « cliquer » doit ouvrir
// l'app qu'elle active. Un seul espace de travail natif à la fois — ouvrir la
// Base de données ferme le Téléphone, et inversement.
// ---------------------------------------------------------------------------
import { usePhoneStore } from './phoneStore';
import { useDevToolsStore } from './devToolsStore';

export const NATIVE_APP_KINDS = ['phone', 'database', 'api'];

export function openNativeApp(kind) {
  if (kind === 'phone') {
    useDevToolsStore.getState().setOpen(null);
    usePhoneStore.getState().setOpen(true);
    return true;
  }
  if (kind === 'database' || kind === 'api') {
    usePhoneStore.getState().setOpen(false);
    useDevToolsStore.getState().setOpen(kind);
    return true;
  }
  return false;
}

