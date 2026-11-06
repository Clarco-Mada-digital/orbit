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
  STUDIO_KEYS,
  directStudioKey,
  nextInList,
  BACKGROUNDS,
  screenToCanvas,
  PRESENTATION_FRAMINGS,
  framingOf,
  framingPatch,
  CAMERA_ALIGNS,
  inertReason,
  micLevel,
  voiceRingWidth,
  VOICE_FLOOR,
  zoomPulseLevel,
  ZOOM_PULSE_MS,
  titleCardPhase,
  TITLE_CARD_MS,
  stagingOf,
  savePreset,
  removePreset,
  presetPatch,
  MAX_PRESETS,
  easeInOut,
  tweenPlan,
  stepLayoutTransition,
  stepFade,
  LAYOUT_TRANSITION_MS,
  BACKGROUND_FADE_MS,
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

test('en « présentation », la caméra est une vignette, pas une colonne', () => {
  // L'information est dans la capture : à hauteur égale, les deux images se
  // disputaient le regard et la capture perdait de la place pour rien.
  const plan = composeLayout({
    outW: 1920, outH: 1080, hasCamera: true,
    style: { ...DEFAULT_STYLE, layout: 'presentation' },
  });
  assert.ok(plan.camera.h < plan.screen.h * 0.7, 'la pastille doit être nettement moins haute');
  // À MI-HAUTEUR : dans un coin, elle se confondrait avec « écran + pastille ».
  assert.equal(
    Math.round(plan.camera.y + plan.camera.h / 2),
    Math.round(plan.screen.y + plan.screen.h / 2),
    'la vignette doit être centrée en hauteur'
  );
  const coin = composeLayout({
    outW: 1920, outH: 1080, hasCamera: true,
    style: { ...DEFAULT_STYLE, layout: 'screen' },
  });
  assert.ok(
    Math.abs(plan.camera.y - coin.camera.y) > plan.camera.h / 2,
    'elle ne doit pas retomber là où se pose la pastille de « écran + pastille »'
  );
  // Et la capture garde presque toute la largeur.
  const pleinCadre = composeLayout({
    outW: 1920, outH: 1080, hasCamera: true,
    style: { ...DEFAULT_STYLE, layout: 'screen' },
  });
  assert.ok(plan.screen.w > pleinCadre.screen.w * 0.85, 'la capture doit rester large');
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

  // « Même format » : c'est le RAPPORT entre les deux images qui change, pas la
  // vignette. Une pastille qui change de taille avec le cadrage donnerait deux
  // mises en scène différentes au lieu de deux cadrages de la même.
  assert.equal(avec.camera.w, sans.camera.w, 'la vignette garde sa taille');
  assert.equal(avec.camera.h, sans.camera.h);
  assert.equal(avec.camera.y, sans.camera.y, 'et sa hauteur de pose');
  assert.equal(avec.camera.x, sans.camera.x, 'et sa place contre le bord');
});

