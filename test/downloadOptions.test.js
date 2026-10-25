import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaFormatOptions, parseDownloadUrl } from '../src/lib/downloadOptions.js';

test('download URL parser accepts HTTP(S) links without credentials', () => {
  assert.deepEqual(parseDownloadUrl('https://example.test/file.zip'), {
    success: true,
    type: 'file',
    url: 'https://example.test/file.zip',
  });
  assert.equal(parseDownloadUrl('javascript:alert(1)').success, false);
  assert.equal(parseDownloadUrl('https://user:password@example.test/file').success, false);
  assert.equal(parseDownloadUrl('').reason, 'empty');
});

test('magnet links require a valid BitTorrent info hash', () => {
  assert.equal(
    parseDownloadUrl(`magnet:?xt=urn:btih:${'a'.repeat(40)}`).type,
    'torrent'
  );
  assert.equal(parseDownloadUrl('magnet:?xt=urn:btih:bad-hash').reason, 'invalid-torrent-link');
});

test('video and audio format selection degrades safely without ffmpeg', () => {
  assert.deepEqual(mediaFormatOptions('video', { videoQuality: '720p', hasFfmpeg: false }), {
    format: 'best[height<=720][ext=mp4]/best[height<=720]/best',
    extractAudio: false,
    audioFormat: null,
    mergeOutputFormat: null,
  });
  assert.equal(mediaFormatOptions('video', { videoQuality: '1080p', hasFfmpeg: true }).mergeOutputFormat, 'mp4');
  assert.deepEqual(mediaFormatOptions('audio', { audioFormat: 'mp3', hasFfmpeg: false }), {
    format: 'bestaudio[ext=m4a]/bestaudio/best',
    extractAudio: false,
    audioFormat: 'm4a',
    mergeOutputFormat: null,
  });
  assert.equal(mediaFormatOptions('audio', { audioFormat: 'mp3', hasFfmpeg: true }).extractAudio, true);
});
