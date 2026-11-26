// ---------------------------------------------------------------------------
// Traduction de la page entière
//
// Comment : un script est injecté dans la page, dans un MONDE ISOLÉ (les
// scripts du site ne le voient pas et ne peuvent pas l'appeler). Il ne touche
// qu'au TEXTE : les nœuds texte et trois attributs lisibles (placeholder,
// title, alt). Structure, liens, styles et scripts de la page ne bougent pas,
// et la page continue de fonctionner normalement.
//
// Sécurité :
//   • la traduction est posée en TEXTE PUR (node.data / setAttribute) : même
//     une réponse piégée du service ne peut rien exécuter ;
//   • c'est le processus principal qui mène la danse (il demande des lots au
//     script, les traduit, les renvoie) : la page n'a aucun canal pour lui
//     demander quoi que ce soit, donc aucun moyen de détourner le traducteur ;
//   • jamais de champ de saisie, de zone éditable, de code, ni de ce que le
//     site marque « translate=no » / « notranslate ».
//
// Performance :
//   • d'abord ce qui est À L'ÉCRAN (plus un écran de marge), le reste ensuite,
//     par lots : une longue page est lisible en une ou deux secondes ;
//   • un observateur note les changements (fils d'actualité, chats) ; sans
//     changement ni défilement, une vérification ne coûte presque rien ;
//   • un cache évite de traduire deux fois la même phrase.
// ---------------------------------------------------------------------------

export const TRANSLATE_WORLD_ID = 1208;

// Lot envoyé au traducteur : borné en caractères ET en nombre de morceaux.
export const BATCH_CHARS = 3500;
export const BATCH_ITEMS = 100;

export const pageScript = `(() => {
  if (window.__orbitTr) return document.documentElement.lang || '';
  const SKIP = 'script,style,noscript,textarea,input,select,option,code,pre,kbd,samp,var,svg,math,canvas,template,iframe,'
    + '[translate="no"],.notranslate,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';
  const ATTRS = ['placeholder', 'title', 'alt'];
  const LETTER = /\\p{L}/u;
  // nœud texte → { orig, tr } ; élément → { [attr]: { orig, tr } }
  const texts = new Map();
  const attrs = new Map();
  const pending = new Map(); // id → cible en attente de traduction
  let seq = 0;
  let dirty = true;
  let writing = false;

  const skipCache = new WeakMap();
  const skipped = (el) => {
    if (!el) return true;
    let v = skipCache.get(el);
    if (v === undefined) { v = Boolean(el.closest(SKIP)); skipCache.set(el, v); }
    return v;
  };
  const margin = () => innerHeight;
  const near = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    return r.bottom > -margin() && r.top < innerHeight + margin();
  };
  const split = (s) => {
    const m = /^(\\s*)([\\s\\S]*?)(\\s*)$/.exec(s);
    return { lead: m[1], core: m[2], trail: m[3] };
  };
  const wanted = (s) => s.length > 1 && LETTER.test(s);

  const observer = new MutationObserver(() => { if (!writing) dirty = true; });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const onScroll = () => { dirty = true; };
  addEventListener('scroll', onScroll, { passive: true, capture: true });
  addEventListener('resize', onScroll, { passive: true });

  function collect(maxChars, maxItems) {
    if (!dirty || !document.body) return [];
    const nearList = [];
    const farList = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const st = texts.get(n);
      if (st && (st.pending || n.data === st.tr)) continue;
      const parent = n.parentElement;
      if (skipped(parent)) continue;
      const parts = split(n.data);
      if (!wanted(parts.core)) continue;
      (near(parent) ? nearList : farList).push({ kind: 't', node: n, parts });
    }
    for (const el of document.body.querySelectorAll('[placeholder],[title],img[alt]')) {
      if (skipped(el) && !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) continue;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v || !wanted(v.trim())) continue;
        const st = attrs.get(el)?.[a];
        if (st && (st.pending || v === st.tr)) continue;
        (near(el) ? nearList : farList).push({ kind: 'a', node: el, attr: a, parts: split(v) });
      }
    }
    const out = [];
    let chars = 0;
    for (const item of nearList.concat(farList)) {
      const len = item.parts.core.length;
      if (out.length >= maxItems || (out.length && chars + len > maxChars)) break;
      const id = ++seq;
      const orig = item.kind === 't' ? item.node.data : item.node.getAttribute(item.attr);
      pending.set(id, { ...item, orig });
      if (item.kind === 't') texts.set(item.node, { orig, tr: null, pending: true });
      else { const m = attrs.get(item.node) || {}; m[item.attr] = { orig, tr: null, pending: true }; attrs.set(item.node, m); }
      out.push({ id, t: item.parts.core.slice(0, maxChars) });
      chars += len;
    }
    // Plus rien à faire tant que la page ne change pas et qu'on ne défile pas.
    if (nearList.length + farList.length <= out.length) dirty = false;
    return out;
  }

  function apply(results) {
    writing = true;
    try {
      for (const r of results) {
        const item = pending.get(r.id);
        if (!item) continue;
        pending.delete(r.id);
        const tr = typeof r.t === 'string' && r.t ? item.parts.lead + r.t + item.parts.trail : null;
        if (item.kind === 't') {
          // La page a changé ce texte entre-temps : il sera repris plus tard.
          if (item.node.data !== item.orig || !tr) { texts.delete(item.node); continue; }
          item.node.data = tr;
          texts.set(item.node, { orig: item.orig, tr, pending: false });
        } else {
          const m = attrs.get(item.node) || {};
          if (item.node.getAttribute(item.attr) !== item.orig || !tr) { delete m[item.attr]; continue; }
          item.node.setAttribute(item.attr, tr);
          m[item.attr] = { orig: item.orig, tr, pending: false };
          attrs.set(item.node, m);
        }
      }
    } finally {
      observer.takeRecords();
      writing = false;
    }
    return true;
  }

  function restore() {
    writing = true;
    observer.disconnect();
    removeEventListener('scroll', onScroll, { capture: true });
    removeEventListener('resize', onScroll);
    let count = 0;
    for (const [node, st] of texts) {
      if (st.tr && node.data === st.tr) { node.data = st.orig; count++; }
    }
    for (const [el, m] of attrs) {
      for (const a of Object.keys(m)) {
        if (m[a].tr && el.getAttribute(a) === m[a].tr) { el.setAttribute(a, m[a].orig); count++; }
      }
    }
    texts.clear(); attrs.clear(); pending.clear();
    delete window.__orbitTr;
    return count;
  }

  // Les morceaux envoyés mais jamais revenus (erreur réseau) redeviennent
  // candidats au prochain passage.
  function release() {
    for (const item of pending.values()) {
      if (item.kind === 't') texts.delete(item.node);
      else { const m = attrs.get(item.node); if (m) delete m[item.attr]; }
    }
    pending.clear();
    dirty = true;
  }

  Object.defineProperty(window, '__orbitTr', { configurable: true, value: { collect, apply, restore, release } });
  return document.documentElement.lang || '';
})()`;