test('le cadrage de la présentation se nomme, se lit et se bascule', () => {
  assert.deepEqual(PRESENTATION_FRAMINGS, ['overlap', 'spaced']);
  // Lecture : le réglage est stocké en booléen depuis l'origine, et un réglage
  // déjà enregistré sans ce champ doit rester « chevauché ».
  assert.equal(framingOf({}), 'overlap');
  assert.equal(framingOf({ cameraOverlap: true }), 'overlap');
  assert.equal(framingOf({ cameraOverlap: false }), 'spaced');
  assert.deepEqual(framingPatch('spaced'), { cameraOverlap: false });
  assert.deepEqual(framingPatch('overlap'), { cameraOverlap: true });
  // Et la touche fait l'aller-retour.
  assert.equal(STUDIO_KEYS.o, 'framing');
  assert.deepEqual(applyStudioKey('o', { cameraOverlap: true }), { cameraOverlap: false });
  assert.deepEqual(applyStudioKey('O', { cameraOverlap: false }), { cameraOverlap: true });
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

test('« A » annote l\'écran : une action du composant, pas de la mise en scène', () => {
  // La couche d'annotation est une FENÊTRE du processus principal : elle ne
  // change rien au style de la vidéo, donc `applyStudioKey` ne renvoie rien —
  // c'est le composant qui agit.
  assert.equal(STUDIO_KEYS.a, 'annotate');
  assert.equal(applyStudioKey('a', { zoom: false }), null);
  // Et elle ne doit marcher sur aucune autre action déjà attribuée.
  const actions = Object.values(STUDIO_KEYS);
  assert.equal(new Set(actions).size, actions.length, 'deux touches pour la même action');
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

// --- Enchaînements ---------------------------------------------------------
// Un changement de disposition en pleine phrase doit se voir comme un
// mouvement, pas comme une coupure.

test('l’enchaînement part de l’affiché et arrive exactement sur la cible', () => {
  const a = composeLayout({
    outW: 1280, outH: 720, hasCamera: true,
    style: { ...DEFAULT_STYLE, layout: 'screen' },
  });
  const b = composeLayout({
    outW: 1280, outH: 720, hasCamera: true,
    style: { ...DEFAULT_STYLE, layout: 'presentation' },
  });

  // Première image : rien à rattraper, on affiche la cible telle quelle.
  let state = stepLayoutTransition(null, a, 1000);
  assert.equal(state.plan, a);

  // Changement de cible : on repart de ce qui est à l'écran.
  state = stepLayoutTransition(state, b, 2000);
  assert.equal(state.plan, a, 'le premier pas ne doit pas sauter');

  // À mi-parcours, la géométrie est entre les deux.
  state = stepLayoutTransition(state, b, 2000 + LAYOUT_TRANSITION_MS / 2);
  assert.ok(state.plan.animating, 'un mouvement est en cours');
  const between = (v, x, y) => v > Math.min(x, y) && v < Math.max(x, y);
  assert.ok(between(state.plan.camera.w, a.camera.w, b.camera.w), 'largeur interpolée');
  assert.ok(between(state.plan.camera.y, a.camera.y, b.camera.y), 'position interpolée');

  // Au bout du temps imparti, on est sur la cible au pixel près — sinon la
  // composition finirait légèrement décalée pour le reste de la vidéo.
  state = stepLayoutTransition(state, b, 2000 + LAYOUT_TRANSITION_MS);
  assert.deepEqual(state.plan, b);
  assert.ok(!state.plan.animating);
});

test('une zone qui apparaît ou disparaît se révèle au lieu de surgir', () => {
  const avecEcran = composeLayout({
    outW: 1280, outH: 720, hasCamera: true,
    style: { ...DEFAULT_STYLE, layout: 'screen' },
  });
  const cameraSeule = composeLayout({
    outW: 1280, outH: 720, hasCamera: true,
    style: { ...DEFAULT_STYLE, layout: 'camera' },
  });

  const moitie = tweenPlan(avecEcran, cameraSeule, 0.5);
  assert.ok(moitie.screen, 'l’écran qui part reste dessiné le temps du fondu');
  assert.ok(moitie.screen.alpha > 0 && moitie.screen.alpha < 1, 'il doit s’effacer');
  assert.ok(moitie.screen.w < avecEcran.screen.w, 'et se resserrer vers son centre');

  const retour = tweenPlan(cameraSeule, avecEcran, 0.5);
  assert.ok(retour.screen.alpha > 0 && retour.screen.alpha < 1, 'et réapparaître de même');
});

test('deux changements rapprochés s’enchaînent sans retour en arrière', () => {
  const plans = ['screenOnly', 'screen', 'split'].map((layout) =>
    composeLayout({ outW: 1280, outH: 720, hasCamera: true, style: { ...DEFAULT_STYLE, layout } })
  );
  let state = stepLayoutTransition(null, plans[0], 0);
  state = stepLayoutTransition(state, plans[1], 100);
  state = stepLayoutTransition(state, plans[1], 100 + LAYOUT_TRANSITION_MS / 2);
  const milieu = state.plan.screen.w;
  // Nouvelle cible alors que le mouvement n'est pas terminé : le départ est la
  // position courante, pas l'ancienne cible.
  state = stepLayoutTransition(state, plans[2], 300);
  assert.equal(state.from.screen.w, milieu);
});

test('un réglage qu’on fait glisser suit le curseur, sans amortissement', () => {
  // Un enchaînement sur chaque pixel du glissement donnerait un réglage qui
  // répond avec un temps de retard, donc l'impression que l'application rame.
  const plan = (cameraSize) =>
    composeLayout({
      outW: 1280, outH: 720, hasCamera: true,
      style: { ...DEFAULT_STYLE, layout: 'screen', cameraSize },
    });
  let state = stepLayoutTransition(null, plan(22), 0);
  state = stepLayoutTransition(state, plan(23), 10);
  assert.deepEqual(state.plan, plan(23), 'un pas de réglage doit être immédiat');
  assert.ok(!state.plan.animating);

  // Un vrai changement de composition, lui, s'enchaîne.
  const presentation = composeLayout({
    outW: 1280, outH: 720, hasCamera: true,
    style: { ...DEFAULT_STYLE, layout: 'presentation' },
  });
  state = stepLayoutTransition(state, presentation, 20);
  state = stepLayoutTransition(state, presentation, 20 + LAYOUT_TRANSITION_MS / 2);
  assert.ok(state.plan.animating, 'changer de disposition doit se voir bouger');
});

test('le fondu de fond démarre à zéro et ne rejoue pas sans changement', () => {
  let fade = stepFade(null, 'indigo', 0);
  assert.equal(fade.t, 1, 'au démarrage, rien à fondre');
  assert.equal(fade.from, null);

  fade = stepFade(fade, 'sunset', 1000);
  assert.equal(fade.from, 'indigo');
  assert.equal(fade.t, 0);
  fade = stepFade(fade, 'sunset', 1000 + BACKGROUND_FADE_MS);
  assert.equal(fade.t, 1, 'le fondu doit se terminer');
});

test('easeInOut est accompagné aux deux bouts', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.ok(Math.abs(easeInOut(0.5) - 0.5) < 1e-9, 'symétrique au milieu');
  // Démarrage lent : c'est ce qui enlève l'impression de saut.
  assert.ok(easeInOut(0.1) < 0.1);
  assert.ok(easeInOut(0.9) > 0.9);
  // Valeurs hors bornes : bornées plutôt que divergentes.
  assert.equal(easeInOut(-5), 0);
  assert.equal(easeInOut(42), 1);
});

// --- Hauteur de pose de la vignette ----------------------------------------
test('la vignette se pose en haut, au milieu ou en bas', () => {
  // Le milieu d'abord : c'est le réglage par défaut, et « C » part de lui.
  assert.deepEqual(CAMERA_ALIGNS, ['middle', 'top', 'bottom']);
  assert.equal(DEFAULT_STYLE.cameraAlign, 'middle');
  const plan = (cameraAlign) =>
    composeLayout({
      outW: 1920, outH: 1080, hasCamera: true,
      style: { ...DEFAULT_STYLE, layout: 'presentation', cameraAlign },
    });
  const box = contentBox(1920, 1080, DEFAULT_STYLE.padding);
  assert.equal(Math.round(plan('top').camera.y), Math.round(box.y));
  assert.equal(
    Math.round(plan('bottom').camera.y + plan('bottom').camera.h),
    Math.round(box.y + box.h)
  );
  // Valeur absente ou inconnue : on retombe au milieu, jamais hors cadre.
  assert.equal(plan('milieu-du-milieu').camera.y, plan('middle').camera.y);
  assert.equal(plan(undefined).camera.y, plan('middle').camera.y);
});

test('« C » place la caméra là où il y a quelque chose à placer', () => {
  // En présentation, la vignette n'a pas de coin : la même touche règle sa
  // hauteur de pose plutôt que de ne rien faire.
  assert.deepEqual(applyStudioKey('c', { layout: 'presentation', cameraAlign: 'middle' }), {
    cameraAlign: 'top',
  });
  assert.deepEqual(applyStudioKey('c', { layout: 'screen', cameraCorner: 'bottom-left' }), {
    cameraCorner: 'bottom-right',
  });
  // Les flèches règlent les deux d'un coup : elles vont « en haut », et c'est
  // vrai dans les deux dispositions.
  assert.deepEqual(directStudioKey('ArrowUp', {}, { cameraCorner: 'bottom-left' }), {
    cameraCorner: 'top-left',
    cameraAlign: 'top',
  });
});

// --- Un raccourci sans effet visible ---------------------------------------
test('inertReason dit pourquoi un réglage ne se voit pas', () => {
  const avec = { hasCamera: true };
  // Le cas qui fait croire à une panne : le cadrage hors présentation.
  assert.equal(inertReason({ cameraOverlap: false }, { layout: 'screen' }, avec), 'needsPresentation');
  assert.equal(inertReason({ cameraAlign: 'top' }, { layout: 'split' }, avec), 'needsPresentation');
  assert.equal(inertReason({ cameraOverlap: false }, { layout: 'presentation' }, avec), null);
  // Sans caméra, tous les réglages de caméra sont muets.
  assert.equal(
    inertReason({ cameraOverlap: false }, { layout: 'presentation' }, { hasCamera: false }),
    'needsCamera'
  );
  // « Écran seul » garde la caméra branchée mais ne la dessine pas.
  assert.equal(inertReason({ cameraMirror: false }, { layout: 'screenOnly' }, avec), 'needsCamera');
  // Le coin ne concerne que « écran + pastille », le côté que les deux zones.
  assert.equal(inertReason({ cameraCorner: 'top-left' }, { layout: 'presentation' }, avec), 'needsBubble');
  assert.equal(inertReason({ cameraSide: 'left' }, { layout: 'screen' }, avec), 'needsTwoZones');
  // Ce qui se voit toujours ne déclenche aucune explication.
  assert.equal(inertReason({ background: 'dark' }, { layout: 'screen' }, avec), null);
  assert.equal(inertReason({ padding: 10 }, { layout: 'camera' }, avec), null);
  assert.equal(inertReason(null, {}, avec), null);
});

// --- Voix, coup de zoom, carton de titre -----------------------------------
test('le niveau de voix est une moyenne, pas une crête', () => {
  const silence = new Uint8Array(512).fill(128);
  assert.equal(micLevel(silence), 0);
  // Une seule impulsion dans un bloc silencieux doit rester un petit niveau :
  // sinon l'anneau sauterait sur chaque claquement de touche.
  const impulsion = new Uint8Array(512).fill(128);
  impulsion[0] = 255;
  assert.ok(micLevel(impulsion) < 0.05);
  // Un signal plein régime sature à 1.
  assert.ok(micLevel(new Uint8Array(512).fill(255)) > 0.99);
  assert.equal(micLevel(null), 0);
  assert.equal(micLevel([]), 0);
});

test('l’anneau ignore le bruit de fond et sature sur une voix forte', () => {
  assert.equal(voiceRingWidth(0), 0);
  assert.equal(voiceRingWidth(VOICE_FLOOR / 2), 0, 'le bruit de fond ne doit pas l’animer');
  assert.ok(voiceRingWidth(0.08) > 0 && voiceRingWidth(0.08) < 1);
  assert.equal(voiceRingWidth(0.5), 1);
  assert.equal(voiceRingWidth('bruit'), 0);
});

test('le coup de zoom entre, tient, puis ressort de lui-même', () => {
  const start = 10_000;
  assert.equal(zoomPulseLevel(0, start, 2), 1, 'aucun coup en cours');
  assert.equal(zoomPulseLevel(start, start, 2), 1, 'il part de l’image normale');
  const plein = zoomPulseLevel(start, start + ZOOM_PULSE_MS * 0.5, 2);
  assert.equal(plein, 2, 'il tient le zoom au milieu');
  assert.ok(zoomPulseLevel(start, start + ZOOM_PULSE_MS * 0.1, 2) > 1, 'il entre');
  assert.ok(zoomPulseLevel(start, start + ZOOM_PULSE_MS * 0.9, 2) < 2, 'il ressort');
  // Et surtout : il se termine. Un coup de zoom qui resterait collé
  // transformerait un geste en réglage subi pour le reste de la vidéo.
  assert.equal(zoomPulseLevel(start, start + ZOOM_PULSE_MS, 2), 1);
  assert.equal(zoomPulseLevel(start, start + 60_000, 2), 1);
});

test('le carton de titre s’efface, et le voile se lève avant lui', () => {
  assert.equal(titleCardPhase(0).text, 1);
  assert.equal(titleCardPhase(0).veil, 1);
  const milieu = titleCardPhase(TITLE_CARD_MS * 0.6);
  assert.ok(milieu.text < 1 && milieu.text > 0, 'le titre s’efface');
  assert.ok(milieu.veil < milieu.text, 'la composition se découvre SOUS le titre');
  // Passé le carton, plus rien — surtout pas un voile oublié sur la vidéo.
  assert.equal(titleCardPhase(TITLE_CARD_MS), null);
  assert.equal(titleCardPhase(99_999), null);
});

// --- Cadrages mémorisés ----------------------------------------------------
test('un cadrage garde la mise en scène, pas les réglages de machine', () => {
  const style = { ...DEFAULT_STYLE, layout: 'presentation', resolution: '1080p', fps: 30, title: 'Démo' };
  const staging = stagingOf(style);
  assert.equal(staging.layout, 'presentation');
  // Rappeler un cadrage ne doit pas remonter la définition : la vidéo
  // deviendrait saccadée sur une machine modeste, sans explication.
  assert.ok(!('resolution' in staging), 'la définition ne fait pas partie du cadrage');
  assert.ok(!('fps' in staging), 'la cadence non plus');
  assert.ok(!('title' in staging), 'ni le titre, qui change à chaque vidéo');
});

test('les cadrages s’enregistrent, s’écrasent par leur nom et se suppriment', () => {
  let presets = savePreset([], 'Démo client', { ...DEFAULT_STYLE, layout: 'presentation' });
  assert.equal(presets.length, 1);
  assert.equal(presets[0].style.layout, 'presentation');
  // Même nom : on corrige un cadrage en le réenregistrant, sans doublon.
  presets = savePreset(presets, 'Démo client', { ...DEFAULT_STYLE, layout: 'split' });
  assert.equal(presets.length, 1);
  assert.equal(presets[0].style.layout, 'split');
  // Un nom vide ne crée rien.
  assert.equal(savePreset(presets, '   ', DEFAULT_STYLE).length, 1);
  // Rappel par la position, et touche hors liste sans effet.
  assert.equal(presetPatch(presets, 0).layout, 'split');
  assert.equal(presetPatch(presets, 4), null);
  assert.equal(presetPatch(null, 0), null);
  assert.equal(removePreset(presets, 'Démo client').length, 0);
});

test('la liste des cadrages est bornée', () => {
  let presets = [];
  for (let i = 0; i < MAX_PRESETS + 3; i += 1) presets = savePreset(presets, `C${i}`, DEFAULT_STYLE);
  assert.equal(presets.length, MAX_PRESETS);
  // Ce sont les plus récents qu'on garde.
  assert.equal(presets.at(-1).name, `C${MAX_PRESETS + 2}`);
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
  // (`cameraAlign` est la même intention dite pour la présentation, où la
  // vignette n'a pas de coin — voir le test dédié.)
  assert.deepEqual(directStudioKey('ArrowUp', {}, { cameraCorner: 'bottom-left' }), {
    cameraCorner: 'top-left',
    cameraAlign: 'top',
  });
  assert.deepEqual(directStudioKey('ArrowDown', {}, { cameraCorner: 'top-right' }), {
    cameraCorner: 'bottom-right',
    cameraAlign: 'bottom',
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

// Les annotations sont redessinées par le studio : un décalage ici les ferait
// tomber à côté de ce qu'elles désignent, sur toute la vidéo.
test('screenToCanvas replace un point de l’écran filmé dans le cadre', () => {
  const bounds = { x: 1920, y: 0, width: 1920, height: 1080 }; // second écran
  const fit = { x: 100, y: 50, w: 960, h: 540 };
  const m = screenToCanvas(bounds, 1920, 1080, null, fit);
  const at = (x, y) => ({ x: m.a * x + m.e, y: m.d * y + m.f });
  assert.deepEqual(at(1920, 0), { x: 100, y: 50 }); // coin haut gauche
  assert.deepEqual(at(3840, 1080), { x: 1060, y: 590 }); // coin bas droit
  assert.equal(m.a, 0.5);
});

test('screenToCanvas suit le zoom : la portion affichée remplit le cadre', () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 500 };
  const fit = { x: 0, y: 0, w: 1000, h: 500 };
  // capture en pixels physiques (×2), zoom ×2 sur le quart haut gauche
  const source = { sx: 0, sy: 0, sw: 1000, sh: 500 };
  const m = screenToCanvas(bounds, 2000, 1000, source, fit);
  assert.equal(m.a * 500 + m.e, 1000); // le milieu de l'écran touche le bord droit
  assert.equal(m.d * 250 + m.f, 500);
});

test('screenToCanvas : écran inconnu (fenêtre filmée) → rien à replacer', () => {
  assert.equal(screenToCanvas(null, 1920, 1080, null, { x: 0, y: 0, w: 10, h: 10 }), null);
  assert.equal(screenToCanvas({ x: 0, y: 0, width: 0, height: 0 }, 1920, 1080, null, { x: 0, y: 0, w: 10, h: 10 }), null);
});

// --- Raccourcis globaux ----------------------------------------------------
test('chaque action globale correspond à une touche du studio', () => {
  // Les raccourcis globaux (Alt+Maj+…) rejouent les MÊMES actions que les
  // touches de la fenêtre, par le même chemin. Une action annoncée au
  // processus principal sans équivalent ici ne ferait rien, en silence.
  const actions = ['layout', 'background', 'corner', 'zoom', 'framing'];
  const parAction = Object.fromEntries(
    Object.entries(STUDIO_KEYS).map(([touche, action]) => [action, touche])
  );
  for (const action of actions) {
    assert.ok(parAction[action], `aucune touche pour « ${action} »`);
    assert.ok(
      applyStudioKey(parAction[action], DEFAULT_STYLE, { hasCamera: true }),
      `« ${action} » doit produire un changement de style`
    );
  }
  // Pause, arrêt et coup de zoom relèvent du composant : ils ne changent pas
  // le style, et c'est pour ça qu'ils sont traités à part des deux côtés.
  for (const action of ['pause', 'stop', 'zoomPulse']) {
    assert.ok(parAction[action], `aucune touche pour « ${action} »`);
    assert.equal(applyStudioKey(parAction[action], DEFAULT_STYLE), null);
  }
});
