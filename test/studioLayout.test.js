import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  containRect,
  coverRect,
  contentBox,
  cameraBox,
  composeLayout,
  zoomSourceRect,
  easeFocus,
  cursorFocus,
  recordingName,
  formatDuration,
  DEFAULT_STYLE,
  FRAME_RATES,
  fpsHealth,
  haloPoint,
  applyStudioKey,
  directStudioKey,
  nextInList,
  BACKGROUNDS,
} from '../src/lib/studioLayout.js';

// La mise en page décide de ce que le spectateur verra. Une erreur ici ne se
// voit qu'APRÈS l'enregistrement, quand il est trop tard pour recommencer :
// d'où ces tests sur les cas qui abîment une vidéo (contenu coupé, pastille
// hors cadre, zoom qui montre du vide).

test('« contain » montre toute la capture, sans déformation', () => {
  // Une source 16/9 dans une boîte carrée : bandes en haut et en bas.
  const r = containRect(1600, 900, 0, 0, 1000, 1000);
  assert.equal(Math.round(r.w), 1000);
  assert.equal(Math.round(r.h), 563);
  assert.equal(Math.round(r.x), 0);
  assert.equal(Math.round(r.y), 219, 'la capture est centrée verticalement');
  // Le rapport d'origine est préservé : pas d'écran étiré.
  assert.ok(Math.abs(r.w / r.h - 1600 / 900) < 0.01);
});

test('« cover » remplit la boîte : pas de vide autour d’un visage', () => {
  const r = coverRect(1280, 720, 0, 0, 200, 200);
  assert.ok(r.w >= 200 && r.h >= 200);
  assert.ok(Math.abs(r.w / r.h - 1280 / 720) < 0.01);
  // Le débordement est centré, donc coupé symétriquement.
  assert.equal(Math.round(r.x + r.w / 2), 100);
});

test('une source absente ne fait pas planter le cadrage', () => {
  assert.deepEqual(containRect(0, 0, 10, 20, 100, 50), { x: 10, y: 20, w: 0, h: 0 });
  assert.deepEqual(coverRect(100, 100, 0, 0, 0, 0), { x: 0, y: 0, w: 0, h: 0 });
});

test('la marge se calcule sur la PLUS PETITE dimension', () => {
  // Sur du 16/9, un pourcentage de la largeur donnerait des bandes hautes
  // ridicules par rapport aux bandes latérales.
  const box = contentBox(1920, 1080, 10);
  assert.equal(box.x, 108);
  assert.equal(box.y, 108);
  assert.equal(box.w, 1920 - 216);
  assert.equal(box.h, 1080 - 216);
});

test('la marge est bornée : aucun réglage ne fait disparaître l’image', () => {
  const box = contentBox(1000, 1000, 999);
  assert.ok(box.w > 0 && box.h > 0);
  assert.deepEqual(contentBox(1000, 1000, -5), { x: 0, y: 0, w: 1000, h: 1000 });
});

test('la pastille caméra reste dans le cadre, aux quatre coins', () => {
  const box = contentBox(1920, 1080, 5);
  for (const corner of ['bottom-left', 'bottom-right', 'top-left', 'top-right']) {
    const cam = cameraBox(box, { cameraSize: 22, cameraCorner: corner }, 1080);
    assert.ok(cam.x >= box.x, `${corner} : déborde à gauche`);
    assert.ok(cam.y >= box.y, `${corner} : déborde en haut`);
    assert.ok(cam.x + cam.w <= box.x + box.w + 0.01, `${corner} : déborde à droite`);
    assert.ok(cam.y + cam.h <= box.y + box.h + 0.01, `${corner} : déborde en bas`);
  }
});

test('une taille de caméra absurde est ramenée dans des bornes utilisables', () => {
  const box = contentBox(1920, 1080, 5);
  const enorme = cameraBox(box, { cameraSize: 500, cameraCorner: 'top-left' }, 1080);
  assert.ok(enorme.w <= 1080 * 0.5);
  const minuscule = cameraBox(box, { cameraSize: 0, cameraCorner: 'top-left' }, 1080);
  assert.ok(minuscule.w >= 1080 * 0.06);
});

test('sans caméra, toutes les dispositions retombent sur l’écran seul', () => {
  for (const layout of ['camera', 'split', 'presentation']) {
    const plan = composeLayout({
      outW: 1920,
      outH: 1080,
      style: { ...DEFAULT_STYLE, layout },
      hasCamera: false,
    });
    assert.equal(plan.camera, null, `${layout} sans caméra`);
    assert.ok(plan.screen.w > 0, `${layout} : l'écran doit rester affiché`);
  }
});

