// ---------------------------------------------------------------------------
// Conversions instantanées pour la palette Alt+K :
//   unités (longueur, masse, température, volume, surface, vitesse, durée,
//   données), bases numériques, couleurs, horodatages et calcul de dates.
//
// Chaque fonction renvoie `null` quand l'entrée ne la concerne pas — la
// palette essaie les analyseurs l'un après l'autre.
// ---------------------------------------------------------------------------
import { formatNumber } from './calc';

// Facteurs vers l'unité de référence de chaque famille (mètre, gramme, litre…)
const UNITS = {
  length: {
    ref: 'm',
    units: {
      nm: 1e-9, µm: 1e-6, um: 1e-6, mm: 0.001, cm: 0.01, dm: 0.1, m: 1, km: 1000,
      in: 0.0254, pouce: 0.0254, pouces: 0.0254, ft: 0.3048, pied: 0.3048, pieds: 0.3048,
      yd: 0.9144, yard: 0.9144, yards: 0.9144, mi: 1609.344, mile: 1609.344, miles: 1609.344,
      nmi: 1852, ly: 9.4607304725808e15, au: 1.495978707e11,
    },
  },
  mass: {
    ref: 'kg',
    units: {
      mg: 1e-6, g: 0.001, kg: 1, t: 1000, tonne: 1000, tonnes: 1000,
      lb: 0.45359237, lbs: 0.45359237, livre: 0.45359237, livres: 0.45359237,
      oz: 0.028349523125, once: 0.028349523125, st: 6.35029318,
    },
  },
  volume: {
    ref: 'l',
    units: {
      ml: 0.001, cl: 0.01, dl: 0.1, l: 1, litre: 1, litres: 1, m3: 1000, hl: 100,
      gal: 3.785411784, gallon: 3.785411784, gallons: 3.785411784,
      qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735295625,
    },
  },
  area: {
    ref: 'm2',
    units: {
      mm2: 1e-6, cm2: 1e-4, m2: 1, km2: 1e6, ha: 1e4, are: 100,
      acre: 4046.8564224, acres: 4046.8564224, ft2: 0.09290304, sqft: 0.09290304, mi2: 2589988.110336,
    },
  },
  speed: {
    ref: 'm/s',
    units: {
      'm/s': 1, 'km/h': 1 / 3.6, kmh: 1 / 3.6, kph: 1 / 3.6,
      mph: 0.44704, 'mi/h': 0.44704, kn: 0.514444, noeud: 0.514444, noeuds: 0.514444,
      mach: 340.29, c: 299792458,
    },
  },
  time: {
    ref: 's',
    units: {
      ms: 0.001, s: 1, sec: 1, seconde: 1, secondes: 1,
      min: 60, mn: 60, minute: 60, minutes: 60,
      h: 3600, heure: 3600, heures: 3600, hour: 3600, hours: 3600,
      j: 86400, jour: 86400, jours: 86400, d: 86400, day: 86400, days: 86400,
      semaine: 604800, semaines: 604800, week: 604800, weeks: 604800,
      mois: 2629800, month: 2629800, months: 2629800,
      an: 31557600, ans: 31557600, année: 31557600, year: 31557600, years: 31557600,
    },
  },
  data: {
    ref: 'o',
    units: {
      bit: 0.125, bits: 0.125, o: 1, octet: 1, octets: 1, b: 1, byte: 1, bytes: 1,
      ko: 1000, kb: 1000, kio: 1024, kib: 1024,
      mo: 1e6, mb: 1e6, mio: 1048576, mib: 1048576,
      go: 1e9, gb: 1e9, gio: 1073741824, gib: 1073741824,
      to: 1e12, tb: 1e12, tio: 1099511627776, tib: 1099511627776,
      po: 1e15, pb: 1e15,
    },
  },
};

