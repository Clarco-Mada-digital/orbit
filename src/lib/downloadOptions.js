export function parseDownloadUrl(value) {
  const text = String(value || '').trim();
  if (!text) return { success: false, reason: 'empty' };
  try {
    const url = new URL(text);
    if (url.protocol === 'magnet:') {
      const topic = url.searchParams.get('xt') || '';
      if (!/^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$|^urn:btmh:1220[a-f0-9]{64}$/i.test(topic)) {
        return { success: false, reason: 'invalid-torrent-link' };
      }
      return { success: true, type: 'torrent', url: text };
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return { success: false, reason: 'unsupported-url' };
    }
    return { success: true, type: 'file', url: url.href };
  } catch {
    return { success: false, reason: 'invalid-url' };
  }
}

export function mediaFormatOptions(mode, { videoQuality = 'best', audioFormat = 'm4a', hasFfmpeg = false } = {}) {
  if (mode === 'audio') {
    if (audioFormat === 'mp3' && hasFfmpeg) {
      return { format: 'bestaudio/best', extractAudio: true, audioFormat: 'mp3', mergeOutputFormat: null };
    }
    return {
      format: 'bestaudio[ext=m4a]/bestaudio/best',
      extractAudio: false,
      audioFormat: 'm4a',
      mergeOutputFormat: null,
    };
  }

  const maxHeight = ({ '1080p': 1080, '720p': 720, '480p': 480 })[videoQuality];
  const height = maxHeight ? `[height<=${maxHeight}]` : '';
  if (!hasFfmpeg) {
    return {
      format: `best${height}[ext=mp4]/best${height}/best`,
      extractAudio: false,
      audioFormat: null,
      mergeOutputFormat: null,
    };
  }
  return {
    format: `bestvideo${height}[ext=mp4]+bestaudio[ext=m4a]/best${height}[ext=mp4]/best${height}/best`,
    extractAudio: false,
    audioFormat: null,
    mergeOutputFormat: 'mp4',
  };
}
