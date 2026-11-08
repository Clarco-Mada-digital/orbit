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
  pngSize,
  isLauncherPackage,
  parseAndroidNotifications,
  parseNotificationPeople,
  isGenericCallLabel,
  looksLikePhoneNumber,
  telNumberOf,
  describeCallNotification,
  contactLookupCommand,
  parseContactLookup,
  parseRingerMode,
  parseRingVolume,
  ringVolumeCommand,
  parseZenMode,
  dndCommand,
  phoneRemoteRelativePath,
  calendarQueryCommand,
  parseCalendarEvents,
  parseMediaSession,
  mediaKeyCommand,
  parseStorage,
  parseIncomingCallNumber,
  phoneCallKey,
  callLogCommand,
  parseCallLog,
  describeCallLogEntry,
  formatCallDuration,
  sanitizePhoneNumber,
  dialCommand,
  MAX_CALL_LOG_ENTRIES,
  phoneRemoteName,
  phonePushTarget,
  PHONE_PUSH_DIR,
  MAX_PINNED_PHONE_APPS,
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
  // `homeWidgets` est devenu une DISPOSITION (liste ordonnée de cartes) :
  // l'ancienne forme en booléens est convertie, voir le test dédié plus bas.
  assert.ok(Array.isArray(s.homeWidgets));
  assert.deepEqual(normalizePhoneSettings({}).homeWidgets.map((w) => w.type), ['clock', 'favorites']);
  const pinned = normalizePhoneSettings({
    pinnedPackages: ['com.whatsapp', 'invalid package', ...Array.from({ length: 10 }, (_, i) => `org.example.app${i}`)],
  }).pinnedPackages;
  assert.equal(pinned.length, MAX_PINNED_PHONE_APPS);
  assert.equal(pinned[0], 'com.whatsapp');
  assert.equal(normalizePhoneSettings({ homeBackground: 'mountains' }).homeBackground, 'mountains');
  assert.equal(normalizePhoneSettings({ homeBackground: 'invalid' }).homeBackground, 'aurora');
  assert.equal(
    normalizePhoneSettings({ homeBackgroundImage: 'https://example.com/wallpaper.jpg' }).homeBackgroundImage,
    'https://example.com/wallpaper.jpg'
  );
  assert.equal(normalizePhoneSettings({ homeBackgroundImage: 'javascript:alert(1)' }).homeBackgroundImage, '');
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

