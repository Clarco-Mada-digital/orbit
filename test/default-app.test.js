import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DESKTOP_FILE,
  LINUX_MIME_TYPES,
  desktopEntryText,
  isManaged,
  propose,
  status,
  unpropose,
} from '../electron/default-app.js';

// « Ouvrir avec » : ces tests travaillent dans des dossiers TEMPORAIRES — la
// machine de développement n'est jamais modifiée. Ils verrouillent la règle
// importante : on propose, on ne prend rien par défaut, et on n'écrase jamais
// un fichier qui n'est pas le nôtre.

function tempCtx(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-apps-'));
  return {
    platform: 'linux',
    packaged: true,
    appName: 'Orbit',
    execPath: '/opt/orbit/orbit',
    execArgs: [],
    iconPath: '/opt/orbit/icon.png',
    applicationsDir: dir,
    systemApplicationsDirs: [],
    ...over,
    _dir: dir,
  };
}

test('desktopEntryText : déclare nos types MIME et se marque comme nôtre', () => {
  const text = desktopEntryText({ appName: 'Orbit', execPath: '/opt/orbit/orbit' });
  for (const mime of LINUX_MIME_TYPES) assert.ok(text.includes(mime), `${mime} manquant`);
  // La liste est construite depuis LINUX_MIME_TYPES (source unique) : on
  // vérifie qu'elle est écrite en entier dans le fichier .desktop.
  assert.match(text, new RegExp(`^MimeType=${LINUX_MIME_TYPES.join(';')};$`, 'm'));
  // Les documents texte sont déclarés : c'est ce qui rend « Ouvrir avec » utile
  // pour un .md ou un .json, pas seulement pour un .html.
  for (const mime of ['text/markdown', 'application/json', 'text/csv', 'application/pdf']) {
    assert.ok(LINUX_MIME_TYPES.includes(mime), `${mime} devrait être déclaré`);
  }
  assert.ok(text.includes('X-Orbit-Managed=true'));
  assert.ok(text.includes('StartupWMClass=orbit'));
  // %U = liste d'URL : couvre les liens web ET les fichiers.
  assert.match(text, /^Exec=.* %U$/m);
  assert.ok(text.startsWith('[Desktop Entry]'));
});

test('desktopEntryText : un chemin avec espaces est cité, et % doublé', () => {
  // Un détail suffit à tout casser : « % » non doublé est lu comme un champ
  // (%U, %f…) par le bureau, et un chemin non cité coupe l'Exec en deux.
  const text = desktopEntryText({
    execPath: '/home/mon dossier/orbit',
    execArgs: ['/srv/100% espace/app'],
  });
  const exec = (text.match(/^Exec=(.*)$/m) || [])[1];
  assert.equal(exec, '"/home/mon dossier/orbit" "/srv/100%% espace/app" %U');

  // Sans espace, pas de guillemets — mais le % reste doublé.
  const simple = desktopEntryText({ execPath: '/opt/orbit', execArgs: ['/srv/100%25/app'] });
  assert.equal((simple.match(/^Exec=(.*)$/m) || [])[1], '/opt/orbit /srv/100%%25/app %U');
});

test('propose : dépose l’entrée utilisateur, puis unpropose la retire', () => {
  const ctx = tempCtx();
  assert.equal(isManaged(ctx), false, 'rien au départ');

  const res = propose(ctx);
  assert.deepEqual({ success: res.success, changed: res.changed }, { success: true, changed: true });
  assert.equal(isManaged(ctx), true);
  assert.ok(fs.existsSync(path.join(ctx.applicationsDir, DESKTOP_FILE)));

  // L'état devient « proposé » pour les liens web ET les pages HTML.
  const st = status(ctx);
  assert.equal(st.canManage, true);
  assert.equal(st.web.proposed, true);
  assert.equal(st.html.proposed, true);
  assert.equal(st.managed, true);

  const off = unpropose(ctx);
  assert.deepEqual({ success: off.success, changed: off.changed }, { success: true, changed: true });
  assert.equal(isManaged(ctx), false);
  assert.equal(status(ctx).web.proposed, false);
});

