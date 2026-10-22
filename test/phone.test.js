import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseScrcpyApps,
  parseAdbDevices,
  parseForegroundPackage,
  parseScrcpyVersion,
  compareVersions,
  scrcpyCapabilities,
  deviceAddressValid,
  packageValid,
  encodeInputText,
  buildMirrorArgs,
  normalizePhoneSettings,
  filterPhoneApps,
  sortPhoneApps,
  initialsOf,
  stripNativeApps,
  withPhoneModule,
  pngSize,
  isLauncherPackage,
  parseAndroidNotifications,
  notificationSnoozeCommand,
  virtualDisplaySize,
  scaledSize,
} from '../src/lib/phone.js';
import fs from 'node:fs';

test('parseScrcpyApps : préfixe système/utilisateur, libellé à espaces', () => {
  const out = [
    ' * Android System WebView                com.google.android.webview',
    ' - Google Maps                          com.google.android.apps.maps',
    ' - WhatsApp                             com.whatsapp',
    'bruit ignoré',
    '',
  ].join('\r\n');
  assert.deepEqual(parseScrcpyApps(out), [
    { package: 'com.google.android.webview', name: 'Android System WebView', system: true },
    { package: 'com.google.android.apps.maps', name: 'Google Maps', system: false },
    { package: 'com.whatsapp', name: 'WhatsApp', system: false },
  ]);
});

test('parseScrcpyApps : doublons et lignes incomplètes écartés', () => {
  const out = [
    ' - WhatsApp   com.whatsapp',
    ' - WhatsApp bis   com.whatsapp',
    ' - Sans paquet',
    ' -   com.sansnom',
  ].join('\n');
  assert.deepEqual(parseScrcpyApps(out), [
    { package: 'com.whatsapp', name: 'WhatsApp', system: false },
  ]);
});

test('parseForegroundPackage : activité reprise ou fenêtre focalisée', () => {
  const activity = [
    'ACTIVITY MANAGER ACTIVITIES',
    '  mResumedActivity: ActivityRecord{1a2b3c u0 com.whatsapp/.Main t42}',
  ].join('\n');
  assert.deepEqual(parseForegroundPackage(activity), {
    package: 'com.whatsapp',
    component: 'com.whatsapp/.Main',
  });

  const window = '  mCurrentFocus=Window{9f u0 com.android.launcher3/com.android.launcher3.Launcher}';
  assert.equal(parseForegroundPackage(window)?.package, 'com.android.launcher3');
  assert.equal(parseForegroundPackage('rien de reconnaissable'), null);
});

test('parseAdbDevices : USB, réseau, états non exploitables', () => {
  const out = [
    'List of devices attached',
    'R58M80ABCDE\tdevice',
    '192.168.1.20:5555\tdevice',
    '0123456789ABCDEF\tunauthorized',
    'emulator-5554\toffline',
    '',
  ].join('\n');
  assert.deepEqual(parseAdbDevices(out), [
    { serial: 'R58M80ABCDE', state: 'device', wireless: false },
    { serial: '192.168.1.20:5555', state: 'device', wireless: true },
    { serial: '0123456789ABCDEF', state: 'unauthorized', wireless: false },
    { serial: 'emulator-5554', state: 'offline', wireless: false },
  ]);
});

test('parseScrcpyVersion : bannière officielle, préversions tolérées', () => {
  assert.deepEqual(parseScrcpyVersion('scrcpy 4.1 <https://github.com/Genymobile/scrcpy>\n'), {
    major: 4,
    minor: 1,
    patch: 0,
    release: '4.1',
  });
  assert.equal(parseScrcpyVersion('scrcpy 3.3.1')?.release, '3.3.1');
  assert.equal(parseScrcpyVersion('commande inconnue'), null);
});

test('compareVersions : ordre numérique, pas alphabétique', () => {
  assert.ok(compareVersions('4.0', '3.9') > 0);
  assert.ok(compareVersions('3.10', '3.9') > 0);
  assert.equal(compareVersions('4.1', '4.1.0'), 0);
  assert.ok(compareVersions('2.0', '3.0') < 0);
});