test('disposition « caméra seule » : pas d’écran, caméra plein cadre', () => {
  const plan = composeLayout({
    outW: 1920,
    outH: 1080,
    style: { ...DEFAULT_STYLE, layout: 'camera' },
    hasCamera: true,
  });
  assert.equal(plan.screen, null);
  assert.ok(plan.camera.full);
  assert.ok(plan.camera.w > 1000);
});

test('disposition « côte à côte » : deux moitiés qui ne se chevauchent pas', () => {
  const plan = composeLayout({
    outW: 1920,
    outH: 1080,
    style: { ...DEFAULT_STYLE, layout: 'split' },
    hasCamera: true,
  });
  assert.ok(plan.screen.x + plan.screen.w <= plan.camera.x, 'les deux zones se chevauchent');
  assert.ok(Math.abs(plan.screen.w - plan.camera.w) < 1, 'les moitiés doivent être égales');
});

test('disposition « présentation » : l’écran reste le plus grand', () => {
  const plan = composeLayout({
    outW: 1920,
    outH: 1080,
    style: { ...DEFAULT_STYLE, layout: 'presentation' },
    hasCamera: true,
  });
  assert.ok(plan.screen.w > plan.camera.w, 'la capture doit dominer');
});

test('chevauchement : la pastille MORD sur la capture, et passe devant', () => {
  const avec = composeLayout({
    outW: 1920,
    outH: 1080,
    style: { ...DEFAULT_STYLE, layout: 'presentation', cameraOverlap: true },
    hasCamera: true,
  });
  // C'est ce recouvrement qui donne l'allure « plateau » plutôt que deux
  // fenêtres posées côte à côte.
  assert.ok(avec.screen.x + avec.screen.w > avec.camera.x, 'aucun recouvrement');
  assert.equal(avec.camera.over, true, 'la caméra doit être dessinée par-dessus');

  const sans = composeLayout({
    outW: 1920,
    outH: 1080,
    style: { ...DEFAULT_STYLE, layout: 'presentation', cameraOverlap: false },
    hasCamera: true,
  });
  assert.ok(sans.screen.x + sans.screen.w <= sans.camera.x + 1, 'sans chevauchement, les zones sont disjointes');
});

test('le côté de la caméra inverse bien les deux zones', () => {
  const droite = composeLayout({
    outW: 1920, outH: 1080, hasCamera: true,
    style: { ...DEFAULT_STYLE, layout: 'split', cameraSide: 'right' },
  });
  const gauche = composeLayout({
    outW: 1920, outH: 1080, hasCamera: true,
    style: { ...DEFAULT_STYLE, layout: 'split', cameraSide: 'left' },
  });
  assert.ok(droite.camera.x > droite.screen.x, 'caméra à droite');
  assert.ok(gauche.camera.x < gauche.screen.x, 'caméra à gauche');
  // Les deux moitiés restent égales dans les deux sens.
  assert.ok(Math.abs(droite.screen.w - gauche.screen.w) < 1);
});

test('en « présentation », une pastille ronde reste ronde', () => {
  // Une caméra « circle » étirée sur toute la hauteur donnerait un ovale.
  const plan = composeLayout({
    outW: 1920, outH: 1080, hasCamera: true,
    style: { ...DEFAULT_STYLE, layout: 'presentation', cameraShape: 'circle' },
  });
  assert.equal(plan.camera.shape, 'circle');
  assert.equal(Math.round(plan.camera.w), Math.round(plan.camera.h), 'la pastille doit être carrée pour être ronde');
});

test('le zoom ne montre jamais de vide hors de l’image', () => {
  // Curseur au coin : le rectangle doit se coller au bord, pas le dépasser.
  for (const focus of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 0.5 }]) {
    const r = zoomSourceRect(1920, 1080, focus, 2);
    assert.ok(r.sx >= 0 && r.sy >= 0, 'coin négatif');
    assert.ok(r.sx + r.sw <= 1920.01, 'dépasse à droite');
    assert.ok(r.sy + r.sh <= 1080.01, 'dépasse en bas');
  }
});

test('zoom à 1 (ou absurde) : l’image entière, sans calcul inutile', () => {
  assert.deepEqual(zoomSourceRect(800, 600, { x: 0.2, y: 0.2 }, 1), { sx: 0, sy: 0, sw: 800, sh: 600 });
  const borne = zoomSourceRect(800, 600, { x: 0.5, y: 0.5 }, 99);
  assert.ok(borne.sw >= 800 / 4, 'le zoom est plafonné');
  const invalide = zoomSourceRect(800, 600, null, 0);
  assert.deepEqual(invalide, { sx: 0, sy: 0, sw: 800, sh: 600 });
});

