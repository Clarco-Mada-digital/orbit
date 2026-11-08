// ---------------------------------------------------------------------------
// Magasin d'extensions : catalogue distant et téléchargement des archives.
//
// Les ZIP ne voyagent plus DANS Orbit. Ils sont publiés à côté (GitHub Pages
// du dépôt) et descendus à la demande, ce qui règle deux choses d'un coup :
// l'application ne grossit pas de cent extensions que personne n'installera,
// et une extension corrigée n'attend pas la prochaine version d'Orbit.
//
// Tout ce qui arrive ici vient du réseau. La règle est donc simple : on ne
// croit ni le catalogue ni le serveur. Le nom de fichier est validé (logique
// pure, côté `src/lib/extensionCatalog.js`), l'URL de téléchargement ne peut
// pas quitter le dossier du catalogue, la taille est bornée pendant la
// réception — et l'archive n'est installée que si son empreinte SHA-256
// correspond à celle que le catalogue annonce.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import {
  EXTENSION_CATALOG_URL,
  MAX_CATALOG_BYTES,
  MAX_EXTENSION_BYTES,
  normalizeCatalog,
  extensionDownloadUrl,
  catalogIsStale,
} from '../src/lib/extensionCatalog.js';

const USER_AGENT = 'Orbit-Extensions';

// L'URL du catalogue, qu'un déploiement interne peut détourner sans
// recompiler. Lue à chaque appel : un redémarrage ne doit pas être nécessaire
// pour pointer ailleurs pendant une mise au point.
export function catalogUrl() {
  const override = String(process.env.ORBIT_EXTENSIONS_URL || '').trim();
  return override || EXTENSION_CATALOG_URL;
}

// GET HTTPS borné en taille ET en temps. La borne de taille est appliquée
// pendant la réception, pas après : un serveur qui annonce 2 Ko et en envoie
// deux gigaoctets est coupé au premier dépassement.
function httpGet(url, { timeoutMs = 15000, maxBytes, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('trop de redirections'));
      return;
    }
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // La redirection est suivie, mais l'appelant a déjà vérifié que l'URL
        // de DÉPART est celle du catalogue : une redirection ne peut que
        // changer l'hôte qui sert l'octet, pas l'empreinte attendue.
        resolve(httpGet(new URL(res.headers.location, url).toString(), {
          timeoutMs,
          maxBytes,
          redirects: redirects + 1,
        }));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`le serveur a répondu ${res.statusCode}`));
        return;
      }
      const chunks = [];
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (maxBytes && received > maxBytes) {
          req.destroy();
          reject(new Error('réponse trop volumineuse'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('délai réseau dépassé')));
    req.on('error', reject);
  });
}

function readCache(cachePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (!raw?.catalog) return null;
    return {
      url: String(raw.url || ''),
      fetchedAt: Number(raw.fetchedAt) || 0,
      // Le cache est RE-VALIDÉ à la lecture : il a pu être écrit par une
      // version antérieure, ou modifié sur le disque entre deux lancements.
      catalog: normalizeCatalog(raw.catalog),
    };
  } catch {
    return null;
  }
}

function writeCache(cachePath, url, catalog) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ url, fetchedAt: Date.now(), catalog }, null, 2)
    );
  } catch (err) {
    // Un cache qui ne s'écrit pas n'empêche pas d'installer : on le dit dans
    // la console et on continue avec le catalogue qu'on vient de recevoir.
    console.warn('[orbit] cache du catalogue d’extensions non écrit :', err.message);
  }
}

// Le catalogue, du réseau si possible, du cache sinon.
//
// Hors ligne, une liste datée vaut mieux qu'une liste vide : le magasin
// affiche alors la copie et la date à laquelle elle a été reçue. C'est aussi
// ce qui rend l'installation possible juste après une coupure, tant que
// l'archive demandée est encore celle que le cache décrit.
export async function fetchCatalog({ cachePath, refresh = false } = {}) {
  const url = catalogUrl();
  const cached = cachePath ? readCache(cachePath) : null;
  const usableCache = cached && cached.url === url ? cached : null;

  // Le cache frais répond sans réseau. `refresh` force le tour par le serveur
  // (bouton « Actualiser »).
  if (!refresh && usableCache && !catalogIsStale(usableCache.fetchedAt)) {
    return {
      success: true,
      url,
      extensions: usableCache.catalog.extensions,
      fetchedAt: usableCache.fetchedAt,
      stale: false,
      fromCache: true,
    };
  }

  try {
    const body = await httpGet(url, { maxBytes: MAX_CATALOG_BYTES });
    const catalog = normalizeCatalog(JSON.parse(body.toString('utf8')));
    if (cachePath) writeCache(cachePath, url, catalog);
    return {
      success: true,
      url,
      extensions: catalog.extensions,
      fetchedAt: Date.now(),
      stale: false,
      fromCache: false,
    };
  } catch (err) {
    if (usableCache) {
      return {
        success: true,
        url,
        extensions: usableCache.catalog.extensions,
        fetchedAt: usableCache.fetchedAt,
        stale: true,
        fromCache: true,
        error: String(err.message || err),
      };
    }
    return {
      success: false,
      url,
      extensions: [],
      fetchedAt: 0,
      stale: true,
      error: String(err.message || err),
    };
  }
}

// Télécharge l'archive d'une entrée du catalogue et rend son chemin local.
//
// Trois contrôles, dans cet ordre : l'URL reste dans le dossier du catalogue,
// la taille reçue ne dépasse pas ce qui est annoncé, l'empreinte correspond.
// Un seul qui échoue et le fichier est effacé — on ne garde pas une archive
// douteuse « au cas où ».
export async function downloadExtension({ entry, destDir, url = catalogUrl() } = {}) {
  if (!entry?.file || !entry?.sha256) {
    return { success: false, error: 'entrée de catalogue incomplète' };
  }
  const target = extensionDownloadUrl(url, entry.file);
  if (!target) {
    return { success: false, error: 'adresse de téléchargement refusée' };
  }
  const expectedSize = Number(entry.size) || 0;
  if (expectedSize <= 0 || expectedSize > MAX_EXTENSION_BYTES) {
    return { success: false, error: 'taille annoncée hors limites' };
  }

  let body = null;
  try {
    // La borne de réception est la taille ANNONCÉE, pas le plafond global :
    // une archive plus grosse que son entrée de catalogue n'est pas celle
    // qu'on a demandée.
    body = await httpGet(target, { timeoutMs: 60000, maxBytes: expectedSize });
  } catch (err) {
    return { success: false, error: `téléchargement impossible : ${err.message || err}` };
  }

  if (body.length !== expectedSize) {
    return {
      success: false,
      error: `taille inattendue (${body.length} octets au lieu de ${expectedSize})`,
    };
  }
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  if (digest !== String(entry.sha256).toLowerCase()) {
    return { success: false, error: 'empreinte SHA-256 incorrecte : archive refusée' };
  }

  try {
    fs.mkdirSync(destDir, { recursive: true });
    // Le nom local vient du nom de fichier DÉJÀ validé, préfixé pour qu'un
    // téléchargement en cours ne piétine pas le précédent.
    const zipPath = path.join(destDir, `${Date.now()}-${entry.file}`);
    fs.writeFileSync(zipPath, body);
    return { success: true, zipPath, bytes: body.length };
  } catch (err) {
    return { success: false, error: `écriture impossible : ${err.message || err}` };
  }
}
