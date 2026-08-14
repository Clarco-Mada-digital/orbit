import { create } from 'zustand';

// Miroir (côté renderer) de l'état de verrouillage géré dans le process
// principal (electron/security.js). Ne contient JAMAIS les codes ni les
// empreintes — seulement « activé / déverrouillé » pour piloter l'UI.
export const useSecurityStore = create((set) => ({
  appLockEnabled: false,
  appUnlocked: true,
  lockedProfileIds: [],
  unlockedProfileIds: [],
  ready: false, // l'état a-t-il été chargé au moins une fois ?

  // Recharge l'état depuis le main process
  refresh: async () => {
    const s = await window.electronAPI?.security?.getState?.();
    if (s) set({ ...s, ready: true });
    else set({ ready: true });
    return s;
  },

  // Un profil est-il accessible (non verrouillé, ou déjà déverrouillé) ?
  isProfileAccessible: (profileId, state) => {
    const s = state || useSecurityStore.getState();
    return !s.lockedProfileIds.includes(profileId) || s.unlockedProfileIds.includes(profileId);
  },
}));
