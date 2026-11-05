import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchShortcutInput, normalizeAssistantChatShortcutKey } from '../src/lib/shortcuts.js';

// `lib.js` est un script de contenu : il s'expose sur `globalThis`, sans
// `export`. On le charge donc tel quel — c'est exactement ce que fait le
// navigateur dans la page, et ce qui garantit que le test vérifie le code
// LIVRÉ dans l'extension.
await import('../electron/extensions/mouse-scroll/lib.js');
const LIB = globalThis.OrbitScroll;

test('lib.js : s\'expose sur globalThis, comme dans la page', () => {
  assert.ok(LIB, 'OrbitScroll doit être défini');
  assert.equal(typeof LIB.normalizeConfig, 'function');
});

test('normalizeConfig : borne tout, répare les valeurs absurdes', () => {
  const config = LIB.normalizeConfig({
    intensity: 9,
    step: 5,
    speed: -3,
    fastFactor: 100,
    fastModifier: 'meta',
    autoScroll: 'wheel',
    enabled: 'oui',
  });
  assert.equal(config.intensity, LIB.RANGES.intensity[1]);
  assert.equal(config.step, LIB.RANGES.step[0]);
  assert.equal(config.speed, LIB.RANGES.speed[0]);
  assert.equal(config.fastFactor, LIB.RANGES.fastFactor[1]);
  // Valeurs inconnues → défauts, jamais de réglage impossible à appliquer.
  assert.equal(config.fastModifier, LIB.DEFAULTS.fastModifier);
  assert.equal(config.autoScroll, LIB.DEFAULTS.autoScroll);
  assert.equal(config.enabled, LIB.DEFAULTS.enabled);
  assert.deepEqual(LIB.normalizeConfig(null), LIB.normalizeConfig({}));
});

test('normalizeConfig : Maj ne peut pas servir deux fois', () => {
  const both = LIB.normalizeConfig({ horizontal: true, fastModifier: 'shift' });
  assert.equal(both.fastModifier, 'alt');
  // Sans défilement horizontal, Maj redevient disponible.
  const only = LIB.normalizeConfig({ horizontal: false, fastModifier: 'shift' });
  assert.equal(only.fastModifier, 'shift');
});

test('normalizeConfig : les règles de site sont filtrées, pas recopiées', () => {
  const config = LIB.normalizeConfig({
    sites: {
      'EXEMPLE.FR': { smooth: false, speed: 99, inconnu: 'x' },
      '  ': { smooth: false },
      'vide.fr': {},
      'autre.fr': 'pas un objet',
    },
  });
  assert.deepEqual(Object.keys(config.sites), ['exemple.fr']);
  assert.deepEqual(config.sites['exemple.fr'], { smooth: false, speed: LIB.RANGES.speed[1] });
});

test('matchHost : exact, joker de sous-domaines, et « partout »', () => {
  assert.equal(LIB.matchHost('exemple.fr', 'exemple.fr'), true);
  assert.equal(LIB.matchHost('exemple.fr', 'www.exemple.fr'), false);
  assert.equal(LIB.matchHost('*.exemple.fr', 'www.exemple.fr'), true);
  assert.equal(LIB.matchHost('*.exemple.fr', 'exemple.fr'), true);
  assert.equal(LIB.matchHost('*.exemple.fr', 'exemple.fr.pirate.com'), false);
  assert.equal(LIB.matchHost('*', 'nimporte.quoi'), true);
  assert.equal(LIB.matchHost('', 'exemple.fr'), false);
});

test('resolveSite : le motif le plus précis gagne, quel que soit l\'ordre', () => {
  const config = {
    speed: 1,
    smooth: true,
    sites: {
      '*.google.com': { speed: 2, smooth: false },
      'mail.google.com': { speed: 0.5 },
      '*': { invert: true },
    },
  };
  const mail = LIB.resolveSite(config, 'mail.google.com');
  assert.equal(mail.matched, 'mail.google.com');
  assert.equal(mail.speed, 0.5);
  // La règle précise ne porte que sur la vitesse : le reste revient aux
  // réglages globaux, pas à la règle moins précise.
  assert.equal(mail.smooth, true);

  const drive = LIB.resolveSite(config, 'drive.google.com');
  assert.equal(drive.matched, '*.google.com');
  assert.equal(drive.speed, 2);
  assert.equal(drive.smooth, false);

  const autre = LIB.resolveSite(config, 'exemple.fr');
  assert.equal(autre.matched, '*');
  assert.equal(autre.invert, true);
});

