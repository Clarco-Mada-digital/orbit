// ---------------------------------------------------------------------------
// État volatile du Téléphone (non persisté).
//
// L'app ne vit plus dans le sidebar : elle s'ouvre depuis le bouton de barre
// (`nativeApps` dans le store principal dit si l'extension est installée). Ce
// store porte l'ouverture du panneau et les notifications du mobile, que la
// barre, le panneau de notifications et l'overlay doivent tous voir.
// ---------------------------------------------------------------------------

import { create } from 'zustand';

export const usePhoneStore = create((set) => ({
  open: false,
  // Notifications Android affichées, poussées par le processus principal.
  notifications: [],
  // Appareil qui les a produites : indispensable pour agir dessus (ouvrir
  // l'app, écarter, déplier le volet) depuis le panneau d'Orbit.
  serial: null,
  // Dernière erreur de synchronisation (appareil débranché, extension absente).
  error: '',
  // App à ouvrir dès que le panneau est prêt (clic sur une alerte système ou
  // sur une notification du panneau). Consommée par PhoneApp.
  requestedPackage: null,

  // Fermer le panneau annule une demande d'ouverture en attente (sinon la
  // prochaine ouverture lancerait une app que l'utilisateur n'a pas demandée).
  setOpen: (open) => set(open ? { open: true } : { open: false, requestedPackage: null }),
  requestOpen: (pkg) => set({ open: true, requestedPackage: pkg || null }),
  clearRequest: () => set({ requestedPackage: null }),
  toggle: () => set((state) => ({ open: !state.open })),
  setNotifications: (payload) =>
    set(() => {
      if (Array.isArray(payload)) return { notifications: payload };
      return {
        notifications: Array.isArray(payload?.items) ? payload.items : [],
        serial: payload?.serial || null,
      };
    }),
  removeNotification: (key) =>
    set((state) => ({ notifications: state.notifications.filter((n) => n.key !== key) })),
  setError: (error) => set({ error: String(error || '') }),
  reset: () => set({ notifications: [], error: '' }),
}));
