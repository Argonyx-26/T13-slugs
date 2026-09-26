import { allowScreenOff, keepScreenOn } from '@/lib/platform';
import { pickMimeType } from './audio-format';
import { ElapsedClock } from './elapsed-clock';
import { LevelHistory, levelFromSamples } from './level';

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopping' | 'error';

export type RecorderError =
  | 'permission-denied'
  | 'no-microphone'
  | 'microphone-busy'
  | 'insecure-context'
  | 'unsupported'
  | 'unknown';

export interface RecorderSnapshot {
  status: RecorderStatus;
  error: RecorderError | null;
  /** Paused by the app going to the background rather than by the doctor */
  autoPaused: boolean;
}

export interface Recording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/** How often the waveform gets a new loudness value */
export const LEVEL_SAMPLE_MS = 100;

// Ambient capture of a two-person consultation: no echo cancellation or noise suppression
// (they eat quiet, distant speech; the STT does its own clean-up), automatic gain on.
const MIC_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true
};

// ~5.4 MB for a 15-minute consultation, well inside the orchestrator's 25 MB limit
const BITRATE = 48_000;

/**
 * One consultation recording. A single microphone stream feeds both the MediaRecorder
 * (the file) and a Web Audio analyser (the live waveform). Framework-free: React
 * subscribes through subscribe/getSnapshot.
 */
export class ConsultationRecorder {
  readonly clock = new ElapsedClock();
  readonly levels = new LevelHistory();

  private snapshot: RecorderSnapshot = { status: 'idle', error: null, autoPaused: false };
  private readonly listeners = new Set<() => void>();
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private frame: Float32Array<ArrayBuffer> | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private sampler = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  elapsedMs() {
    return this.clock.elapsed();
  }

  /** Must be called from a tap: browsers only start audio from a user gesture. */
  async start(): Promise<boolean> {
    const { status } = this.snapshot;
    if (status !== 'idle' && status !== 'error') return false;
    if (!navigator.mediaDevices?.getUserMedia) {
      return this.fail(window.isSecureContext ? 'unsupported' : 'insecure-context');
    }
    if (typeof MediaRecorder === 'undefined') return this.fail('unsupported');

    // Created before the permission prompt, while the tap still counts as a user gesture
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new AudioContextClass();
    this.context.resume().catch(() => {});
    this.set({ status: 'requesting', error: null, autoPaused: false });

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    } catch (error) {
      await this.teardown();
      return this.fail(errorKind(error));
    }

    try {
      const context = this.context;
      const source = context.createMediaStreamSource(this.stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      // A muted path to the speakers keeps the graph running on every browser, silently
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(analyser);
      analyser.connect(mute);
      mute.connect(context.destination);
      this.analyser = analyser;
      this.frame = new Float32Array(analyser.fftSize);

      const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(this.stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: BITRATE
      });
      this.chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.start(1000); // a chunk a second, so a crash loses at most a second
      this.recorder = recorder;
    } catch {
      await this.teardown();
      return this.fail('unsupported');
    }

    this.levels.clear();
    this.clock.start();
    this.startSampling();
    keepScreenOn();
    this.set({ status: 'recording' });
    return true;
  }

  /** `auto`: paused because the app left the foreground, not by the doctor */
  pause(auto = false) {
    if (this.snapshot.status !== 'recording' || !this.recorder) return;
    this.recorder.pause();
    this.clock.pause();
    this.stopSampling();
    this.set({ status: 'paused', autoPaused: auto });
  }

  resume() {
    if (this.snapshot.status !== 'paused' || !this.recorder) return;
    this.context?.resume().catch(() => {});
    this.recorder.resume();
    this.clock.resume();
    this.startSampling();
    keepScreenOn(); // the wake lock is dropped whenever the app is hidden
    this.set({ status: 'recording', autoPaused: false });
  }

  /** Finishes the file and releases the microphone. The timer keeps showing the total. */
  async stop(): Promise<Recording | null> {
    const recorder = this.recorder;
    const { status } = this.snapshot;
    if (!recorder || (status !== 'recording' && status !== 'paused')) return null;
    this.set({ status: 'stopping', autoPaused: false });
    this.stopSampling();
    const durationMs = this.clock.stop();

    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
    });
    recorder.stop();
    await stopped;

    const mimeType = recorder.mimeType || this.chunks[0]?.type || 'audio/webm';
    const blob = new Blob(this.chunks, { type: mimeType });
    this.chunks = [];
    await this.teardown();
    this.set({ status: 'idle' });
    return { blob, mimeType, durationMs };
  }

  /** Back to 00:00 and a flat waveform, ready for the next patient */
  reset() {
    if (this.snapshot.status !== 'idle' && this.snapshot.status !== 'error') return;
    this.clock.reset();
    this.levels.clear();
    this.set({ status: 'idle', error: null, autoPaused: false });
  }

  acknowledgeAutoPause() {
    if (this.snapshot.autoPaused) this.set({ autoPaused: false });
  }

  private startSampling() {
    this.stopSampling();
    this.sampler = window.setInterval(() => {
      if (!this.analyser || !this.frame) return;
      this.analyser.getFloatTimeDomainData(this.frame);
      this.levels.push(levelFromSamples(this.frame), performance.now());
    }, LEVEL_SAMPLE_MS);
  }

  private stopSampling() {
    window.clearInterval(this.sampler);
    this.sampler = 0;
  }

  private async teardown() {
    this.stopSampling();
    this.stream?.getTracks().forEach((track) => track.stop()); // turns the mic indicator off
    this.stream = null;
    this.recorder = null;
    this.analyser = null;
    this.frame = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') await context.close().catch(() => {});
    allowScreenOff();
  }

  private fail(error: RecorderError): false {
    this.set({ status: 'error', error, autoPaused: false });
    return false;
  }

  private set(patch: Partial<RecorderSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}

function errorKind(error: unknown): RecorderError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission-denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no-microphone';
    case 'NotReadableError':
    case 'AbortError':
      return 'microphone-busy';
    default:
      return 'unknown';
  }
}