test('scrcpyCapabilities : seuils 2.0 / 3.0 / 4.0', () => {
  assert.deepEqual(scrcpyCapabilities('1.25'), {
    listApps: false,
    virtualDisplay: false,
    flexDisplay: false,
    keepActive: false,
    audio: false,
  });
  assert.deepEqual(scrcpyCapabilities('3.3'), {
    listApps: true,
    virtualDisplay: true,
    flexDisplay: false,
    keepActive: false,
    audio: true,
  });
  assert.deepEqual(scrcpyCapabilities('4.1'), {
    listApps: true,
    virtualDisplay: true,
    flexDisplay: true,
    keepActive: true,
    audio: true,
  });
});

test('deviceAddressValid / packageValid : rien qui traverse un shell', () => {
  assert.equal(deviceAddressValid('192.168.1.20:5555'), true);
  assert.equal(deviceAddressValid('mon-telephone.local'), true);
  assert.equal(deviceAddressValid('192.168.1.20; rm -rf /'), false);
  assert.equal(deviceAddressValid('a b'), false);
  assert.equal(packageValid('com.whatsapp'), true);
  assert.equal(packageValid('com.whatsapp; reboot'), false);
  assert.equal(packageValid(''), false);
});

test('encodeInputText : espaces et apostrophes', () => {
  assert.equal(encodeInputText('bonjour le monde'), "'bonjour%sle%smonde'");
  assert.equal(encodeInputText("aujourd'hui"), "'aujourd'\\''hui'");
  assert.equal(encodeInputText('ligne1\nligne2'), "'ligne1%sligne2'");
});

test('buildMirrorArgs : options de la fenêtre dédiée', () => {
  const args = buildMirrorArgs({
    serial: 'R58M80ABCDE',
    title: 'WhatsApp',
    packageName: 'com.whatsapp',
    settings: { mirrorFps: 30, mirrorBitrate: '4M', mirrorAudio: true, mirrorAlwaysOnTop: false },
  });
  assert.deepEqual(args, [
    '--serial',
    'R58M80ABCDE',
    '--window-title=WhatsApp',
    '--start-app=com.whatsapp',
    '--max-fps=30',
    '--video-bit-rate=4M',
  ]);
  // Le paquet invalide ne part jamais sur la ligne de commande.
  const noPkg = buildMirrorArgs({ packageName: 'x; reboot', settings: {} });
  assert.ok(!noPkg.some((a) => a.startsWith('--start-app=')));
});

test('normalizePhoneSettings : bornes, types et listes propres', () => {
  const s = normalizePhoneSettings({
    serial: '192.168.1.2:5555',
    favoritePackages: ['com.whatsapp', 'com.whatsapp', 'pas un paquet'],
    recentPackages: ['com.whatsapp'],
    refreshMs: 1,
    captureWidth: 9999,
    mirrorFps: 999,
    mirrorBitrate: 'n’importe quoi',
    iconSize: 'géant',
    sortMode: 'inconnu',
    showSystemApps: 'oui',
    homeWidgets: { quickControls: false },
  });
  assert.equal(s.serial, '192.168.1.2:5555');
  assert.deepEqual(s.favoritePackages, ['com.whatsapp']);
  assert.equal(s.refreshMs, 120);
  assert.equal(s.captureWidth, 1600);
  assert.equal(s.mirrorFps, 240);
  assert.equal(s.mirrorBitrate, '8M');
  assert.equal(s.iconSize, 'medium');
  assert.equal(s.sortMode, 'name');
  assert.equal(s.showSystemApps, false);
  assert.equal(s.homeWidgets.quickControls, false);
  assert.equal(normalizePhoneSettings({}).homeWidgets.quickControls, true);
});

