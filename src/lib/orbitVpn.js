// ---------------------------------------------------------------------------
// VPN Orbit pour tout Orbit, en un geste.
//
// « Activer » = le réseau de tout Orbit passe sur le VPN Orbit ; l'ancien
// réglage est gardé pour être rétabli à l'arrêt (ou quand la durée choisie
// expire). Une app ou un profil qui a SON propre réseau le garde : c'est la
// règle de priorité habituelle (app > profil > tout Orbit).
//
// Partagé par les réglages, le module de la barre et App.jsx (expiration).
// ---------------------------------------------------------------------------
import { useStore } from '../stores/useStore';
import { NETWORK_RULES } from './privateNetwork';

const api = () => window.electronAPI?.privateNet;

export function orbitVpnIsGlobal(settings) {
  return String(settings?.globalProxy || '').trim() === NETWORK_RULES.orbitvpn;
}

export async function activateOrbitVpn(minutes = 0) {
  const { settings, updateSettings } = useStore.getState();
  if (!orbitVpnIsGlobal(settings)) {
    updateSettings({ globalProxy: NETWORK_RULES.orbitvpn, orbitVpnPrevProxy: settings.globalProxy || '' });
  }
  const res = await api()?.startOrbitVpn(minutes);
  // Échec : on rend la connexion d'avant plutôt que de laisser tout Orbit
  // bloqué (fail-closed) sur un tunnel qui ne s'est pas ouvert.
  if (res && !res.success) restoreNetwork();
  return res || { success: false, error: 'Indisponible.' };
}

// Rétablit le réseau d'avant l'activation (sans toucher au moteur).
export function restoreNetwork() {
  const { settings, updateSettings } = useStore.getState();
  if (!orbitVpnIsGlobal(settings)) return;
  const prev = settings.orbitVpnPrevProxy || '';
  updateSettings({ globalProxy: prev === NETWORK_RULES.orbitvpn ? '' : prev, orbitVpnPrevProxy: '' });
}

export async function deactivateOrbitVpn() {
  restoreNetwork();
  return (await api()?.stopOrbitVpn()) || { success: true };
}
