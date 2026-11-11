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
  // Appel en cours d'attention : entrant qui sonne, appel sortant en cours de
  // composition, ou conversation déjà décrochée. Vide quand il n'y a rien à
  // signaler (appel manqué, terminé).
  activeCall: null,
  // Clé du dernier appel dont le bandeau a été fermé à la main.
  dismissedCallKey: null,
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
  setActiveCall: (activeCall) => set({ activeCall }),
  // Fermer le bandeau d'un appel qui sonne ne doit pas le voir revenir au
  // prochain sondage (douze secondes plus tard) : la clé de l'appel fermé est
  // retenue tant que c'est le même appel.
  dismissCall: () =>
    set((state) => ({
      activeCall: null,
      dismissedCallKey: state.activeCall?.notification?.key || null,
    })),
  // L'appel est fini : la prochaine notification, même à clé identique, est un
  // nouvel appel et doit pouvoir ouvrir son bandeau.
  clearDismissedCall: () => set({ dismissedCallKey: null }),
  // Décrochage fait depuis Orbit : `answeredAt` garde le bandeau en place et le
  // fait passer à « Terminer » sans attendre que le téléphone republie sa
  // notification (beaucoup de dialers la mettent simplement à jour en place).
  markCallAnswered: (at = Date.now()) =>
    set((state) =>
      state.activeCall ? { activeCall: { ...state.activeCall, answeredAt: at } } : {}
    ),
  removeNotification: (key) =>
    set((state) => ({ notifications: state.notifications.filter((n) => n.key !== key) })),
  setError: (error) => set({ error: String(error || '') }),
  reset: () => set({ notifications: [], error: '' }),
}));