test('hostUsesNativeScroll : les applications qui gèrent la molette sont épargnées', () => {
  assert.equal(LIB.hostUsesNativeScroll('maps.google.com'), true);
  assert.equal(LIB.hostUsesNativeScroll('www.figma.com'), true);
  assert.equal(LIB.hostUsesNativeScroll('fr.wikipedia.org'), false);
  assert.equal(LIB.hostUsesNativeScroll(''), false);
});

test('isWheelLike : une molette est interceptée, un pavé tactile non', () => {
  // Molette : crans francs, isolés.
  const wheel = {};
  assert.equal(LIB.isWheelLike({ delta: 100, deltaMode: 0, timeStamp: 0 }, wheel), true);
  assert.equal(LIB.isWheelLike({ delta: -120, deltaMode: 0, timeStamp: 80 }, wheel), true);
  // Lignes ou pages : toujours une molette.
  assert.equal(LIB.isWheelLike({ delta: 3, deltaMode: 1, timeStamp: 160 }, wheel), true);

  // Pavé tactile : rafale de petites valeurs rapprochées.
  const pad = {};
  assert.equal(LIB.isWheelLike({ delta: 4, deltaMode: 0, timeStamp: 0 }, pad), true);
  assert.equal(LIB.isWheelLike({ delta: 6, deltaMode: 0, timeStamp: 16 }, pad), true);
  assert.equal(LIB.isWheelLike({ delta: 7, deltaMode: 0, timeStamp: 32 }, pad), false);
  assert.equal(LIB.isWheelLike({ delta: 5, deltaMode: 0, timeStamp: 48 }, pad), false);
  // On lâche le pavé tactile et on reprend la souris : un gros cran redevient
  // une molette immédiatement.
  assert.equal(LIB.isWheelLike({ delta: 120, deltaMode: 0, timeStamp: 900 }, pad), true);
});

test('wheelStep : un cran en pixels, sens, vitesse, rapide et plafond', () => {
  const base = { step: 120, speed: 1, fastFactor: 3 };
  assert.equal(LIB.wheelStep({ delta: 100, deltaMode: 0 }, base), 120);
  assert.equal(LIB.wheelStep({ delta: -100, deltaMode: 0 }, base), -120);
  assert.equal(LIB.wheelStep({ delta: 100, deltaMode: 0 }, { ...base, invert: true }), -120);
  assert.equal(LIB.wheelStep({ delta: 100, deltaMode: 0 }, { ...base, speed: 2 }), 240);
  assert.equal(LIB.wheelStep({ delta: 100, deltaMode: 0 }, { ...base, fast: true }), 360);
  // Deux crans d'un coup (molette rapide) comptent double.
  assert.equal(LIB.wheelStep({ delta: 200, deltaMode: 0 }, base), 240);
  // Un cran minuscule vaut au moins un cran complet.
  assert.equal(LIB.wheelStep({ delta: 12, deltaMode: 0 }, base), 120);
  // Molette « libre » qui envoie un delta démesuré : plafonné.
  assert.equal(LIB.wheelStep({ delta: 100000, deltaMode: 0 }, base), 6000);
  assert.equal(LIB.wheelStep({ delta: 0, deltaMode: 0 }, base), 0);
});

test('stepTowards : converge et s\'arrête net', () => {
  assert.equal(LIB.stepTowards(0, 100, 0.25), 25);
  assert.equal(LIB.stepTowards(99.8, 100, 0.25), 100, 'sous le demi-pixel, on colle à la cible');
  // Quelques trames suffisent à arriver : l'animation ne traîne pas.
  let position = 0;
  for (let i = 0; i < 60 && position !== 300; i += 1) position = LIB.stepTowards(position, 300, 0.22);
  assert.equal(position, 300);
});

