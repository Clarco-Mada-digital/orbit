// ---------------------------------------------------------------------------
// Météo — source unique de vérité, partagée par le widget de l'en-tête
// (components/topbar/WeatherWidget.jsx) et la carte de la page d'accueil
// (components/HomeDashboard.jsx). Open-Meteo : API publique, sans clé ni
// compte. La position vient de la ville saisie dans les réglages (géocodage
// Open-Meteo) — jamais de géolocalisation silencieuse.
// ---------------------------------------------------------------------------

export const WEATHER_CACHE_KEY = 'orbit.weather.cache';
export const WEATHER_REFRESH_MS = 15 * 60 * 1000;

// Codes météo WMO → emoji + libellé
export const WMO = {
  0: ['☀️', 'Ciel dégagé'],
  1: ['🌤️', 'Plutôt dégagé'],
  2: ['⛅', 'Partiellement nuageux'],
  3: ['☁️', 'Couvert'],
  45: ['🌫️', 'Brouillard'],
  48: ['🌫️', 'Brouillard givrant'],
  51: ['🌦️', 'Bruine légère'],
  53: ['🌦️', 'Bruine'],
  55: ['🌦️', 'Bruine dense'],
  61: ['🌧️', 'Pluie faible'],
  63: ['🌧️', 'Pluie'],
  65: ['🌧️', 'Pluie forte'],
  66: ['🌧️', 'Pluie verglaçante'],
  67: ['🌧️', 'Pluie verglaçante forte'],
  71: ['🌨️', 'Neige faible'],
  73: ['🌨️', 'Neige'],
  75: ['❄️', 'Neige forte'],
  77: ['🌨️', 'Grains de neige'],
  80: ['🌦️', 'Averses'],
  81: ['🌧️', 'Averses'],
  82: ['⛈️', 'Fortes averses'],
  85: ['🌨️', 'Averses de neige'],
  86: ['❄️', 'Fortes averses de neige'],
  95: ['⛈️', 'Orage'],
  96: ['⛈️', 'Orage et grêle'],
  99: ['⛈️', 'Orage violent'],
};
export const describeWeather = (code) => WMO[code] || ['🌡️', '—'];

// 'metric' | 'imperial' → unité attendue par l'API Open-Meteo
export const weatherUnit = (units) => (units === 'imperial' ? 'fahrenheit' : 'celsius');

// Clé de cache : la ville ET l'unité, sinon changer d'unité afficherait
// l'ancienne valeur.
const cacheKey = (city, units) => `${city}|${weatherUnit(units)}`;

// Météo en cache si elle est encore fraîche, sinon null.
export function readWeatherCache(city, units) {
  if (!city) return null;
  try {
    const raw = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || 'null');
    if (raw && raw.key === cacheKey(city, units) && Date.now() - raw.at < WEATHER_REFRESH_MS) {
      return raw.data;
    }
  } catch {
    /* cache illisible : on retapera l'API */
  }
  return null;
}

export function writeWeatherCache(city, units, data) {
  try {
    localStorage.setItem(
      WEATHER_CACHE_KEY,
      JSON.stringify({ key: cacheKey(city, units), at: Date.now(), data })
    );
  } catch {
    /* quota : tant pis, on reviendra à l'API */
  }
}

// Va chercher la météo. Lève une erreur si la ville est introuvable ou si
// l'API ne répond rien — l'appelant décide quoi afficher.
export async function fetchWeather(city, units) {
  const unit = weatherUnit(units);
  const geo = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`
  ).then((r) => r.json());
  const place = geo?.results?.[0];
  if (!place) throw new Error('ville introuvable');
  const w = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=4&timezone=auto` +
      `&temperature_unit=${unit}&wind_speed_unit=${unit === 'fahrenheit' ? 'mph' : 'kmh'}`
  ).then((r) => r.json());
  if (!w?.current) throw new Error('météo indisponible');
  return {
    place: `${place.name}${place.country_code ? `, ${place.country_code}` : ''}`,
    current: w.current,
    daily: w.daily,
    windUnit: unit === 'fahrenheit' ? 'mph' : 'km/h',
    tempUnit: unit === 'fahrenheit' ? '°F' : '°C',
  };
}
