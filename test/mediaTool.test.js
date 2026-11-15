// ---------------------------------------------------------------------------
// Approvisionnement de yt-dlp (src/lib/mediaTool.js).
//
// Ce que ces tests protègent : la règle « on part avec ce qu'on a ». Le
// téléchargement vidéo échouait une fois sur trois parce qu'un binaire
// utilisable posé sur le disque était refusé dès que le réseau ne répondait
// pas. `chooseTool` ne doit JAMAIS rendre `use: null` quand un binaire existe.
// ---------------------------------------------------------------------------
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFRESH_AFTER_MS,
  STALE_AFTER_MS,
  MAX_TOOL_BYTES,
  assetNameFor,
  releaseAssetUrl,
  CHECKSUMS_URL,
  chooseTool,
  parseChecksums,
  verifyDownload,
} from '../src/lib/mediaTool.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

// --- Plateformes ----------------------------------------------------------

test('assetNameFor : un asset par plateforme réellement publiée', () => {
  assert.equal(assetNameFor('win32', 'x64'), 'yt-dlp.exe');
  assert.equal(assetNameFor('darwin', 'arm64'), 'yt-dlp_macos');
  assert.equal(assetNameFor('linux', 'x64'), 'yt-dlp_linux');
  assert.equal(assetNameFor('linux', 'arm64'), 'yt-dlp_linux_aarch64');
  // Plateforme sans binaire publié : on rend null, l'appelant le dira
  assert.equal(assetNameFor('linux', 'riscv64'), null);
  assert.equal(assetNameFor('freebsd', 'x64'), null);
});

