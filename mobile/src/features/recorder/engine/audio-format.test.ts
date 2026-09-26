import { describe, expect, it } from 'vitest';
import { pickMimeType, uploadTypeFor } from './audio-format';

describe('pickMimeType', () => {
  it('prefers Opus in WebM (Chrome, Android WebView)', () => {
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('falls back to MP4 where WebM is unsupported (Safari, iOS)', () => {
    expect(pickMimeType((t) => t.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
  });

  it('returns undefined when nothing matches or the check throws', () => {
    expect(pickMimeType(() => false)).toBeUndefined();
    expect(
      pickMimeType(() => {
        throw new Error('not implemented');
      })
    ).toBeUndefined();
  });
});

describe('uploadTypeFor', () => {
  it('drops codec parameters and names the file for the orchestrator', () => {
    expect(uploadTypeFor('audio/webm;codecs=opus')).toEqual({
      type: 'audio/webm',
      extension: 'webm'
    });
    expect(uploadTypeFor('audio/mp4')).toEqual({ type: 'audio/mp4', extension: 'm4a' });
    expect(uploadTypeFor('video/mp4')).toEqual({ type: 'audio/mp4', extension: 'm4a' });
    expect(uploadTypeFor('audio/ogg;codecs=opus')).toEqual({ type: 'audio/ogg', extension: 'ogg' });
    expect(uploadTypeFor('')).toEqual({ type: 'audio/webm', extension: 'webm' });
  });
});