test('filterPhoneApps : nom, paquet, initiales', () => {
  const apps = [
    { name: 'Google Maps', package: 'com.google.android.apps.maps' },
    { name: 'WhatsApp', package: 'com.whatsapp' },
  ];
  assert.equal(filterPhoneApps(apps, 'maps')[0].package, 'com.google.android.apps.maps');
  assert.equal(filterPhoneApps(apps, 'whatsapp')[0].package, 'com.whatsapp');
  assert.equal(filterPhoneApps(apps, 'gm')[0].name, 'Google Maps');
  assert.equal(filterPhoneApps(apps, 'zzz').length, 0);
  assert.equal(filterPhoneApps(apps, '').length, 2);
  assert.equal(initialsOf('Google Maps'), 'gm');
});

test('sortPhoneApps : nom, paquet et récents', () => {
  const apps = [
    { name: 'WhatsApp', package: 'com.whatsapp' },
    { name: 'Gmail', package: 'com.google.android.gm' },
    { name: 'Maps', package: 'com.google.android.apps.maps' },
  ];
  assert.deepEqual(sortPhoneApps(apps, 'name').map((a) => a.name), ['Gmail', 'Maps', 'WhatsApp']);
  assert.deepEqual(sortPhoneApps(apps, 'package').map((a) => a.package), [
    'com.google.android.apps.maps',
    'com.google.android.gm',
    'com.whatsapp',
  ]);
  assert.deepEqual(
    sortPhoneApps(apps, 'recent', ['com.whatsapp', 'com.google.android.apps.maps']).map((a) => a.name),
    ['WhatsApp', 'Maps', 'Gmail']
  );
});

test('stripNativeApps : retire l\'ancienne app Téléphone du sidebar', () => {
  const gmail = { id: 'gmail-work', name: 'Gmail' };
  const legacy = { id: 'phone-native', name: 'Téléphone', native: 'phone' };
  const res = stripNativeApps([gmail, legacy]);
  assert.deepEqual(res.apps, [gmail]);
  assert.deepEqual(res.removedIds, ['phone-native']);
  // Rien d'app natif → aucun changement (le store ne rend pas).
  assert.equal(stripNativeApps([gmail]), null);
  assert.equal(stripNativeApps(null), null);
});

test('withPhoneModule : insère le bouton avant la cloche, une seule fois', () => {
  const topbar = { left: ['logo'], center: ['search'], right: ['shields', 'notifications'] };
  assert.deepEqual(withPhoneModule(topbar).right, ['shields', 'phone', 'notifications']);
  // Déjà présent (n'importe quelle zone) → aucune modification.
  assert.equal(withPhoneModule({ ...topbar, right: ['phone', 'notifications'] }), null);
  assert.equal(withPhoneModule({ ...topbar, left: ['phone'] }), null);
  // Sans cloche : ajout en fin de barre.
  assert.deepEqual(withPhoneModule({ left: [], center: [], right: ['shields'] }).right, ['shields', 'phone']);
});

test('scaledSize : conserve les proportions, ne grossit jamais', () => {
  assert.deepEqual(scaledSize(1080, 2400, 540), { width: 540, height: 1200 });
  assert.deepEqual(scaledSize(320, 640, 540), { width: 320, height: 640 });
  assert.deepEqual(scaledSize(0, 0, 540), { width: 0, height: 0 });
});

// En-tête PNG minimal : signature + longueur IHDR + « IHDR » + largeur/hauteur.
function pngHeader(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test('manifeste orbit-phone : déclare l\'app native et rien d\'autre', () => {
  // Les sources vivent dans `electron/extensions/` (voir scripts/export-extensions.cjs).
  const manifest = JSON.parse(
    fs.readFileSync(new URL('../electron/extensions/orbit-phone/manifest.json', import.meta.url), 'utf8')
  );
  assert.equal(manifest.orbit.nativeApp, 'phone');
  assert.equal(manifest.name, 'Téléphone Orbit');
  // Aucun content script : l'extension est un paquet d'activation, pas un
  // script injecté dans les pages web.
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.background, undefined);
});