// Températures : conversions affines, traitées à part
const TEMP = ['c', '°c', 'celsius', 'f', '°f', 'fahrenheit', 'k', 'kelvin'];
const tempTo = { c: 'c', '°c': 'c', celsius: 'c', f: 'f', '°f': 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' };

function toCelsius(v, u) {
  if (u === 'f') return (v - 32) / 1.8;
  if (u === 'k') return v - 273.15;
  return v;
}
function fromCelsius(v, u) {
  if (u === 'f') return v * 1.8 + 32;
  if (u === 'k') return v + 273.15;
  return v;
}

// Famille d'une unité (null si inconnue)
function familyOf(unit) {
  for (const [family, def] of Object.entries(UNITS)) {
    if (Object.prototype.hasOwnProperty.call(def.units, unit)) return family;
  }
  return null;
}

// Affichage canonique d'une unité (on garde ce que l'utilisateur a tapé, mais
// on normalise les alias les plus verbeux)
const PRETTY = {
  pouce: 'in', pouces: 'in', pied: 'ft', pieds: 'ft', livre: 'lb', livres: 'lb',
  tonne: 't', tonnes: 't', litre: 'L', litres: 'L', l: 'L', kmh: 'km/h', kph: 'km/h',
  noeud: 'kn', noeuds: 'kn', c: '°C', '°c': '°C', celsius: '°C', f: '°F', '°f': '°F',
  fahrenheit: '°F', k: 'K', kelvin: 'K', m2: 'm²', km2: 'km²', cm2: 'cm²', mm2: 'mm²',
  ft2: 'ft²', mi2: 'mi²', m3: 'm³',
};
// `raw` = ce que l'utilisateur a tapé : on garde sa casse (« Go », « Mo »)
// sauf pour les alias verbeux qui ont une écriture canonique.
const pretty = (u, raw) => PRETTY[u] || raw || u;

// Affichage d'une valeur convertie : 6 décimales suffisent, et on gomme les
// artefacts de virgule flottante.
const fmtUnit = (v, locale) =>
  Number(v.toPrecision(12)).toLocaleString(locale, { maximumFractionDigits: 6 });

const SEPARATORS = '(?:in|to|en|vers|->|=>|>|→)';
const NUM = '(-?\\d+(?:[.,]\\d+)?(?:[eE][+-]?\\d+)?)';
const UNIT_RE = new RegExp(`^${NUM}\\s*([a-zA-Z°µ²³/]+[0-9]?)\\s+${SEPARATORS}\\s+([a-zA-Z°µ²³/]+[0-9]?)$`, 'i');

// « 10 km en mi », « 72 f in c », « 5 Go -> Mo »
export function convertUnits(input, locale = 'fr-FR') {
  const m = UNIT_RE.exec(String(input || '').trim());
  if (!m) return null;
  const value = parseFloat(m[1].replace(',', '.'));
  const from = m[2].toLowerCase();
  const to = m[3].toLowerCase();
  if (!Number.isFinite(value)) return null;

  if (TEMP.includes(from) && TEMP.includes(to)) {
    const out = fromCelsius(toCelsius(value, tempTo[from]), tempTo[to]);
    return {
      value: out,
      text: `${fmtUnit(out, locale)} ${pretty(to, m[3])}`,
      detail: `${fmtUnit(value, locale)} ${pretty(from, m[2])}`,
      family: 'température',
    };
  }

  const fFrom = familyOf(from);
  const fTo = familyOf(to);
  if (!fFrom || fFrom !== fTo) return null;
  const out = (value * UNITS[fFrom].units[from]) / UNITS[fFrom].units[to];
  return {
    value: out,
    text: `${fmtUnit(out, locale)} ${pretty(to, m[3])}`,
    detail: `${fmtUnit(value, locale)} ${pretty(from, m[2])}`,
    family: fFrom,
  };
}

// « 255 in hex », « 0xff », « 0b1010 en decimal »
const BASE_NAMES = {
  hex: 16, hexa: 16, hexadecimal: 16, hexadécimal: 16, base16: 16,
  bin: 2, binaire: 2, binary: 2, base2: 2,
  oct: 8, octal: 8, base8: 8,
  dec: 10, decimal: 10, décimal: 10, base10: 10,
};

export function convertBase(input, locale = 'fr-FR') {
  const s = String(input || '').trim();

  // Littéral seul : 0xff / 0b1010 / 0o755 → décimal + les autres bases
  const lit = /^0([xbo])([0-9a-fA-F]+)$/.exec(s);
  if (lit) {
    const base = lit[1] === 'x' ? 16 : lit[1] === 'b' ? 2 : 8;
    const n = parseInt(lit[2], base);
    if (!Number.isFinite(n)) return null;
    return {
      value: n,
      text: formatNumber(n, locale),
      detail: `0x${n.toString(16).toUpperCase()} · 0b${n.toString(2)} · 0o${n.toString(8)}`,
    };
  }

  const m = new RegExp(`^(?:0([xbo]))?([0-9a-fA-F]+)\\s+${SEPARATORS}\\s+([a-zA-Zé0-9]+)$`, 'i').exec(s);
  if (!m) return null;
  const target = BASE_NAMES[m[3].toLowerCase()];
  if (!target) return null;
  const srcBase = m[1] ? (m[1] === 'x' ? 16 : m[1] === 'b' ? 2 : 8) : 10;
  const n = parseInt(m[2], srcBase);
  if (!Number.isFinite(n)) return null;
  const prefix = target === 16 ? '0x' : target === 2 ? '0b' : target === 8 ? '0o' : '';
  const out = target === 16 ? n.toString(16).toUpperCase() : n.toString(target);
  return { value: n, text: `${prefix}${out}`, detail: formatNumber(n, locale) };
}

// « #6366f1 », « rgb(99,102,241) » → toutes les notations + aperçu
export function convertColor(input) {
  const s = String(input || '').trim();
  let r, g, b;
  const hex = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    const rgb = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/i.exec(s);
    if (!rgb) return null;
    [r, g, b] = [+rgb[1], +rgb[2], +rgb[3]];
    if ([r, g, b].some((n) => n > 255)) return null;
  }
  const toHex = (n) => n.toString(16).padStart(2, '0');
  const hexOut = `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();

  // HSL
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  return {
    hex: hexOut,
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${Math.round(h)}, ${Math.round(sat * 100)}%, ${Math.round(l * 100)}%)`,
    swatch: hexOut,
  };
}