test('autoScrollVelocity : zone morte, progression, plafond', () => {
  assert.equal(LIB.autoScrollVelocity(10, {}), 0, 'zone morte : pas de défilement involontaire');
  assert.ok(LIB.autoScrollVelocity(40, {}) > 0);
  assert.ok(LIB.autoScrollVelocity(-40, {}) < 0, 'vers le haut');
  assert.ok(LIB.autoScrollVelocity(120, {}) > LIB.autoScrollVelocity(60, {}));
  assert.ok(LIB.autoScrollVelocity(4000, {}) <= 42, 'plafonné');
  assert.ok(LIB.autoScrollVelocity(60, { speed: 2 }) > LIB.autoScrollVelocity(60, { speed: 1 }));
});

// ---------------------------------------------------------------------------
// Collisions de raccourcis — LE test qui compte.
//
// Orbit intercepte les combinaisons Alt dans le processus principal
// (`before-input-event` → `matchShortcutInput`) AVANT que la page ne les voie.
// Un raccourci d'extension posé sur l'un des siens n'est pas « en conflit » :
// il est simplement MORT, sans le moindre message. D'où ce test, qui confronte
// le raccourci de la palette au vrai matcher d'Orbit.
// ---------------------------------------------------------------------------

test('raccourci de la palette : Orbit ne l\'intercepte pas', () => {
  const { key } = LIB.PALETTE_SHORTCUT;
  const input = { type: 'keyDown', key, alt: true, shift: true, control: false, meta: false };
  assert.equal(matchShortcutInput(input), null, `Alt+Maj+${key} est déjà un raccourci d'Orbit`);
  // Et avec chacune des touches de discussion configurables de l'assistant.
  for (const chatKey of ['a', 'j', 'u', 'y']) {
    assert.equal(normalizeAssistantChatShortcutKey(chatKey), chatKey);
    assert.equal(matchShortcutInput(input, chatKey), null);
  }
});

test('raccourci de la palette : ne tombe pas sur ceux des autres extensions', () => {
  // Les autres extensions livrées écoutent des combinaisons Alt+lettre dans la
  // page. On relit leurs sources plutôt que de recopier une liste qui
  // vieillirait en silence.
  //
  // ATTENTION : `.gitignore` ne suit que les sources des extensions livrées
  // avec Orbit — un clone neuf (et donc la CI) n'a pas les autres. Le test
  // vérifie alors ce qu'il PEUT vérifier, au lieu d'échouer sur une absence
  // qui n'est pas une régression.
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'extensions');
  const taken = new Set();
  let scanned = 0;
  for (const name of fs.readdirSync(root)) {
    if (name === 'mouse-scroll') continue;
    const file = path.join(root, name, 'content.js');
    if (!fs.existsSync(file)) continue;
    scanned += 1;
    const source = fs.readFileSync(file, 'utf8');
    // Formes rencontrées : `e.altKey && (e.key === 'c' || e.key === 'C')`,
    // avec ou sans `e.shiftKey`.
    for (const match of source.matchAll(/altKey\s*&&\s*(e\.shiftKey\s*&&\s*)?\(?e\.key\s*===\s*'(\w)'/g)) {
      taken.add(`${match[1] ? 'alt+shift+' : 'alt+'}${match[2].toLowerCase()}`);
    }
  }
  const ours = `alt+shift+${LIB.PALETTE_SHORTCUT.key}`;
  assert.equal(taken.has(ours), false, `${ours} est déjà pris par une autre extension`);
  // Sur une copie de travail complète, la liste doit être fournie : si elle se
  // vidait alors que les sources sont là, c'est que la détection a cessé de
  // fonctionner et que ce test ne garantirait plus rien.
  if (scanned >= 4) {
    assert.ok(taken.size >= 4, `détection cassée : ${scanned} sources lues, ${taken.size} raccourcis trouvés`);
  }
});