test('le suivi du curseur est amorti, jamais instantané', () => {
  // Un zoom qui colle au curseur donne une vidéo nerveuse.
  const apres = easeFocus({ x: 0, y: 0 }, { x: 1, y: 1 }, 0.1);
  assert.ok(apres.x > 0 && apres.x < 0.2, 'le déplacement doit être partiel');
  // Et il converge bien vers la cible.
  let p = { x: 0, y: 0 };
  for (let i = 0; i < 200; i += 1) p = easeFocus(p, { x: 1, y: 1 }, 0.2);
  assert.ok(p.x > 0.99 && p.y > 0.99);
  // Reste borné même avec un facteur aberrant.
  const brutal = easeFocus({ x: 0.5, y: 0.5 }, { x: 5, y: -5 }, 9);
  assert.ok(brutal.x <= 1 && brutal.y >= 0);
});

test('le curseur est ramené en coordonnées relatives à l’écran capturé', () => {
  const ecran = { x: 1920, y: 0, width: 1920, height: 1080 }; // second moniteur
  assert.deepEqual(cursorFocus({ x: 2880, y: 540 }, ecran), { x: 0.5, y: 0.5 });
  // Un curseur sur l'AUTRE écran est ramené au bord, pas projeté hors cadre.
  assert.deepEqual(cursorFocus({ x: 0, y: 0 }, ecran), { x: 0, y: 0 });
  assert.deepEqual(cursorFocus(null, ecran), { x: 0.5, y: 0.5 });
  assert.deepEqual(cursorFocus({ x: 10, y: 10 }, null), { x: 0.5, y: 0.5 });
});

test('nom de fichier et durée sont lisibles', () => {
  const nom = recordingName(new Date(2026, 10, 1, 9, 5, 3), 'webm');
  assert.equal(nom, 'Orbit 2026-11-01 09h05m03s.webm');
  assert.match(recordingName(new Date(), 'mp4'), /\.mp4$/);
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65_000), '1:05');
  assert.equal(formatDuration(3_725_000), '1:02:05');
  assert.equal(formatDuration(-10), '0:00');
});

// --- Cadence ---------------------------------------------------------------
// L'encodage se fait par le processeur. Sur une machine chargée, demander
// 30 images par seconde en produit 5 : la vidéo est saccadée et on ne le
// découvre qu'à la relecture. D'où l'affichage de la cadence TENUE.

test('la santé de la cadence distingue « ça suit » de « ça décroche »', () => {
  assert.equal(fpsHealth(24, 24), 'ok');
  assert.equal(fpsHealth(15, 24), 'ok', '62 % de la cible reste regardable');
  assert.equal(fpsHealth(5, 30), 'low');
  assert.equal(fpsHealth(2, 24), 'low');
  // Tant qu'on ne sait pas, on n'alarme pas.
  assert.equal(fpsHealth(0, 24), 'unknown');
  assert.equal(fpsHealth(24, 0), 'unknown');
});

test('les cadences proposées vont du sûr au confortable', () => {
  assert.deepEqual(FRAME_RATES, [15, 24, 30]);
  assert.equal(DEFAULT_STYLE.fps, 24, 'un défaut tenable plutôt que flatteur');
  assert.equal(DEFAULT_STYLE.resolution, '720p');
});

// --- Halo du pointeur ------------------------------------------------------
// Dans un cadre réduit avec une marge, le curseur fait quelques pixels : le
// spectateur passe son temps à le chercher. Le halo doit tomber EXACTEMENT
// dessus, sinon il désigne le vide.

test('le halo se pose au bon endroit dans le cadre dessiné', () => {
  const fit = { x: 100, y: 50, w: 800, h: 450 };
  // Curseur au centre de la source, sans zoom → centre du cadre.
  const centre = haloPoint({ x: 0.5, y: 0.5 }, null, 1600, 900, fit);
  assert.equal(Math.round(centre.x), 500);
  assert.equal(Math.round(centre.y), 275);
  // Coin supérieur gauche de la source → coin du cadre.
  const coin = haloPoint({ x: 0, y: 0 }, null, 1600, 900, fit);
  assert.equal(Math.round(coin.x), 100);
  assert.equal(Math.round(coin.y), 50);
  assert.ok(coin.r > 0);
});