test('le bouton Téléphone de la barre n’est jamais imposé', () => {
  // Il était réinséré dans la barre du haut à chaque synchronisation des
  // extensions : l'enlever ne servait à rien, il revenait au redémarrage.
  // Plus aucune fonction ne modifie la disposition de la barre au nom du
  // Téléphone — c'est un module comme un autre, que l'on place soi-même.
  const store = fs.readFileSync(new URL('../src/stores/useStore.js', import.meta.url), 'utf8');
  assert.equal(/withPhoneModule/.test(store), false, 'useStore ne doit plus forcer le module');
  const lib = fs.readFileSync(new URL('../src/lib/phone.js', import.meta.url), 'utf8');
  assert.equal(/export function withPhoneModule/.test(lib), false, 'la fonction doit avoir disparu');
  // Le module reste PROPOSÉ dans la personnalisation de la barre.
  const layout = fs.readFileSync(new URL('../src/lib/topbarLayout.js', import.meta.url), 'utf8');
  assert.ok(/id: 'phone'/.test(layout), 'le module doit rester ajoutable par l’utilisateur');
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

test('parseAndroidNotifications : appel CallStyle — numéro lu dans android.people', () => {
  const dump = [
    'NotificationRecord(0x0b30 pkg=com.google.android.dialer user=0):',
    '  when=1700000005000',
    '  category=call',
    '    android.title=String (Appel entrant)',
    '    android.text=String (Mobile)',
    '    android.people=String[] (1)',
    '      [0] tel:+33612345678',
    '    android.callType=Int (1)',
    '    key=0|com.google.android.dialer|7|null|10042',
  ].join('\n');

  const [item] = parseAndroidNotifications(dump);
  assert.deepEqual(item.people, ['tel:+33612345678']);
  // Le titre du dialer ne dit pas qui appelle : le numéro prend le relais.
  const caller = describeCallNotification(item, 'Téléphone');
  assert.equal(caller.who, '+33612345678');
  assert.equal(caller.number, '+33612345678');
  assert.equal(caller.unknown, false);
});

test('parseNotificationPeople : lignes indentées du tableau d\'extras', () => {
  const scope = [
    '    android.people.list=ArrayList (2)',
    '      [0] tel:0612345678',
    '      [1] null',
    '    android.title=String (Appel)',
  ].join('\n');
  assert.deepEqual(parseNotificationPeople(scope), ['tel:0612345678']);
  assert.deepEqual(parseNotificationPeople(''), []);
});

test('isGenericCallLabel : écarte les titres qui ne nomment personne', () => {
  for (const label of ['Appel', 'Appel entrant', 'Appel en cours', 'Incoming call', 'appel vidéo',
    'Numéro inconnu', 'Unknown number', 'Appel WhatsApp', '']) {
    assert.equal(isGenericCallLabel(label), true, label);
  }
  for (const label of ['Maman', 'Alice Durand', 'Bureau — Clarco', 'Dr. Ratsimba']) {
    assert.equal(isGenericCallLabel(label), false, label);
  }
});

test('looksLikePhoneNumber / telNumberOf', () => {
  assert.equal(looksLikePhoneNumber('+33 6 12 34 56 78'), true);
  assert.equal(looksLikePhoneNumber('0341234567'), true);
  assert.equal(looksLikePhoneNumber('Maman'), false);
  assert.equal(looksLikePhoneNumber('Salle 12'), false);
  assert.equal(telNumberOf('tel:+261%2034%20123%2045'), '+2613412345');
  assert.equal(telNumberOf('content://com.android.contacts/contacts/12'), null);
});

test('describeCallNotification : le contact résolu passe avant tout le reste', () => {
  const caller = describeCallNotification(
    {
      package: 'com.google.android.dialer',
      title: 'Appel entrant',
      text: 'Mobile',
      callNumber: '+33612345678',
      callerName: 'Maman',
    },
    'Téléphone'
  );
  assert.equal(caller.who, 'Maman');
  assert.equal(caller.named, true);
  // La ligne secondaire complète sans répéter : numéro + application.
  assert.equal(caller.detail, '+33612345678 · Téléphone');
});

test('describeCallNotification : nom porté par le texte, pas par le titre', () => {
  const caller = describeCallNotification(
    { package: 'com.whatsapp', title: 'Appel WhatsApp', text: 'Alice Durand' },
    'WhatsApp'
  );
  assert.equal(caller.who, 'Alice Durand');
  assert.equal(caller.detail, 'WhatsApp');
  assert.equal(caller.number, null);
});

test('describeCallNotification : aucune identité transmise', () => {
  const caller = describeCallNotification({ package: 'com.whatsapp', title: 'Appel entrant' }, 'WhatsApp');
  assert.equal(caller.unknown, true);
  assert.equal(caller.who, 'WhatsApp');
  assert.equal(describeCallNotification({}).who, 'Appelant inconnu');
});

test('contactLookupCommand : numéro assaini, URI phone_lookup', () => {
  assert.equal(
    contactLookupCommand('+33 6 12-34.56 78'),
    'content query --uri content://com.android.contacts/phone_lookup/%2B33612345678 --projection display_name'
  );
  assert.equal(contactLookupCommand(''), null);
  assert.equal(contactLookupCommand('; rm -rf /'), null);
});

test('parseContactLookup : première ligne exploitable de content query', () => {
  assert.equal(parseContactLookup('Row: 0 display_name=Maman\n'), 'Maman');
  assert.equal(parseContactLookup('Row: 0 display_name=NULL'), null);
  assert.equal(parseContactLookup('No result found.'), null);
});

test('parseIncomingCallNumber : numéro de la radio', () => {
  assert.equal(parseIncomingCallNumber('  mCallIncomingNumber=+261340000000,'), '+261340000000');
  assert.equal(parseIncomingCallNumber('mCallIncomingNumber=null'), null);
  assert.equal(parseIncomingCallNumber(''), null);
});

test('callLogCommand : projection, tri décroissant et limite bornée', () => {
  assert.match(callLogCommand(5), /content:\/\/call_log\/calls/);
  assert.match(callLogCommand(5), /--sort 'date DESC LIMIT 5'/);
  // Une limite absurde ne doit pas rapatrier le journal entier.
  assert.match(callLogCommand(99999), new RegExp(`LIMIT ${MAX_CALL_LOG_ENTRIES}'`));
  assert.match(callLogCommand(0), /LIMIT 1'/);
  assert.match(callLogCommand(), /LIMIT 15'/);
});

test('parseCallLog : lignes de content query, types et numéros masqués', () => {
  const output = [
    'Row: 0 number=+33612345678, name=Maman, date=1700000005000, duration=42, type=1',
    'Row: 1 number=0612345678, name=NULL, date=1700000004000, duration=0, type=3',
    'Row: 2 number=-1, name=NULL, date=1700000003000, duration=0, type=3',
    // Un nom contenant une virgule ne doit pas couper la ligne en deux champs.
    'Row: 3 number=0145000000, name=Durand, Alice, date=1700000002000, duration=125, type=2',
    'bruit ignoré',
  ].join('\n');

  const entries = parseCallLog(output);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries[0], {
    number: '+33612345678',
    name: 'Maman',
    at: 1700000005000,
    duration: 42,
    type: 'incoming',
  });
  // `NULL` devient une chaîne vide, pas le texte « NULL ».
  assert.equal(entries[1].name, '');
  assert.equal(entries[1].type, 'missed');
  // Numéro masqué : Android écrit « -1 », rien à rappeler.
  assert.equal(entries[2].number, '');
  assert.equal(entries[3].name, 'Durand, Alice');
  assert.equal(entries[3].type, 'outgoing');
  assert.deepEqual(parseCallLog(''), []);
});

test('describeCallLogEntry : qui, rappelable, et appel manqué', () => {
  const named = describeCallLogEntry({ name: 'Maman', number: '+33612345678', type: 'incoming' });
  assert.equal(named.who, 'Maman');
  assert.equal(named.detail, '+33612345678');
  assert.equal(named.callable, true);
  assert.equal(named.missed, false);

  // Sans nom, le numéro fait office d'identité (et ne se répète pas dessous).
  const anonymous = describeCallLogEntry({ number: '0612345678', type: 'missed' });
  assert.equal(anonymous.who, '0612345678');
  assert.equal(anonymous.detail, '');
  assert.equal(anonymous.missed, true);

  // Numéro masqué : aucun bouton de rappel ne doit être proposé.
  const hidden = describeCallLogEntry({ number: '', type: 'rejected' });
  assert.equal(hidden.callable, false);
  assert.equal(hidden.who, 'Appelant inconnu');
  assert.equal(hidden.missed, true);
});

test('formatCallDuration : lisible, et vide pour un appel non décroché', () => {
  assert.equal(formatCallDuration(0), '');
  assert.equal(formatCallDuration(42), '42 s');
  assert.equal(formatCallDuration(125), '2 min 05');
  assert.equal(formatCallDuration(3725), '1 h 02');
});

test('sanitizePhoneNumber : ce numéro part sur une ligne de commande', () => {
  assert.equal(sanitizePhoneNumber('+33 6 12 34 56 78'), '+33612345678');
  assert.equal(sanitizePhoneNumber('(01) 45.00.00-00'), '0145000000');
  // Le « + » ne vaut qu'en tête.
  assert.equal(sanitizePhoneNumber('06+12'), '0612');
  // Tout ce qui pourrait s'échapper du `tel:` est refusé.
  assert.equal(sanitizePhoneNumber("0612345678'; rm -rf /"), '0612345678');
  assert.equal(sanitizePhoneNumber('$(reboot)'), null);
  assert.equal(sanitizePhoneNumber('sans chiffre'), null);
  assert.equal(sanitizePhoneNumber(''), null);
  assert.equal(sanitizePhoneNumber('1'.repeat(40)), null);
});

test('dialCommand : préparer (DIAL) et appeler (CALL) sont deux intentions', () => {
  assert.equal(dialCommand('+33612345678'), "am start -a android.intent.action.DIAL -d 'tel:+33612345678'");
  assert.equal(
    dialCommand('+33612345678', 'call'),
    "am start -a android.intent.action.CALL -d 'tel:+33612345678'"
  );
  // Un mode inconnu ne doit JAMAIS lancer un appel par surprise.
  assert.match(dialCommand('0612345678', 'nimporte quoi'), /action\.DIAL/);
  assert.equal(dialCommand('abc'), null);
});

test('phoneRemoteName : ce nom devient un chemin sur le téléphone', () => {
  assert.equal(phoneRemoteName('rapport.pdf'), 'rapport.pdf');
  // Les espaces restent (le chemin distant est cité), les accents aussi.
  assert.equal(phoneRemoteName('Rapport final été.pdf'), 'Rapport final été.pdf');
  // Aucune remontée de dossier, aucun séparateur : seul le nom de base.
  assert.equal(phoneRemoteName('../../etc/passwd'), 'passwd');
  assert.equal(phoneRemoteName('C:\\Windows\\notes.txt'), 'notes.txt');
  assert.equal(phoneRemoteName('/sdcard/../../root/cle'), 'cle');
  // Un nom qui commence par un point se cacherait sur l'appareil.
  assert.equal(phoneRemoteName('...bashrc'), 'bashrc');
  // Ce qui pourrait s'échapper des apostrophes du shell est retiré.
  // Le découpage sur « / » agit d'abord : il ne reste que le dernier segment,
  // débarrassé de ses apostrophes.
  assert.equal(phoneRemoteName("note'; rm -rf /tmp; '.txt"), 'tmp; .txt');
  assert.equal(phoneRemoteName('$(reboot).txt'), '(reboot).txt');
  assert.equal(phoneRemoteName('a`b`.txt'), 'ab.txt');
  // Rien d'exploitable : null, pour que l'appelant n'écrive pas un chemin vide.
  assert.equal(phoneRemoteName('/'), null);
  assert.equal(phoneRemoteName('...'), null);
  assert.equal(phoneRemoteName(''), null);
  // Nom démesuré : tronqué.
  assert.equal(phoneRemoteName('a'.repeat(300)).length, 120);
});

test('phonePushTarget : destination dans les téléchargements du téléphone', () => {
  assert.equal(phonePushTarget('photo.jpg'), `${PHONE_PUSH_DIR}/photo.jpg`);
  assert.equal(phonePushTarget('photo.jpg', '/sdcard/Documents'), '/sdcard/Documents/photo.jpg');
  assert.equal(phonePushTarget('../../../etc/shadow'), `${PHONE_PUSH_DIR}/shadow`);
  assert.equal(phonePushTarget(''), null);
});

test('phoneCallKey : maps answering and rejecting to Android call key events', () => {
  assert.equal(phoneCallKey('answer'), 'call');
  assert.equal(phoneCallKey('reject'), 'end_call');
  assert.equal(phoneCallKey('unknown'), null);
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

// ---------------------------------------------------------------------------
// « null » pris pour un nom d'appelant
// ---------------------------------------------------------------------------

test('parseAndroidNotifications : « tickerText=null » n\'est pas une valeur', () => {
  // Le bogue : `android.title=...` se lit dans un « String (…) » et ne peut
  // pas valoir « null », mais `tickerText` se lit jusqu'au bout de la ligne.
  // Le mot « null » devenait donc le nom de l'appelant à l'écran.
  const dump = [
    'NotificationRecord(0x1: pkg=com.samsung.android.incallui user=UserHandle{0} id=1 tag=null:',
    '  key=0|com.samsung.android.incallui|1|null|10123',
    '  when=1700000000000',
    '  tickerText=null',
    '  category=call',
    '    android.title=String (Appel entrant)',
    '    android.showChronometer=Boolean (true)',
  ].join('\n');

  const [item] = parseAndroidNotifications(dump);
  assert.equal('ticker' in item, false);
  const caller = describeCallNotification(item, 'Téléphone');
  assert.equal(caller.who, 'Téléphone');
  assert.equal(caller.unknown, true);
});

test('describeCallNotification : « null » n\'est jamais une identité', () => {
  for (const value of ['null', 'NULL', ' null ']) {
    const caller = describeCallNotification({ package: 'com.whatsapp', title: value }, 'WhatsApp');
    assert.equal(caller.named, false, value);
    assert.equal(caller.unknown, true, value);
  }
  // Un vrai nom qui CONTIENT « null » reste un nom.
  assert.equal(describeCallNotification({ title: 'Nulla Rakoto' }).who, 'Nulla Rakoto');
});

test('parseContactLookup : un display_name vide ne devient pas « null »', () => {
  assert.equal(parseContactLookup('Row: 0 display_name=NULL'), null);
  assert.equal(parseContactLookup('Row: 0 display_name=null'), null);
  assert.equal(parseContactLookup('Row: 0 display_name=Maman'), 'Maman');
});

// ---------------------------------------------------------------------------
// Sonnerie, Ne pas déranger
// ---------------------------------------------------------------------------

test('parseRingerMode : le mode INTERNE, celui qu\'Android applique', () => {
  assert.equal(parseRingerMode('- mode (internal) = NORMAL'), 'normal');
  assert.equal(parseRingerMode('  - mode (internal) = VIBRATE\n'), 'vibrate');
  assert.equal(parseRingerMode('- mode (internal) = SILENT'), 'silent');
  // Un appareil muet sur la question : on ne devine pas.
  assert.equal(parseRingerMode('Ringer mode:'), null);
  assert.equal(parseRingerMode(''), null);
});

test('parseRingVolume : index et bornes du flux de sonnerie', () => {
  assert.deepEqual(parseRingVolume('[V] volume is 8 in range [0..15]'), { index: 8, min: 0, max: 15 });
  assert.deepEqual(parseRingVolume('volume is 0 in range [0..7]'), { index: 0, min: 0, max: 7 });
  assert.equal(parseRingVolume('[V] Connecting to AudioService'), null);
});

test('ringVolumeCommand : flux de sonnerie, index borné à zéro', () => {
  assert.equal(ringVolumeCommand({ get: true }), 'cmd media_session volume --stream 2 --get');
  assert.equal(ringVolumeCommand({ set: 5 }), 'cmd media_session volume --stream 2 --set 5');
  assert.equal(ringVolumeCommand({ set: -3 }), 'cmd media_session volume --stream 2 --set 0');
});

test('parseZenMode / dndCommand', () => {
  assert.equal(parseZenMode('0'), false);
  assert.equal(parseZenMode('1'), true);
  assert.equal(parseZenMode('2\n'), true);
  assert.equal(parseZenMode('null'), null);
  assert.equal(dndCommand(true), 'cmd notification set_dnd on');
  assert.equal(dndCommand(false), 'cmd notification set_dnd off');
});

// ---------------------------------------------------------------------------
// Envoi d'un dossier
// ---------------------------------------------------------------------------

test('phoneRemoteRelativePath : l\'arborescence survit, les remontées non', () => {
  assert.equal(phoneRemoteRelativePath('Photos/2026/plage.jpg'), 'Photos/2026/plage.jpg');
  assert.equal(phoneRemoteRelativePath('Photos\\hiver\\ski.png'), 'Photos/hiver/ski.png');
  // « . » ne porte rien, « .. » ne survit pas à l'assainissement du segment :
  // une remontée de dossier ne doit pas pouvoir sortir des téléchargements.
  assert.equal(phoneRemoteRelativePath('./Docs/notes.md'), 'Docs/notes.md');
  assert.equal(phoneRemoteRelativePath('../../etc/passwd'), null);
  assert.equal(phoneRemoteRelativePath('Docs/../../passwd'), null);
  assert.equal(phoneRemoteRelativePath(''), null);
  // Les apostrophes et guillemets partent : le chemin distant est cité dans un
  // shell.
  assert.equal(phoneRemoteRelativePath("Mes'docs/a\"b.txt"), 'Mesdocs/ab.txt');
});

test('normalizePhoneSettings : l’ancien bureau en booléens est converti', () => {
  // Ce que portent les réglages de quelqu'un qui utilise déjà le Téléphone.
  // Son bureau ne doit ni se vider ni se remplir tout seul.
  const converted = normalizePhoneSettings({
    homeWidgets: {
      clock: true,
      device: true,
      favorites: true,
      recent: true,
      notifications: true,
      quickControls: true,
      calls: false,
    },
  }).homeWidgets;
  const types = converted.map((w) => w.type);
  assert.deepEqual(types, ['clock', 'device', 'notifications', 'favorites', 'recent']);
  // Ce qui était désactivé reste absent…
  assert.equal(types.includes('calls'), false);
  // …et les widgets qui n'existaient pas encore ne s'invitent pas.
  for (const nouveau of ['screen', 'calendar', 'media', 'storage']) {
    assert.equal(types.includes(nouveau), false, nouveau);
  }
  // Chaque carte a un identifiant unique et une taille connue.
  assert.equal(new Set(converted.map((w) => w.id)).size, converted.length);
  for (const widget of converted) assert.ok(widget.size, widget.type);
});

// ---------------------------------------------------------------------------
// Sources des widgets du bureau
// ---------------------------------------------------------------------------

test('calendarQueryCommand : filtre et tri faits SUR l’appareil', () => {
  const cmd = calendarQueryCommand({ from: 1700000000000, limit: 20 });
  assert.match(cmd, /content:\/\/com\.android\.calendar\/events/);
  assert.match(cmd, /--where "dtstart>=1700000000000"/);
  assert.match(cmd, /LIMIT 20/);
  // Bornes : une limite absurde ne part pas sur le téléphone.
  assert.match(calendarQueryCommand({ limit: 9999 }), /LIMIT 100/);
  assert.match(calendarQueryCommand({ limit: 0 }), /LIMIT 40/);
  assert.match(calendarQueryCommand({ from: -5 }), /dtstart>=0/);
});

test('parseCalendarEvents : virgules dans le titre, doublons, tri', () => {
  const now = 1700000000000;
  const out = [
    // Une virgule DANS le titre : le motif s'ancre sur le champ suivant.
    'Row: 0 title=Réunion, puis déjeuner, dtstart=1700003600000, dtend=1700007200000, allDay=0, eventLocation=Bureau',
    // Deux agendas synchronisés donnent deux fois le même évènement.
    'Row: 1 title=Noël, dtstart=1700100000000, dtend=1700186400000, allDay=1, eventLocation=',
    'Row: 2 title=Noël, dtstart=1700100000000, dtend=1700186400000, allDay=1, eventLocation=',
    // En cours à l'instant : doit passer devant.
    'Row: 3 title=Appel client, dtstart=1699999000000, dtend=1700001000000, allDay=0, eventLocation=',
    // Titre vide ou « null » : écarté.
    'Row: 4 title=null, dtstart=1700200000000, dtend=-1, allDay=0, eventLocation=',
    'Row: 5 title=, dtstart=1700300000000, dtend=-1, allDay=0, eventLocation=',
    'bruit qui ne ressemble à rien',
  ].join('\n');

  const events = parseCalendarEvents(out, { now });
  assert.deepEqual(events.map((e) => e.title), ['Appel client', 'Réunion, puis déjeuner', 'Noël']);
  assert.equal(events[1].location, 'Bureau');
  assert.equal(events[2].allDay, true);
  // `dtend=-1` n'est pas une fin : null plutôt qu'une date absurde.
  assert.equal(parseCalendarEvents('Row: 0 title=X, dtstart=100, dtend=-1, allDay=0, eventLocation=')[0].end, null);
  assert.deepEqual(parseCalendarEvents(''), []);
});

test('parseMediaSession : la session qui JOUE gagne', () => {
  const dump = [
    '  Headset com.android.server.telecom/HeadsetMediaButton (userId=0)',
    '    package=com.android.server.telecom',
    '    state=null',
    '    metadata: null',
    '  Music com.spotify.music/Session (userId=0)',
    '    package=com.spotify.music',
    '    state=PlaybackState {state=3, position=42000}',
    '    metadata: size=7, description=Redemption Song, Bob Marley, Legend',
    '  Autre com.sec.android.app.music/MBR (userId=0)',
    '    package=com.sec.android.app.music',
    '    state=PlaybackState {state=2, position=0}',
    '    metadata: size=3, description=Un titre, Un artiste, Un album',
  ].join('\n');

  const media = parseMediaSession(dump);
  assert.equal(media.package, 'com.spotify.music');
  assert.equal(media.state, 'playing');
  assert.equal(media.title, 'Redemption Song');
  assert.equal(media.artist, 'Bob Marley');

  // Rien en lecture : la session en pause remonte quand même (on peut la
  // relancer depuis la carte).
  const pause = parseMediaSession(dump.replace('state=3,', 'state=1,'));
  assert.equal(pause.state, 'paused');
  assert.equal(pause.package, 'com.sec.android.app.music');

  // Aucune session exploitable → null, pas une carte vide pleine de « null ».
  assert.equal(parseMediaSession('MEDIA SESSION SERVICE\n\n0 sessions.'), null);
  assert.equal(parseMediaSession(''), null);
});

test('mediaKeyCommand : liste fermée de touches', () => {
  assert.equal(mediaKeyCommand('play-pause'), 'cmd media_session dispatch play-pause');
  assert.equal(mediaKeyCommand('next'), 'cmd media_session dispatch next');
  // Tout le reste est refusé : la commande part sur une ligne de shell.
  for (const refuse of ['', null, 'rewind; rm -rf /', 'PLAY-PAUSE', 'dispatch']) {
    assert.equal(mediaKeyCommand(refuse), null, String(refuse));
  }
});

test('parseStorage : pourcentage et octets depuis df', () => {
  const out = [
    'Filesystem       1K-blocks      Used Available Use% Mounted on',
    '/dev/block/sda32 114971500 107283704   7556724  94% /data/user/0',
  ].join('\n');
  const storage = parseStorage(out);
  assert.equal(storage.percent, 94);
  assert.equal(storage.total, 114971500 * 1024);
  assert.equal(storage.used, 107283704 * 1024);
  assert.equal(storage.free, 7556724 * 1024);
  // Une sortie sans ligne exploitable ne devient pas un stockage à 0 %.
  assert.equal(parseStorage('df: /data: Permission denied'), null);
  assert.equal(parseStorage(''), null);
});

test('normalizePhoneSettings : les valeurs offertes par l’interface sont acceptées', () => {
  // Un curseur qui propose une valeur que le schéma corrige en silence ment
  // sur ce qui a été enregistré. Ce test lie les deux : si quelqu'un resserre
  // une borne du schéma, le contrôle correspondant doit suivre.
  for (const fps of [15, 20, 25, 30, 35, 40, 45, 50, 55, 60]) {
    assert.equal(normalizePhoneSettings({ mirrorFps: fps }).mirrorFps, fps, `fps ${fps}`);
  }
  for (const rate of ['2M', '4M', '6M', '8M', '12M', '16M', '24M']) {
    assert.equal(normalizePhoneSettings({ mirrorBitrate: rate }).mirrorBitrate, rate, rate);
  }
  for (const mode of ['name', 'recent', 'package']) {
    assert.equal(normalizePhoneSettings({ sortMode: mode }).sortMode, mode, mode);
  }
  for (const width of [88, 120, 160, 200, 240]) {
    assert.equal(normalizePhoneSettings({ gridMin: width }).gridMin, width, `gridMin ${width}`);
  }
  for (const size of ['small', 'medium', 'large']) {
    assert.equal(normalizePhoneSettings({ iconSize: size }).iconSize, size, size);
  }
});

test('normalizePhoneSettings : les réglages retirés ne reviennent pas', () => {
  // `openMode`, `appGridColumns`, `appGridRows` et `homeShadeOpen` ont été
  // supprimés parce qu'ils ne pilotaient plus rien. Une installation qui les
  // porte encore ne doit pas les voir réapparaître dans l'objet normalisé.
  const s = normalizePhoneSettings({
    openMode: 'mirror',
    appGridColumns: 9,
    appGridRows: 7,
    homeShadeOpen: true,
  });
  for (const mort of ['openMode', 'appGridColumns', 'appGridRows', 'homeShadeOpen']) {
    assert.equal(mort in s, false, mort);
  }
});
