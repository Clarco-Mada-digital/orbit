// ---------------------------------------------------------------------------
// Détection d'un média téléchargeable (src/lib/mediaDetect.js).
//
// L'enjeu est la CRÉDIBILITÉ du bouton. Un bouton qui apparaît sur un fond
// animé ou sur une page d'accueil, puis échoue, apprend à l'utilisateur à
// l'ignorer — et la fonctionnalité est morte même quand elle marche.
// ---------------------------------------------------------------------------
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostOf,
  isKnownMediaHost,
  isKnownMediaPage,
  shouldOfferMedia,
  surfaceFlags,
} from '../src/lib/mediaDetect.js';

test('hostOf : hôte sans « www », en minuscules', () => {
  assert.equal(hostOf('https://WWW.YouTube.com/watch?v=x'), 'youtube.com');
  assert.equal(hostOf('pas une url'), '');
});

test('isKnownMediaHost : le site et ses sous-domaines', () => {
  assert.ok(isKnownMediaHost('https://www.youtube.com/watch?v=x'));
  assert.ok(isKnownMediaHost('https://m.facebook.com/watch/?v=1'));
  assert.ok(isKnownMediaHost('https://youtu.be/abc'));
  assert.ok(!isKnownMediaHost('https://exemple.fr/video'));
  // Un hôte qui se termine par le nom sans en être un sous-domaine
  assert.ok(!isKnownMediaHost('https://notyoutube.com/x'));
});

test('isKnownMediaPage : une page de vidéo, pas l’accueil du site', () => {
  assert.ok(isKnownMediaPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  assert.ok(isKnownMediaPage('https://www.facebook.com/reel/123'));
  // L'accueil et la recherche ne portent pas de média à télécharger
  assert.ok(!isKnownMediaPage('https://www.youtube.com/'));
  assert.ok(!isKnownMediaPage('https://www.youtube.com/results?search_query=chat'));
  assert.ok(!isKnownMediaPage('https://www.facebook.com/login'));
  assert.ok(!isKnownMediaPage('https://exemple.fr/watch?v=1'));
});

test('isKnownMediaPage : une vidéo atteinte depuis l’accueil reste détectée', () => {
  // youtube.com/?v=… : chemin nu mais la query dit bien « une vidéo »
  assert.ok(isKnownMediaPage('https://www.youtube.com/?v=dQw4w9WgXcQ'));
});

test('shouldOfferMedia : un site connu suffit, sans rien détecter', () => {
  const r = shouldOfferMedia({ url: 'https://www.youtube.com/watch?v=x', videos: [] });
  assert.equal(r.offer, true);
  assert.equal(r.reason, 'known-host');
});

test('shouldOfferMedia : ailleurs, une vraie vidéo est nécessaire', () => {
  const url = 'https://exemple.fr/article';
  assert.equal(shouldOfferMedia({ url, videos: [] }).offer, false);
  const withVideo = shouldOfferMedia({
    url,
    videos: [{ durationSeconds: 180, width: 1280, height: 720 }],
  });
  assert.equal(withVideo.offer, true);
  assert.equal(withVideo.reason, 'video-element');
});

test('shouldOfferMedia : un fond animé ou un aperçu au survol ne compte pas', () => {
  const url = 'https://exemple.fr/accueil';
  // Trop court (bannière en boucle)
  assert.equal(shouldOfferMedia({ url, videos: [{ durationSeconds: 4, width: 1920, height: 1080 }] }).offer, false);
  // Trop petit (vignette d'aperçu)
  assert.equal(shouldOfferMedia({ url, videos: [{ durationSeconds: 300, width: 120, height: 80 }] }).offer, false);
  // Une vraie vidéo au milieu de décorations : on propose quand même
  assert.equal(
    shouldOfferMedia({
      url,
      videos: [
        { durationSeconds: 3, width: 1920, height: 1080 },
        { durationSeconds: 420, width: 960, height: 540 },
      ],
    }).offer,
    true
  );
});

test('shouldOfferMedia : dimensions inconnues → on ne disqualifie pas', () => {
  // Une vidéo pas encore mesurée (métadonnées non chargées) ne doit pas être
  // écartée : sinon le bouton n'apparaît jamais sur une page lente.
  const r = shouldOfferMedia({
    url: 'https://exemple.fr/v',
    videos: [{ durationSeconds: NaN, width: 0, height: 0 }],
  });
  assert.equal(r.offer, true);
});

test('shouldOfferMedia : hors du web, rien', () => {
  for (const url of ['about:blank', 'file:///tmp/x.html', '', null]) {
    assert.equal(shouldOfferMedia({ url, videos: [{ durationSeconds: 99, width: 999, height: 999 }] }).offer, false);
  }
});

test('surfaceFlags : les quatre choix du réglage', () => {
  assert.deepEqual(surfaceFlags('both'), { overlay: true, topbar: true });
  assert.deepEqual(surfaceFlags('overlay'), { overlay: true, topbar: false });
  assert.deepEqual(surfaceFlags('topbar'), { overlay: false, topbar: true });
  assert.deepEqual(surfaceFlags('none'), { overlay: false, topbar: false });
});

test('surfaceFlags : une valeur inconnue retombe sur le défaut, pas sur le silence', () => {
  // Réglage écrit par une version future, ou fichier abîmé : la
  // fonctionnalité doit rester visible plutôt que disparaître sans raison.
  assert.deepEqual(surfaceFlags(undefined), { overlay: true, topbar: true });
  assert.deepEqual(surfaceFlags('n’importe quoi'), { overlay: true, topbar: true });
});

// --- Garde anti-dérive ----------------------------------------------------
//
// electron/media-button-preload.cjs RECOPIE la détection de ce module : un
// preload sandboxé ne peut pas `require` un fichier local. Les deux doivent
// donc rester d'accord, sinon le bouton apparaît sur une vidéo là où la
// pastille de la barre reste éteinte — un symptôme impossible à comprendre
// sans savoir que la règle existe en deux exemplaires.
//
// Ce test compare les deux listes littéralement. Il échouera dès qu'on ajoute
// un site d'un seul côté, ce qui est exactement le moment où on veut le voir.
test('la détection recopiée dans le preload ne dérive pas de ce module', async () => {
  const { readFileSync } = await import('node:fs');
  const hosts = (text) => {
    const match = /const KNOWN_HOSTS = \[([\s\S]*?)\];/.exec(text);
    assert.ok(match, 'KNOWN_HOSTS introuvable');
    return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  };
  const paths = (text) => {
    const match = /BARREN_PATHS\s*=\s*\n?\s*(\/\^.*?\/i)/.exec(text);
    assert.ok(match, 'BARREN_PATHS introuvable');
    return match[1];
  };
  const source = readFileSync('src/lib/mediaDetect.js', 'utf8');
  const copy = readFileSync('electron/media-button-preload.cjs', 'utf8');

  assert.deepEqual(hosts(copy), hosts(source), 'les sites connus diffèrent entre le module et le preload');
  assert.equal(paths(copy), paths(source), 'les pages sans média diffèrent entre le module et le preload');
});