test('avec zoom, le halo suit la portion réellement affichée', () => {
  const fit = { x: 0, y: 0, w: 800, h: 450 };
  // On n'affiche que le quart haut-gauche de la source.
  const source = { sx: 0, sy: 0, sw: 800, sh: 450 };
  const dedans = haloPoint({ x: 0.25, y: 0.25 }, source, 1600, 900, fit);
  assert.equal(Math.round(dedans.x), 400, 'le point doit être remis à l’échelle du zoom');
  // Un curseur HORS de la portion affichée ne doit pas être épinglé au bord.
  assert.equal(haloPoint({ x: 0.9, y: 0.9 }, source, 1600, 900, fit), null);
});

test('sans cadre exploitable, pas de halo plutôt qu’un halo faux', () => {
  assert.equal(haloPoint({ x: 0.5, y: 0.5 }, null, 1600, 900, null), null);
  assert.equal(haloPoint({ x: 0.5, y: 0.5 }, null, 0, 0, { x: 0, y: 0, w: 10, h: 10 }), null);
});

test('un curseur au bord (0) est respecté, pas confondu avec « absent »', () => {
  // `Number(v) || 0.5` traitait 0 comme une valeur manquante : le zoom sautait
  // au centre juste quand on travaillait dans le coin gauche.
  const bordGauche = zoomSourceRect(1600, 900, { x: 0, y: 0.5 }, 2);
  assert.equal(bordGauche.sx, 0, 'le cadrage doit se coller au bord gauche');
  const centre = zoomSourceRect(1600, 900, { x: 0.5, y: 0.5 }, 2);
  assert.equal(centre.sx, 400);
  // Une valeur réellement absente retombe bien au centre.
  assert.equal(zoomSourceRect(1600, 900, {}, 2).sx, 400);
  assert.equal(haloPoint({ x: 0, y: 0 }, null, 1600, 900, { x: 0, y: 0, w: 800, h: 450 }).x, 0);
});

// --- Raccourcis ------------------------------------------------------------
// Changer de fond à la souris pendant qu'on parle oblige à rouvrir le panneau,
// donc à sortir du cadre. Ces touches existent pour ça : elles doivent faire
// défiler les choix sans jamais mener à une option sans effet.

test('les touches font défiler fonds, dispositions et coins', () => {
  assert.deepEqual(applyStudioKey('f', { background: 'indigo' }), { background: 'sunset' });
  assert.deepEqual(applyStudioKey('c', { cameraCorner: 'bottom-left' }), { cameraCorner: 'bottom-right' });
  // En boucle : on n'est jamais bloqué au bout de la liste.
  const fonds = Object.keys(BACKGROUNDS);
  assert.deepEqual(applyStudioKey('f', { background: fonds[fonds.length - 1] }), { background: fonds[0] });
});

test('sans caméra, la touche « disposition » saute celles qui en exigent une', () => {
  // Proposer « côte à côte » sans caméra mènerait à un choix sans effet.
  assert.deepEqual(applyStudioKey('d', { layout: 'screen' }, { hasCamera: false }), { layout: 'presentation' });
  assert.deepEqual(applyStudioKey('d', { layout: 'presentation' }, { hasCamera: false }), { layout: 'screen' });
  // Avec caméra, les quatre sont parcourues.
  assert.deepEqual(applyStudioKey('d', { layout: 'screen' }, { hasCamera: true }), { layout: 'camera' });
});

test('les interrupteurs basculent, et les touches inconnues ne font rien', () => {
  assert.deepEqual(applyStudioKey('z', { zoom: false }), { zoom: true });
  assert.deepEqual(applyStudioKey('h', { cursorHalo: true }), { cursorHalo: false });
  assert.deepEqual(applyStudioKey('m', { cameraMirror: true }), { cameraMirror: false });
  assert.equal(applyStudioKey('q', {}), null);
  assert.equal(applyStudioKey('', {}), null);
  assert.equal(applyStudioKey(undefined, {}), null);
  // Pause, arrêt et réduction relèvent du composant, pas du style.
  assert.equal(applyStudioKey('p', {}), null);
  assert.equal(applyStudioKey('s', {}), null);
  assert.equal(applyStudioKey('r', {}), null);
});

test('la touche est insensible à la casse', () => {
  assert.deepEqual(applyStudioKey('F', { background: 'indigo' }), { background: 'sunset' });
});

test('nextInList ne plante pas sur une liste vide ou une valeur inconnue', () => {
  assert.equal(nextInList([], 'x'), 'x');
  assert.equal(nextInList(null, 'x'), 'x');
  // Valeur absente de la liste : on repart du début plutôt que de rester bloqué.
  assert.equal(nextInList(['a', 'b'], 'inconnu'), 'a');
});

