// Chrome and the Android WebView record Opus in WebM; Safari and the iOS WebView record
// AAC in MP4. The orchestrator accepts both (backend/app/orchestrator/intake.py).
const CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus'
];

export function pickMimeType(isSupported: (type: string) => boolean): string | undefined {
  return CANDIDATES.find((type) => {
    try {
      return isSupported(type);
    } catch {
      return false;
    }
  });
}

/** "audio/webm;codecs=opus" → { type: "audio/webm", extension: "webm" } */
export function uploadTypeFor(mimeType: string): { type: string; extension: string } {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  if (base.endsWith('/mp4') || base === 'audio/x-m4a' || base === 'audio/aac') {
    return { type: 'audio/mp4', extension: 'm4a' };
  }
  if (base.endsWith('/ogg')) return { type: 'audio/ogg', extension: 'ogg' };
  return { type: 'audio/webm', extension: 'webm' };
}
