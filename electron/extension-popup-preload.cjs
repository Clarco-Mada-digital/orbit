// ---------------------------------------------------------------------------
// Popup d'action d'une extension — rustine « onglet actif ».
//
// Le problème, mesuré sur Electron 43 :
//   • `chrome.tabs.query({})` renvoie BIEN la page affichée dans le <webview>
//     d'une app — l'onglet existe ;
//   • mais son champ `active` vaut toujours `false`, et `windowId` toujours 0.
//     Electron n'a pas de barre d'onglets, donc aucun onglet n'est jamais
//     « actif » ni « dans la fenêtre courante ».
//
// Or c'est exactement ce que demandent tous les popups d'extension :
// `chrome.tabs.query({ active: true, currentWindow: true })`. Sans rustine, ils
// reçoivent un tableau VIDE et affichent « ouvrez une page pour l'analyser »
// alors qu'une page est affichée juste derrière. Le popup s'ouvrirait, mais
// pour ne rien dire — autant ne pas l'ouvrir.
//
// La rustine est posée dans le MONDE DE LA PAGE via `webFrame.executeJavaScript`
// (et non en désactivant `contextIsolation`) : la page d'extension garde son
// isolation, on ne fait qu'y réécrire une fonction avant que ses propres
// scripts ne tournent.
//
// Ce qu'elle NE répare pas, et ne peut pas réparer : les API absentes d'Electron
// (`chrome.cookies`, `chrome.contextMenus`, `chrome.tabs.create`…). Une
// extension dont la tâche de fond en dépend restera partiellement muette — le
// relevé complet est dans electron/extension-warnings.js.
// ---------------------------------------------------------------------------
const { webFrame } = require('electron');

// Id de l'onglet à présenter comme actif : celui du <webview> de l'app
// affichée, transmis par main.js à la création de la fenêtre. Les ids d'onglet
// d'Electron sont les ids de webContents — c'est ce que renvoie
// `webview.getWebContentsId()` côté interface.
function arg(nom) {
  const found = process.argv.find((a) => a.startsWith(`--orbit-${nom}=`));
  return found ? decodeURIComponent(found.slice(`--orbit-${nom}=`.length)) : '';
}

const activeTabId = Number(arg('active-tab'));
const activeTabUrl = arg('active-url');
const activeTabTitle = arg('active-title');

if (Number.isInteger(activeTabId)) {
  webFrame.executeJavaScript(`(() => {
    try {
      if (!window.chrome || !chrome.tabs || !chrome.tabs.query) return;
      const ACTIVE = ${activeTabId};
      // L'ADRESSE de la page, fournie par Orbit.
      //
      // Pourquoi il faut la fournir : Chrome donne l'URL de l'onglet aux
      // extensions qui ont la permission \`activeTab\`, et seulement après un
      // clic de l'utilisateur sur leur icône. Electron n'implémente pas cette
      // concession : le champ \`url\` revient VIDE. Beaucoup de panneaux
      // abandonnent alors en silence — Lighthouse, par exemple, sort de sa
      // fonction sans rien dire si \`tabs[0].url\` est vide, et le bouton
      // « Generate report » ne fait rien du tout.
      //
      // Le geste qui justifie la concession a bien eu lieu : l'utilisateur
      // vient de cliquer sur l'icône de cette extension. On est donc dans le
      // cadre prévu par \`activeTab\`, pas en train de l'élargir.
      const URL_ACTIVE = ${JSON.stringify(activeTabUrl)};
      const TITRE_ACTIF = ${JSON.stringify(activeTabTitle)};
      const complete = (t) =>
        t && t.id === ACTIVE
          ? Object.assign({}, t, {
              active: true,
              highlighted: true,
              windowId: 0,
              url: t.url || URL_ACTIVE,
              title: t.title || TITRE_ACTIF,
            })
          : t;

      const vraiQuery = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = function (info, cb) {
        const filtre = Object.assign({}, info || {});
        // Ces trois critères ne peuvent JAMAIS être satisfaits par Electron :
        // on les retire du filtre, puis on rétablit nous-mêmes le résultat
        // attendu. Les autres critères (url, status, title…) restent au moteur.
        const veutActif =
          filtre.active === true || filtre.currentWindow === true || filtre.lastFocusedWindow === true;
        delete filtre.active;
        delete filtre.currentWindow;
        delete filtre.lastFocusedWindow;
        delete filtre.windowId;
        const corrige = (tabs) => {
          const liste = (tabs || []).map(complete);
          return veutActif ? liste.filter((t) => t && t.id === ACTIVE) : liste;
        };
        // L'API accepte les deux styles ; les extensions récentes utilisent la
        // promesse, les anciennes le rappel. On rend ce qu'on nous demande.
        if (typeof cb === 'function') return vraiQuery(filtre, (t) => cb(corrige(t)));
        const r = vraiQuery(filtre);
        return r && typeof r.then === 'function' ? r.then(corrige) : corrige(r);
      };

      // Même complément pour une lecture directe de l'onglet.
      if (typeof chrome.tabs.get === 'function') {
        const vraiGet = chrome.tabs.get.bind(chrome.tabs);
        chrome.tabs.get = function (id, cb) {
          if (typeof cb === 'function') return vraiGet(id, (t) => cb(complete(t)));
          const r = vraiGet(id);
          return r && typeof r.then === 'function' ? r.then(complete) : complete(r);
        };
      }

      // \`chrome.tabs.create\` n'existe pas dans Electron. Un panneau qui veut
      // « ouvrir un onglet » (un rapport, une page d'aide) échouait sur une
      // TypeError — et, dans une extension groupée en un seul fichier, cette
      // exception pouvait emporter tout le reste de son initialisation. On la
      // redirige vers \`window.open\`, que le processus principal sait router.
      if (chrome.tabs && typeof chrome.tabs.create !== 'function') {
        chrome.tabs.create = function (props, cb) {
          try { window.open((props && props.url) || 'about:blank', '_blank'); } catch (e) {}
          const faux = { id: -1, url: (props && props.url) || '', active: true, windowId: 0 };
          if (typeof cb === 'function') { cb(faux); return undefined; }
          return Promise.resolve(faux);
        };
      }
    } catch (e) {
      /* la page s'affichera sans la rustine plutôt que pas du tout */
    }
  })()`);
}