test('ORBIT_ALT_SHIFT_KEYS : la liste documentée colle au vrai matcher d\'Orbit', () => {
  // Si Orbit se réserve une nouvelle combinaison Alt+Maj, ce test le dit : la
  // liste de lib.js (qui justifie le choix du raccourci) doit rester vraie.
  // Plusieurs branches d'Orbit ignorent Maj (k, l, b, s…) : elles comptent.
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('').concat(['pagedown', 'pageup']);
  const intercepted = letters.filter(
    (key) =>
      matchShortcutInput({ type: 'keyDown', key, alt: true, shift: true, control: false, meta: false }) !== null
  );
  assert.deepEqual([...LIB.ORBIT_ALT_SHIFT_KEYS].sort(), intercepted.sort());
  // Et le raccourci de la palette n'est dans aucune des deux réserves.
  assert.equal(LIB.ORBIT_ALT_SHIFT_KEYS.includes(LIB.PALETTE_SHORTCUT.key), false);
  assert.equal(LIB.RESERVED_BY_OTHERS.includes(LIB.PALETTE_SHORTCUT.key), false);
});

test('palette : outils, couleurs et épaisseurs cohérents, réglages bornés', () => {
  assert.deepEqual(LIB.PALETTE_TOOLS, ['laser', 'pen', 'highlight', 'arrow', 'rect', 'ellipse']);
  // Le laser ne laisse pas de trace : ce n'est pas un outil de dessin.
  assert.equal(LIB.isDrawingTool('laser'), false);
  assert.equal(LIB.isDrawingTool('pen'), true);
  assert.equal(LIB.isDrawingTool('inconnu'), false);
  LIB.DRAWING_TOOLS.forEach((tool) => {
    assert.ok(LIB.PALETTE_TOOLS.includes(tool), `${tool} doit être proposé dans la palette`);
  });

  // Un outil ou une couleur inconnue retombe sur le défaut : la palette ne
  // peut pas se retrouver dans un état qu'elle ne sait pas afficher.
  const config = LIB.normalizeConfig({ tool: 'laser-ultime', color: 'pink', width: 999, paletteX: 5 });
  assert.equal(config.tool, LIB.DEFAULTS.tool);
  assert.equal(config.color, LIB.DEFAULTS.color);
  assert.equal(config.width, LIB.DEFAULTS.width);
  assert.equal(config.paletteX, 1);
  // Les choix valides, eux, sont conservés.
  const kept = LIB.normalizeConfig({ tool: 'highlight', color: LIB.PALETTE_COLORS[2], width: 14 });
  assert.equal(kept.tool, 'highlight');
  assert.equal(kept.color, LIB.PALETTE_COLORS[2]);
  assert.equal(kept.width, 14);
});

test('trimTrail : la traîne du laser ne garde que les points récents', () => {
  const now = 10_000;
  const trail = [
    { x: 0, y: 0, at: now - 900 },
    { x: 1, y: 1, at: now - 300 },
    { x: 2, y: 2, at: now },
  ];
  assert.deepEqual(LIB.trimTrail(trail, now, 420).map((p) => p.x), [1, 2]);
  assert.deepEqual(LIB.trimTrail([], now, 420), []);
});

test('arrowHead : pointe orientée, jamais plus longue que la flèche', () => {
  const head = LIB.arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
  assert.deepEqual(head[1], { x: 100, y: 0 });
  assert.ok(head[0].x < 100 && head[2].x < 100);
  const tiny = LIB.arrowHead({ x: 0, y: 0 }, { x: 5, y: 0 }, 14);
  assert.ok(Math.hypot(tiny[1].x - tiny[0].x, tiny[1].y - tiny[0].y) <= 5);
});

test('manifeste mouse-scroll : script de contenu, options, aucune permission réseau', () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL('../electron/extensions/mouse-scroll/manifest.json', import.meta.url), 'utf8')
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Souris & Défilement');
  // `lib.js` AVANT `content.js` : le script de contenu en dépend.
  assert.deepEqual(manifest.content_scripts[0].js, ['lib.js', 'content.js']);
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, []);
  assert.equal(manifest.options_ui.page, 'options.html');
});