test('propose : n’écrase JAMAIS un fichier orbit.desktop qui n’est pas le nôtre', () => {
  const ctx = tempCtx();
  const file = path.join(ctx.applicationsDir, DESKTOP_FILE);
  const foreign = '[Desktop Entry]\nName=Orbit\nExec=/autre/chemin %U\n';
  fs.writeFileSync(file, foreign);

  const res = propose(ctx);
  assert.equal(res.success, false);
  assert.equal(res.error, 'file-exists');
  assert.equal(fs.readFileSync(file, 'utf8'), foreign, 'le fichier doit rester intact');

  // Et unpropose ne le supprime pas non plus.
  assert.equal(unpropose(ctx).changed, false);
  assert.ok(fs.existsSync(file));
});

test('status : une version installée qui déclare les types suffit', () => {
  // Cas réel : le paquet (deb) ou AppImage a déjà son entrée dans un dossier
  // système. Déposer la nôtre serait inutile — et l'écran doit le refléter.
  const sys = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-sys-'));
  fs.writeFileSync(
    path.join(sys, 'appimagekit_1234-orbit.desktop'),
    `[Desktop Entry]\nName=Orbit\nMimeType=${LINUX_MIME_TYPES.join(';')};\n`
  );
  const ctx = tempCtx({ systemApplicationsDirs: [sys] });
  const st = status(ctx);
  assert.equal(st.web.proposed, true);
  assert.equal(st.html.proposed, true);
  assert.equal(st.managed, false, 'ce fichier n’est pas le nôtre');
});

test('status : un paquet installé SANS nos types MIME ne compte pas comme proposé', () => {
  const sys = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-sys2-'));
  fs.writeFileSync(path.join(sys, 'orbit.desktop'), '[Desktop Entry]\nName=Orbit\nExec=/opt/orbit %U\n');
  const st = status(tempCtx({ systemApplicationsDirs: [sys] }));
  assert.equal(st.web.proposed, false);
  assert.equal(st.html.proposed, false);
});

test('status : informe si Orbit est DÉJÀ le gestionnaire par défaut', () => {
  const ctx = tempCtx({ webDefault: undefined });
  assert.equal(status(ctx, { webDefault: 'orbit.desktop' }).web.isDefault, true);
  assert.equal(status(ctx, { webDefault: 'firefox.desktop' }).web.isDefault, false);
  // Un fichier d'un paquet au même nom compte aussi.
  assert.equal(status(ctx, { htmlDefault: '/usr/share/applications/orbit.desktop' }).html.isDefault, true);
});

test('macOS : rien à faire (déclaré dans le paquet), et on ne touche à aucun fichier', () => {
  const ctx = tempCtx({ platform: 'darwin', systemApplicationsDirs: [] });
  const res = propose(ctx);
  assert.deepEqual({ success: res.success, changed: res.changed }, { success: true, changed: false });
  assert.equal(fs.readdirSync(ctx.applicationsDir).length, 0);
  const st = status(ctx);
  assert.equal(st.canManage, false);
  assert.equal(st.note, 'bundled');
  // « proposé » est INCONNU sous macOS (on ne peut pas le vérifier) — l'écran
  // affiche alors une explication plutôt qu'un badge faux.
  assert.equal(st.web.proposed, null);
  assert.equal(st.html.proposed, null);
});

test('Windows : refus explicite, aucun accès au registre', () => {
  const ctx = tempCtx({ platform: 'win32' });
  const res = propose(ctx);
  assert.equal(res.success, false);
  assert.equal(res.error, 'unsupported-platform');
  const st = status(ctx);
  assert.equal(st.canManage, false);
  assert.equal(st.note, 'installer');
  assert.equal(unpropose(ctx).changed, false);
});

test('unpropose : sans rien avoir posé, ne fait rien et le dit', () => {
  const ctx = tempCtx();
  assert.deepEqual(unpropose(ctx), { success: true, changed: false });
});