// --- Présentation sans caméra ----------------------------------------------
test('« présentation » existe aussi sans caméra : la capture est mise en scène', () => {
  const plan = composeLayout({
    outW: 1280, outH: 720, hasCamera: false,
    style: { ...DEFAULT_STYLE, layout: 'presentation' },
  });
  assert.equal(plan.camera, null);
  const pleinCadre = composeLayout({
    outW: 1280, outH: 720, hasCamera: false,
    style: { ...DEFAULT_STYLE, layout: 'screen' },
  });
  // Plus petite que le plein cadre, et centrée : c'est l'allure « diapositive ».
  assert.ok(plan.screen.w < pleinCadre.screen.w, 'la capture doit être réduite');
  assert.equal(
    Math.round(plan.screen.x + plan.screen.w / 2),
    Math.round(pleinCadre.screen.x + pleinCadre.screen.w / 2),
    'elle doit rester centrée'
  );
});

// --- Accès direct ----------------------------------------------------------
// Faire défiler convient quand on cherche ; quand on SAIT ce qu'on veut, il
// faut y aller d'un coup — surtout en plein enregistrement.

test('les chiffres mènent directement à une disposition', () => {
  assert.deepEqual(directStudioKey('1', {}, {}, { hasCamera: true }), { layout: 'screenOnly' });
  assert.deepEqual(directStudioKey('2', {}, {}, { hasCamera: true }), { layout: 'screen' });
  assert.deepEqual(directStudioKey('5', {}, {}, { hasCamera: true }), { layout: 'presentation' });
  // Au-delà de la liste, on ne change rien plutôt que de retomber au hasard.
  assert.equal(directStudioKey('9', {}, {}, { hasCamera: true }), null);
});

test('sans caméra, les chiffres ne proposent que ce qui a un sens', () => {
  assert.deepEqual(directStudioKey('1', {}, {}, { hasCamera: false }), { layout: 'screen' });
  assert.deepEqual(directStudioKey('2', {}, {}, { hasCamera: false }), { layout: 'presentation' });
  assert.equal(directStudioKey('3', {}, {}, { hasCamera: false }), null);
});

test('Maj + chiffre mène directement à un fond', () => {
  const fonds = Object.keys(BACKGROUNDS);
  assert.deepEqual(directStudioKey('1', { shift: true }, {}), { background: fonds[0] });
  assert.deepEqual(directStudioKey('8', { shift: true }, {}), { background: fonds[7] });
  assert.equal(directStudioKey('9', { shift: true }, {}), null);
});

test('les flèches placent la caméra un axe à la fois', () => {
  // ↑ ne touche qu'à la verticale : le côté gauche/droite est conservé.
  assert.deepEqual(directStudioKey('ArrowUp', {}, { cameraCorner: 'bottom-left' }), {
    cameraCorner: 'top-left',
  });
  assert.deepEqual(directStudioKey('ArrowDown', {}, { cameraCorner: 'top-right' }), {
    cameraCorner: 'bottom-right',
  });
  // ← et → règlent AUSSI le côté, qui sert aux dispositions à deux zones.
  assert.deepEqual(directStudioKey('ArrowRight', {}, { cameraCorner: 'top-left' }), {
    cameraCorner: 'top-right',
    cameraSide: 'right',
  });
  assert.deepEqual(directStudioKey('ArrowLeft', {}, { cameraCorner: 'bottom-right' }), {
    cameraCorner: 'bottom-left',
    cameraSide: 'left',
  });
});

test('une touche sans rôle ne modifie rien', () => {
  assert.equal(directStudioKey('q', {}, {}), null);
  assert.equal(directStudioKey('Enter', {}, {}), null);
});

// --- Écran seul ------------------------------------------------------------
test('« écran seul » masque la pastille sans débrancher la caméra', () => {
  // On explique en plein écran, puis on se réaffiche : le périphérique reste
  // choisi, seule la composition change.
  const plan = composeLayout({
    outW: 1280, outH: 720, hasCamera: true,
    style: { ...DEFAULT_STYLE, layout: 'screenOnly' },
  });
  assert.equal(plan.camera, null, 'aucune pastille dessinée');
  const pleinCadre = composeLayout({
    outW: 1280, outH: 720, hasCamera: true,
    style: { ...DEFAULT_STYLE, layout: 'screen' },
  });
  assert.equal(plan.screen.w, pleinCadre.screen.w, 'la capture garde toute la place');
  assert.ok(pleinCadre.camera, 'la disposition voisine, elle, affiche bien la pastille');
});