test('releaseAssetUrl : on n’interroge plus l’API GitHub (quota 60/h)', () => {
  const url = releaseAssetUrl('yt-dlp_linux');
  assert.equal(url, 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux');
  assert.ok(!url.includes('api.github.com'), 'l’API a un quota : elle était la cause des échecs');
  assert.ok(CHECKSUMS_URL.endsWith('/SHA2-256SUMS'));
  assert.equal(releaseAssetUrl(null), null);
});

// --- Empreintes -----------------------------------------------------------

const SUMS = [
  'aaaa000000000000000000000000000000000000000000000000000000000001  yt-dlp',
  'bbbb000000000000000000000000000000000000000000000000000000000002  yt-dlp_linux',
  'cccc000000000000000000000000000000000000000000000000000000000003 *yt-dlp.exe',
].join('\n');

test('parseChecksums : la bonne ligne, pas celle qui commence pareil', () => {
  // « yt-dlp » est un préfixe de « yt-dlp_linux » : une correspondance
  // approximative donnerait la mauvaise empreinte, donc un binaire refusé.
  assert.equal(
    parseChecksums(SUMS, 'yt-dlp_linux'),
    'bbbb000000000000000000000000000000000000000000000000000000000002'
  );
  assert.equal(
    parseChecksums(SUMS, 'yt-dlp'),
    'aaaa000000000000000000000000000000000000000000000000000000000001'
  );
  // Le format « *nom » (mode binaire de sha256sum) est accepté
  assert.equal(
    parseChecksums(SUMS, 'yt-dlp.exe'),
    'cccc000000000000000000000000000000000000000000000000000000000003'
  );
  assert.equal(parseChecksums(SUMS, 'yt-dlp_macos'), null);
  assert.equal(parseChecksums('', 'yt-dlp'), null);
  assert.equal(parseChecksums(SUMS, null), null);
});

// --- La décision ----------------------------------------------------------

test('chooseTool : binaire récent → on part tout de suite, sans réseau', () => {
  const d = chooseTool({ cached: { path: '/c/yt-dlp', mtimeMs: NOW - DAY }, now: NOW });
  assert.equal(d.use, '/c/yt-dlp');
  assert.equal(d.refresh, false);
  assert.equal(d.blocking, false);
});

test('chooseTool : binaire à rafraîchir → on part quand même, mise à jour derrière', () => {
  // LE correctif : on ne fait plus attendre 41 Mo avant de lancer la vidéo.
  const d = chooseTool({
    cached: { path: '/c/yt-dlp', mtimeMs: NOW - REFRESH_AFTER_MS - DAY },
    now: NOW,
  });
  assert.equal(d.use, '/c/yt-dlp');
  assert.equal(d.refresh, true);
  assert.equal(d.blocking, false, 'le rafraîchissement ne doit pas bloquer le téléchargement');
});

test('chooseTool : binaire très vieux → on attend, mais on garde un repli', () => {
  const d = chooseTool({
    cached: { path: '/c/yt-dlp', mtimeMs: NOW - STALE_AFTER_MS - DAY },
    now: NOW,
  });
  assert.equal(d.blocking, true);
  assert.equal(d.use, '/c/yt-dlp', 'même très vieux, il reste le repli si le réseau tombe');
});

test('chooseTool : jamais de cul-de-sac quand un binaire existe', () => {
  // La régression à empêcher : un yt-dlp présent et refusé parce qu’il est
  // vieux et que GitHub ne répond pas.
  for (const age of [0, DAY, 10 * DAY, 100 * DAY, 10_000 * DAY]) {
    const d = chooseTool({ cached: { path: '/c/yt-dlp', mtimeMs: NOW - age }, now: NOW });
    assert.equal(d.use, '/c/yt-dlp', `âge ${age} ms : le binaire présent doit rester utilisable`);
  }
});

test('chooseTool : le yt-dlp système est un filet, pas un premier choix', () => {
  // Un paquet de distribution a souvent des années de retard (2024.04.09 sur
  // la machine de développement, en échec sur chaque vidéo YouTube). On
  // attend donc notre version, et le système ne sert que si ça échoue.
  const d = chooseTool({ cached: null, system: '/usr/bin/yt-dlp', now: NOW });
  assert.equal(d.use, '/usr/bin/yt-dlp', 'il reste le repli si le téléchargement échoue');
  assert.equal(d.refresh, true);
  assert.equal(d.blocking, true, 'mieux vaut attendre une fois qu’échouer à coup sûr');
});

test('chooseTool : rien du tout → il faut bien attendre', () => {
  const d = chooseTool({ cached: null, system: null, now: NOW });
  assert.equal(d.use, null);
  assert.equal(d.blocking, true);
  assert.equal(d.reason, 'missing');
});

test('chooseTool : mtime absent ou absurde ne fait pas rendre un âge négatif', () => {
  const d = chooseTool({ cached: { path: '/c/yt-dlp', mtimeMs: NOW + 10 * DAY }, now: NOW });
  assert.equal(d.use, '/c/yt-dlp');
  assert.equal(d.refresh, false, 'un horodatage dans le futur compte comme neuf, pas comme périmé');
});

// --- Vérification du binaire téléchargé -----------------------------------

test('verifyDownload : empreinte juste → accepté', () => {
  const r = verifyDownload({ receivedSize: 1000, expectedSum: 'ABC', actualSum: 'abc' });
  assert.equal(r.ok, true);
});

test('verifyDownload : sans empreinte on refuse, c’est la seule garantie', () => {
  assert.equal(verifyDownload({ receivedSize: 1000, expectedSum: null, actualSum: 'abc' }).ok, false);
  assert.equal(
    verifyDownload({ receivedSize: 1000, expectedSum: 'abc', actualSum: 'def' }).reason,
    'checksum-mismatch'
  );
});

test('verifyDownload : la taille est facultative (la redirection ne l’annonce pas toujours)', () => {
  const ok = verifyDownload({ expectedSize: null, receivedSize: 42, expectedSum: 'a', actualSum: 'a' });
  assert.equal(ok.ok, true, 'exiger une taille absente redonnerait l’échec qu’on vient de retirer');
  // Mais si elle est annoncée, elle doit concorder
  assert.equal(
    verifyDownload({ expectedSize: 99, receivedSize: 42, expectedSum: 'a', actualSum: 'a' }).reason,
    'size-mismatch'
  );
});

test('verifyDownload : réponse vide ou démesurée refusée', () => {
  assert.equal(verifyDownload({ receivedSize: 0, expectedSum: 'a', actualSum: 'a' }).reason, 'empty');
  assert.equal(
    verifyDownload({ receivedSize: MAX_TOOL_BYTES + 1, expectedSum: 'a', actualSum: 'a' }).reason,
    'size-too-large'
  );
});