test('parseAndroidNotifications : paquet, titre, texte, clé et catégorie', () => {
  const dump = [
    'NotificationRecord(0x0b2f pkg=com.whatsapp user=0 key=0|com.whatsapp|42|null|10123):',
    '  mRankingTimeMs=1700000000000 when=1700000000000',
    '    NotificationRecord(0x0b30 pkg=com.android.dialer user=0):',
    '  when=1700000005000',
    '  category=call',
    '    android.title=String (Maman)',
    '    android.text=String (Appel entrant)',
    '    key=0|com.android.dialer|7|null|10042',
    '  NotificationRecord(0x0b31 pkg=com.whatsapp user=0):',
    '  when=1700000001000',
    '    android.title=String (Alice)',
    '    android.text=String (Salut !)',
    '    key=0|com.whatsapp|43|null|10123',
    '  NotificationRecord(0x0b32 pkg=com.example.empty user=0):',
    '    key=0|com.example.empty|1|null|1',
  ].join('\n');

  const items = parseAndroidNotifications(dump);
  assert.deepEqual(items.map((i) => i.title), ['Maman', 'Alice']);
  assert.equal(items[0].category, 'call');
  assert.equal(items[0].text, 'Appel entrant');
  assert.equal(items[0].key, '0|com.android.dialer|7|null|10042');
  assert.equal(items[1].package, 'com.whatsapp');
  // Les notifications sans texte exploitable sont écartées.
  assert.equal(items.some((i) => i.package === 'com.example.empty'), false);
  assert.deepEqual(parseAndroidNotifications(''), []);
});

test('notificationSnoozeCommand : clé échappée pour le shell Android', () => {
  const cmd = notificationSnoozeCommand("0|com.app|1|null|10'42", 1000);
  assert.match(cmd, /^cmd notification snooze --for 1000 '/);
  // L'apostrophe est refermée/réouverte : la clé reste UN argument unique.
  assert.match(cmd, /'\\''/);
  assert.equal(cmd.endsWith("'"), true);
  assert.equal(cmd.startsWith("cmd notification snooze --for 1000 '"), true);
});

test('virtualDisplaySize : aspect de la zone, bornes raisonnables', () => {
  const wide = virtualDisplaySize(1600, 900);
  assert.ok(wide.width >= 800 && wide.width <= 1600);
  assert.ok(wide.height >= 480 && wide.height <= 1400);
  assert.ok(Math.abs(wide.width / wide.height - 1600 / 900) < 0.15);
  // Une zone étroite (panneau partagé) ne produit pas un écran minuscule.
  const narrow = virtualDisplaySize(400, 800);
  assert.equal(narrow.width, 800);
  assert.ok(narrow.height >= 900);
});

test('pngSize : lit la taille dans l\'en-tête sans décoder', () => {
  assert.deepEqual(pngSize(pngHeader(1080, 2400)), { width: 1080, height: 2400 });
});

test('pngSize : refuse ce qui n\'est pas un PNG ou est tronqué', () => {
  assert.equal(pngSize(null), null);
  assert.equal(pngSize(Buffer.from('pas une image')), null);
  assert.equal(pngSize(Buffer.alloc(10)), null);
  const wrongChunk = pngHeader(1080, 2400);
  wrongChunk.write('IDAT', 12, 'ascii');
  assert.equal(pngSize(wrongChunk), null);
  assert.equal(pngSize(pngHeader(0, 2400)), null);
});

test('isLauncherPackage : accueil du téléphone reconnu, vraies apps non', () => {
  for (const pkg of [
    'com.google.android.apps.nexuslauncher',
    'com.android.launcher3',
    'com.miui.home',
    'com.sec.android.app.launcher',
    'com.android.systemui',
    'android',
  ]) {
    assert.equal(isLauncherPackage(pkg), true, pkg);
  }
  for (const pkg of ['com.whatsapp', 'com.google.android.apps.maps', 'com.android.settings']) {
    assert.equal(isLauncherPackage(pkg), false, pkg);
  }
  // Paquet inconnu : on ne conclut pas au lanceur (sinon on relancerait l'app
  // à chaque retour sur un appareil lent à répondre).
  assert.equal(isLauncherPackage(''), false);
  assert.equal(isLauncherPackage(null), false);
});