// « now », « 1700000000 », « aujourd'hui + 30 jours »
export function convertTime(input, locale = 'fr-FR', now = new Date()) {
  const s = String(input || '').trim().toLowerCase();
  const fmt = (d) =>
    d.toLocaleString(locale, {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  // Horodatage Unix (secondes ou millisecondes)
  const ts = /^(\d{9,14})$/.exec(s);
  if (ts) {
    const n = parseInt(ts[1], 10);
    const d = new Date(ts[1].length > 11 ? n : n * 1000);
    if (Number.isNaN(d.getTime())) return null;
    return { title: fmt(d), detail: `Horodatage Unix ${ts[1]}`, copy: d.toISOString() };
  }

  // Calcul de date : « aujourd'hui + 30 jours », « today - 2 weeks »
  const dm = /^(?:aujourd(?:'|’)?hui|today|now|maintenant)\s*([+-])\s*(\d+)\s*([a-zé]+)$/.exec(s);
  if (dm) {
    const unit = dm[3];
    const factor = UNITS.time.units[unit];
    if (!factor) return null;
    const delta = parseInt(dm[2], 10) * factor * 1000 * (dm[1] === '-' ? -1 : 1);
    const d = new Date(now.getTime() + delta);
    return {
      title: fmt(d),
      detail: `${dm[1] === '-' ? '−' : '+'} ${dm[2]} ${unit} à partir d’aujourd’hui`,
      copy: d.toISOString().slice(0, 10),
    };
  }

  if (/^(now|maintenant|heure|time|date|aujourd|today)/.test(s)) {
    const epoch = Math.floor(now.getTime() / 1000);
    return {
      title: fmt(now),
      detail: `Horodatage Unix ${epoch} · ISO ${now.toISOString()}`,
      copy: String(epoch),
    };
  }

  return null;
}

// « 100 usd en eur » — taux récupérés en ligne, mis en cache 12 h.
const RATE_CACHE_KEY = 'orbit.fx.rates';
const CURRENCIES = new Set([
  'usd', 'eur', 'gbp', 'chf', 'jpy', 'cny', 'cad', 'aud', 'mga', 'mad', 'xof', 'xaf',
  'zar', 'inr', 'brl', 'rub', 'sek', 'nok', 'dkk', 'pln', 'try', 'krw', 'mxn', 'aed',
  'sgd', 'hkd', 'nzd', 'thb', 'ils', 'egp', 'ngn', 'kes', 'tnd', 'dzd', 'mur',
]);

export function parseCurrencyQuery(input) {
  const m = new RegExp(`^${NUM}\\s*([a-zA-Z]{3})\\s+${SEPARATORS}\\s+([a-zA-Z]{3})$`, 'i').exec(
    String(input || '').trim()
  );
  if (!m) return null;
  const from = m[2].toLowerCase();
  const to = m[3].toLowerCase();
  if (!CURRENCIES.has(from) || !CURRENCIES.has(to) || from === to) return null;
  return { amount: parseFloat(m[1].replace(',', '.')), from, to };
}

// Taux base USD, en cache local (12 h). Silencieux en cas d'échec réseau :
// la palette affiche simplement les autres résultats.
export async function fetchRates() {
  try {
    const raw = localStorage.getItem(RATE_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && Date.now() - cached.at < 12 * 3600 * 1000 && cached.rates) return cached.rates;
    }
  } catch { /* cache illisible : on refait l'appel */ }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const json = await res.json();
    if (!json || json.result !== 'success' || !json.rates) return null;
    try {
      localStorage.setItem(RATE_CACHE_KEY, JSON.stringify({ at: Date.now(), rates: json.rates }));
    } catch { /* quota : tant pis, on ne met pas en cache */ }
    return json.rates;
  } catch {
    return null;
  }
}

export function convertCurrency(query, rates, locale = 'fr-FR') {
  if (!query || !rates) return null;
  const rFrom = rates[query.from.toUpperCase()];
  const rTo = rates[query.to.toUpperCase()];
  if (!rFrom || !rTo) return null;
  const out = (query.amount / rFrom) * rTo;
  return {
    value: out,
    text: `${out.toLocaleString(locale, { maximumFractionDigits: 2 })} ${query.to.toUpperCase()}`,
    detail: `1 ${query.from.toUpperCase()} = ${(rTo / rFrom).toLocaleString(locale, {
      maximumFractionDigits: 4,
    })} ${query.to.toUpperCase()}`,
  };
}