// --- Réponses des services --------------------------------------------------

// Google (translate_a/t, plusieurs `q`) : [[traduction, langue], …]. Avec un
// seul `q`, certaines variantes renvoient ["traduction", "langue"] à plat.
export function parseGoogleBatch(data, count) {
  if (!Array.isArray(data)) throw new Error('réponse inattendue');
  const rows = count === 1 && typeof data[0] === 'string' ? [data] : data;
  if (rows.length !== count) throw new Error('réponse incomplète');
  return rows.map((row) => {
    if (typeof row === 'string') return { t: row, lang: '' };
    return { t: String((row && row[0]) || ''), lang: String((row && row[1]) || '') };
  });
}

// LibreTranslate avec `q` en tableau : translatedText est un tableau.
export function parseLibreBatch(data, count) {
  const list = Array.isArray(data?.translatedText) ? data.translatedText : count === 1 ? [data?.translatedText] : null;
  if (!list || list.length !== count) throw new Error('réponse incomplète');
  const det = Array.isArray(data?.detectedLanguage) ? data.detectedLanguage : [];
  return list.map((t, i) => ({ t: String(t || ''), lang: String(det[i]?.language || '') }));
}

// La page est-elle déjà dans la langue cible ? (majorité des morceaux détectés)
export function mostlyIn(results, target) {
  const base = String(target || '').slice(0, 2).toLowerCase();
  const known = results.filter((r) => r.lang);
  if (known.length < 3) return false;
  const same = known.filter((r) => r.lang.slice(0, 2).toLowerCase() === base).length;
  return same / known.length >= 0.7;
}

// Le serveur LibreTranslate est-il sur cette machine ou le réseau local ?
// (seul cas où une page privée ou en tunnel peut être traduite)
export function isLocalServer(url) {
  try {
    const host = new URL(url).hostname;
    return (
      host === 'localhost' ||
      host === '::1' ||
      host === '[::1]' ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith('.local')
    );
  } catch {
    return false;
  }
}

// Hôte d'une adresse, sans « www. » : clé des préférences « jamais ce site ».
export function siteOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

// Que faire d'une page qui vient de se charger ?
//   'auto'  → la traduire tout de suite (langue cochée « toujours traduire ») ;
//   'offer' → proposer (réglage de proposition actif) ;
//   null    → rien.
// `lang` : langue déclarée par la page ; `site` : voir siteOf().
export function pageDecision({ lang, site, target, always = [], never = [], offer = false }) {
  const base = String(lang || '').slice(0, 2).toLowerCase();
  const to = String(target || 'fr').slice(0, 2).toLowerCase();
  if (!/^[a-z]{2}$/.test(base) || base === to) return null;
  if (site && never.includes(site)) return null;
  if (always.includes(base)) return 'auto';
  return offer ? 'offer' : null;
}

// Petit cache LRU (texte → traduction), par langue cible.
export function makeCache(limit = 5000) {
  const map = new Map();
  return {
    get(target, text) {
      const key = target + '\u0000' + text;
      if (!map.has(key)) return undefined;
      const v = map.get(key);
      map.delete(key);
      map.set(key, v);
      return v;
    },
    set(target, text, value) {
      const key = target + '\u0000' + text;
      map.delete(key);
      map.set(key, value);
      if (map.size > limit) map.delete(map.keys().next().value);
    },
  };
}
