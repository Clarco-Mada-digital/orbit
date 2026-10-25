import assert from 'node:assert/strict';
import test from 'node:test';
import { getJavaInstallInstructions } from '../src/lib/javaRuntime.js';

test('Java installation instructions select Debian commands for Linux Mint variants', () => {
  assert.deepEqual(
    getJavaInstallInstructions('linux', { distroId: 'linuxmint', distroLike: 'debian' }),
    {
      label: 'Debian · Ubuntu · Linux Mint',
      command: 'sudo apt update && sudo apt install -y openjdk-17-jre-headless',
    }
  );
  assert.equal(
    getJavaInstallInstructions('linux', { distroId: 'lmde', distroLike: 'debian' }).command,
    'sudo apt update && sudo apt install -y openjdk-17-jre-headless'
  );
});

test('Java installation instructions cover Fedora, Arch, macOS, and Windows', () => {
  assert.match(getJavaInstallInstructions('linux', { distroId: 'fedora' }).command, /dnf/);
  assert.match(getJavaInstallInstructions('linux', { distroId: 'arch' }).command, /pacman/);
  assert.match(getJavaInstallInstructions('darwin').command, /brew/);
  assert.match(getJavaInstallInstructions('win32').command, /winget/);
});

test('unknown operating systems do not receive a guessed installation command', () => {
  assert.equal(getJavaInstallInstructions('linux').command, '');
  assert.equal(getJavaInstallInstructions('freebsd').command, '');
});
