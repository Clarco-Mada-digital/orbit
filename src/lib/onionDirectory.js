// ---------------------------------------------------------------------------
// Sites .onion OFFICIELS proposés quand Tor est utilisé.
//
// Règle absolue : une adresse .onion ne se devine pas et ne se recopie pas
// d'une liste trouvée au hasard — les faux annuaires servent à l'hameçonnage.
// Chaque adresse ci-dessous est publiée PAR L'ORGANISATION ELLE-MÊME :
//   - en-tête « Onion-Location » de son site officiel (la preuve la plus
//     forte : c'est son serveur qui l'annonce), ou
//   - article / documentation officiels cités dans `source`.
// Toutes ont été ouvertes par Tor le 24/11/2026 (réponse 200/30x).
// Mediapart publie une adresse mais ne répondait plus : écarté.
// ---------------------------------------------------------------------------

export const ONION_VERIFIED_AT = '2026-11-24';

export const ONION_CATEGORIES = {
  search: 'Rechercher',
  news: 'S’informer',
  tools: 'Outils et vie privée',
  whistle: 'Alerter en sécurité',
};

export const ONION_SITES = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    category: 'search',
    description: 'Moteur de recherche sans pistage — pour chercher sur le web normal, via Tor.',
    url: 'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/',
    source: 'Documentation du Tor Project (tb-manual.torproject.org/onion-services)',
  },
  {
    id: 'ahmia',
    name: 'Ahmia',
    category: 'search',
    description: 'Moteur de recherche des sites .onion, qui filtre les contenus illégaux.',
    url: 'http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/',
    source: 'En-tête Onion-Location de ahmia.fi',
  },
  {
    id: 'bbc',
    name: 'BBC News',
    category: 'news',
    description: 'L’information de la BBC, accessible même là où elle est censurée.',
    url: 'https://www.bbcnewsd73hkzno2ini43t4gblxvycyac5aw4gnv7t2rccijh7745uqd.onion/',
    source: 'Article officiel bbc.co.uk/news/technology-50150981',
  },
  {
    id: 'dw',
    name: 'Deutsche Welle',
    category: 'news',
    description: 'Média international allemand, en 30 langues dont le français.',
    url: 'http://www.dwnewsgngmhlplxy6o2twtfgjnrnjxbegbwqx6wnotdhkzt562tszfid.onion/',
    source: 'En-tête Onion-Location de dw.com',
  },
  {
    id: 'propublica',
    name: 'ProPublica',
    category: 'news',
    description: 'Journalisme d’investigation indépendant (anglais).',
    url: 'http://p53lf57qovyuvwsc6xnrppyply3vtqm7l6pcobkmyqsiofyeznfu5uqd.onion/',
    source: 'Article officiel propublica.org (nerds)',
  },
  {
    id: 'archive',
    name: 'Internet Archive',
    category: 'news',
    description: 'La Wayback Machine et des millions de livres, films et pages archivées.',
    url: 'https://archivep75mbjunhxc6x4j5mwjmomyxb573v42baldlqu56ruil2oiad.onion/',
    source: 'En-tête Onion-Location de archive.org',
  },
  {
    id: 'amnesty',
    name: 'Amnesty International',
    category: 'news',
    description: 'Défense des droits humains : rapports et campagnes.',
    url: 'https://www.amnestyl337aduwuvpf57irfl54ggtnuera45ygcxzuftwxjvvmpuzqd.onion/',
    source: 'En-tête Onion-Location de amnesty.org',
  },
  {
    id: 'protonmail',
    name: 'Proton Mail',
    category: 'tools',
    description: 'Messagerie chiffrée suisse — votre boîte Proton, par Tor.',
    url: 'https://protonmailrmez3lotccipshtkleegetolb73fuirgj7r4o4vfu7ozyd.onion/',
    source: 'En-tête Onion-Location de proton.me',
  },
  {
    id: 'torproject',
    name: 'Tor Project',
    category: 'tools',
    description: 'Le site officiel de Tor : téléchargements, aide, ponts.',
    url: 'http://2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/',
    source: 'En-tête Onion-Location de torproject.org',
  },
  {
    id: 'riseup',
    name: 'Riseup',
    category: 'tools',
    description: 'Collectif militant : messagerie, listes, pads et VPN.',
    url: 'http://vww6ybal4bd7szmgncyruucpgfkqahzddi37ktceo3ah7ngmcopnpyyd.onion/',
    source: 'En-tête Onion-Location de riseup.net',
  },
  {
    id: 'mullvad',
    name: 'Mullvad VPN',
    category: 'tools',
    description: 'Fournisseur VPN respectueux de la vie privée (compte sans e-mail).',
    url: 'http://o54hon2e2vj6c7m3aqqu6uyece65by3vgoxxhlqlsvkmacw6a7m7kiad.onion/',
    source: 'En-tête Onion-Location de mullvad.net',
  },
  {
    id: 'whonix',
    name: 'Whonix',
    category: 'tools',
    description: 'Système d’exploitation conçu pour l’anonymat (documentation).',
    url: 'http://www.dds6qkxpwdeubwucdiaord2xgbbeyds25rbsgr73tbfpqpt4a6vjwsyd.onion/',
    source: 'En-tête Onion-Location de whonix.org',
  },
  {
    id: 'securedrop',
    name: 'SecureDrop',
    category: 'whistle',
    description: 'Annuaire des rédactions qui reçoivent des documents de sources anonymes.',
    url: 'http://sdolvtfhatvsysc6l34d65ymdwxcujausv7k5jk4cy5ttzhjoi6fzvyd.onion/',
    source: 'En-tête Onion-Location de securedrop.org',
  },
  {
    id: 'fpf',
    name: 'Freedom of the Press',
    category: 'whistle',
    description: 'Fondation pour la liberté de la presse : guides de sécurité pour journalistes.',
    url: 'http://fpfjxcrmw437h6z2xl3w4czl55kvkmxpapg37bbopsafdu7q454byxid.onion/',
    source: 'En-tête Onion-Location de freedom.press',
  },
];

// Adresse .onion v3 : 56 caractères base32 (a-z, 2-7) + « .onion ».
export function isOnionV3Url(url) {
  try {
    return /^(?:[a-z0-9-]+\.)?[a-z2-7]{56}\.onion$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
