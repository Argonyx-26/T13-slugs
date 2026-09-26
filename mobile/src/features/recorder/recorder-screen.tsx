import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { firstWaiting } from '@/data/current-patient';
import { markSeen, QUEUE_KEY, useSession } from '@/data/session';
import { liveApi } from '@/data/source';
import type { QueuePatient } from '@/data/types';
import { useBackHandler } from '@/lib/back-button';
import { buzzError, buzzSuccess, isNative, tap } from '@/lib/platform';
import { CurrentPatient } from './current-patient';
import { DotTimer } from './dot-timer';
import { EndSheet, type EndFlow } from './end-sheet';
import { uploadTypeFor } from './engine/audio-format';
import type { Recording, RecorderError } from './engine/consultation-recorder';
import { LiveWaveform } from './live-waveform';
import { QueueButton } from './queue-button';
import { RecBadge } from './rec-badge';
import { RecordControls } from './record-controls';
import { useRecorder, useRecorderState } from './recorder-context';
import { StatusLine } from './status-line';

function micErrorText(error: RecorderError): string {
  switch (error) {
    case 'permission-denied':
      return isNative
        ? 'Microphone access is off. Allow it in Settings › Apps › Lumen › Permissions.'
        : 'Microphone access is blocked. Allow it in the browser’s site settings.';
    case 'no-microphone':
      return 'No microphone was found on this device.';
    case 'microphone-busy':
      return 'Another app is using the microphone. Close it and try again.';
    case 'insecure-context':
      return 'The microphone only works over https or on localhost.';
    case 'unsupported':
      return 'This device can’t record audio here.';
    case 'unknown':
      return 'The microphone could not be started. Try again.';
  }
}

export function RecorderScreen() {
  const recorder = useRecorder();
  const { status, error, autoPaused } = useRecorderState();
  const { current, queue, pin, unpin, queueOpen, setQueueOpen, queueState, queueError } =
    useSession();
  const client = useQueryClient();
  const [flow, setFlow] = useState<EndFlow>({ step: 'closed' });

  const inSession = status === 'recording' || status === 'paused';
  const waiting = queue.filter((p) => p.status === 'waiting').length;
  const next = current ? firstWaiting(queue, current.visitId) : null;

  // Say why the recording paused itself once the app is back in front
  useEffect(() => {
    if (!autoPaused) return;
    const announce = () => {
      if (document.hidden) return;
      toast('Recording paused while Lumen was in the background');
      recorder.acknowledgeAutoPause();
    };
    announce();
    document.addEventListener('visibilitychange', announce);
    return () => document.removeEventListener('visibilitychange', announce);
  }, [autoPaused, recorder]);

  useEffect(() => {
    if (status !== 'error' || !error) return;
    toast(micErrorText(error), 'error', 5000);
    buzzError();
  }, [status, error]);

  // A called-in patient seen elsewhere (another phone, the desk) is released
  useEffect(() => {
    if (current?.status === 'seen' && status === 'idle' && flow.step === 'closed') unpin();
  }, [current, status, flow.step, unpin]);

  const record = async () => {
    if (!current) return;
    tap('medium');
    pin(current); // a queue refresh can never swap patients mid-recording
    await recorder.start();
  };

  const end = () => {
    tap('medium');
    const resumeOnCancel = status === 'recording';
    recorder.pause(); // nothing is lost until the doctor confirms
    setFlow({ step: 'confirm', resumeOnCancel });
  };

  const keepRecording = () => {
    if (flow.step === 'confirm' && flow.resumeOnCancel) recorder.resume();
    setFlow({ step: 'closed' });
  };

  const save = async (recording: Recording, patient: QueuePatient) => {
    if (!liveApi) {
      markSeen(client, patient.visitId);
      buzzSuccess();
      setFlow({ step: 'saved', recording, uploadedFor: null });
      return;
    }
    setFlow({ step: 'saving' });
    try {
      const { type, extension } = uploadTypeFor(recording.mimeType);
      const accepted = await liveApi.submitConsultation({
        audio: recording.blob,
        type,
        filename: `consultation-${patient.visitId}.${extension}`,
        patientId: patient.patientId,
        visitId: patient.visitId
      });
      markSeen(client, patient.visitId);
      void client.invalidateQueries({ queryKey: QUEUE_KEY });
      buzzSuccess();
      setFlow({ step: 'saved', recording, uploadedFor: accepted.displayName ?? patient.name });
    } catch (e) {
      buzzError();
      setFlow({
        step: 'failed',
        recording,
        message: e instanceof Error ? e.message : 'The upload failed.'
      });
    }
  };

  const confirmEnd = async () => {
    const patient = current;
    if (!patient) return;
    setFlow({ step: 'saving' });
    const recording = await recorder.stop();
    if (!recording) {
      setFlow({ step: 'closed' });
      return;
    }
    await save(recording, patient);
  };

  const finish = () => {
    recorder.reset();
    unpin(); // the next waiting patient moves up
    setFlow({ step: 'closed' });
  };

  const retry = () => {
    if (flow.step === 'failed' && current) void save(flow.recording, current);
  };

  useBackHandler(
    flow.step === 'confirm'
      ? keepRecording
      : flow.step === 'saved'
        ? finish
        : flow.step !== 'closed'
          ? () => {}
          : inSession
            ? () => toast('Recording in progress. Tap End to finish.')
            : null
  );

  return (
    <div className='relative flex h-full flex-col overflow-hidden bg-ink bg-dot-grid pt-safe pb-safe'>
      <header className='relative z-30 flex h-[64px] shrink-0 items-center justify-between px-5'>
        {queueOpen ? (
          <span className='h-11 w-[150px]' />
        ) : (
          <QueueButton
            waiting={waiting}
            onOpen={() => {
              tap();
              setQueueOpen(true);
            }}
          />
        )}
        <RecBadge status={status} />
      </header>

      <section className='shrink-0 px-6 pt-3'>
        <CurrentPatient
          patient={current}
          inConsultation={inSession || flow.step !== 'closed'}
          queueState={queueState}
          queueError={queueError}
        />
      </section>

      <section className='flex min-h-0 flex-1 flex-col items-center justify-center'>
        <DotTimer />
        <StatusLine
          status={status}
          saving={flow.step === 'saving'}
          hasPatient={Boolean(current)}
          queueState={queueState}
        />
        <LiveWaveform
          className='mt-[clamp(10px,3.5cqh,32px)] h-[clamp(84px,16.5cqh,152px)]'
          levels={recorder.levels}
          status={status}
          visible={!queueOpen}
        />
      </section>

      <footer className='shrink-0 px-6 pt-2 pb-[clamp(14px,3.5cqh,32px)]'>
        <RecordControls
          status={status}
          canRecord={current?.status === 'waiting'}
          onRecord={() => void record()}
          onPause={() => {
            tap();
            recorder.pause();
          }}
          onResume={() => {
            tap();
            recorder.resume();
          }}
          onEnd={end}
        />
      </footer>

      <EndSheet
        flow={flow}
        patient={current}
        next={next}
        live={Boolean(liveApi)}
        onKeepRecording={keepRecording}
        onConfirm={() => void confirmEnd()}
        onFinish={finish}
        onRetry={retry}
        onDiscard={finish}
      />
    </div>
  );
}
