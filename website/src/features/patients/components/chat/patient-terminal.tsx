'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { DataSource, Evidence, PatientChatMessage, PatientRecord } from '../../api/types';
import { formatDate, sourceLabel } from '../../utils/record';

const SUGGESTIONS = ['Summarise history', 'Current medications?', 'Any allergies?'];

// The chat route accepts up to 500 characters; under 3 is never a real question
const MIN_QUESTION = 3;
const MAX_QUESTION = 500;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function banner(patient: PatientRecord, source: DataSource): string[] {
  const records = patient.history.length;
  return [
    'clinical-brain v1.0 · analytical assistant',
    records
      ? `Loaded ${records} records for ${patient.displayName} (clinic records, doctor notes, AI scribe).`
      : `No previous records for ${patient.displayName} yet.`,
    'I summarise records and research. I do not diagnose or recommend treatment.',
    ...(source === 'demo'
      ? ['Demo mode: answers come from the stored record until the backend is connected.']
      : [])
  ];
}

function lastUserText(messages: PatientChatMessage[]): string {
  const last = messages.toReversed().find((m) => m.role === 'user');
  return last ? messageText(last) : '';
}

function messageText(message: PatientChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

/** Answers carry **bold** markdown; a terminal shows it as bright text, not asterisks. */
function withBold(text: string): ReactNode[] {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((piece, i) => (i % 2 ? <strong key={i}>{piece}</strong> : piece));
}

function Citations({ items }: { items: Evidence[] }) {
  return (
    <ul className='term-citations'>
      {items.map((c, i) => (
        <li key={`${c.snippet}-${i}`}>
          ↳ {sourceLabel(c.source)}
          {c.recorded_on && ` · ${formatDate(c.recorded_on)}`} — {c.snippet}
        </li>
      ))}
    </ul>
  );
}

interface PatientTerminalProps {
  patient: PatientRecord;
  source: DataSource;
  className?: string;
}

export function PatientTerminal({ patient, source, className }: PatientTerminalProps) {
  const [input, setInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const inputId = `ai-question-${patient.id}`;

  const transport = useMemo(
    () =>
      new DefaultChatTransport<PatientChatMessage>({
        api: '/api/chat',
        // Each question is answered from the record on its own, like the orchestrator's /ask
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { patientId: patient.id, question: lastUserText(messages) }
        })
      }),
    [patient.id]
  );

  const { messages, sendMessage, status, error } = useChat<PatientChatMessage>({
    id: `patient-${patient.id}`,
    transport
  });

  const busy = status === 'submitted' || status === 'streaming';
  const intro = useMemo(() => banner(patient, source), [patient, source]);

  // Keep the newest line in view (the banner alone never needs scrolling)
  useEffect(() => {
    const log = logRef.current;
    if (log && (messages.length > 0 || error)) {
      log.scrollTo({
        top: log.scrollHeight,
        behavior: status === 'streaming' || prefersReducedMotion() ? 'auto' : 'smooth'
      });
    }
  }, [messages, status, error]);

  function ask(text: string) {
    const question = text.trim();
    if (question.length < MIN_QUESTION || busy) return;
    void sendMessage({ text: question });
    setInput('');
  }

  return (
    <section aria-label='AI assistant' className={cn('ai-terminal', className)}>
      <div className='terminal-titlebar'>
        <span className='terminal-dots' aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className='terminal-title'>
          <Icons.terminal className='size-3.5 shrink-0' aria-hidden /> clinical-brain —{' '}
          {patient.displayName}
        </span>
        <span className='terminal-mode'>{source === 'fastapi' ? 'local' : 'demo'}</span>
      </div>

      <div className='terminal-log' ref={logRef} role='log' aria-live='polite' aria-busy={busy}>
        {intro.map((line) => (
          <div key={line} className='term-line term-system'>
            {line}
          </div>
        ))}

        {messages.map((message) => {
          const text = messageText(message);
          if (message.role === 'user') {
            return (
              <div key={message.id} className='term-line term-question'>
                <span className='term-prompt'>doctor ❯</span>
                <span className='term-text'>{text}</span>
              </div>
            );
          }
          const refused = message.metadata?.refused;
          const citations = message.parts.find((part) => part.type === 'data-citations');
          const typing = status === 'streaming' && message.id === messages.at(-1)?.id;
          return (
            <div
              key={message.id}
              className={cn('term-line', refused ? 'term-refusal' : 'term-answer')}
            >
              <span className='term-prompt'>{refused ? 'guardrail ›' : 'brain ›'}</span>
              <span className='term-text'>
                {withBold(text)}
                {typing && <span className='term-cursor' aria-hidden />}
              </span>
              {!typing && citations && citations.data.items.length > 0 && (
                <Citations items={citations.data.items} />
              )}
            </div>
          );
        })}

        {status === 'submitted' && (
          <div className='term-line term-answer'>
            <span className='term-prompt'>brain ›</span>
            <span className='term-thinking' role='status' aria-label='Thinking'>
              <i />
              <i />
              <i />
            </span>
          </div>
        )}

        {error && (
          <div className='term-line term-error'>
            {error.message || 'The assistant is unavailable right now. Try again in a moment.'}
          </div>
        )}
      </div>

      <div className='terminal-suggestions'>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type='button'
            className='term-chip'
            onClick={() => ask(s)}
            disabled={busy}
          >
            {s}
          </button>
        ))}
      </div>

      <form
        className='terminal-prompt'
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <label htmlFor={inputId} className='term-caret'>
          <span aria-hidden>❯</span>
          <span className='sr-only'>Ask the AI assistant about this patient</span>
        </label>
        <input
          id={inputId}
          className='term-input'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='Ask about this patient’s records…'
          autoComplete='off'
          spellCheck={false}
          maxLength={MAX_QUESTION}
        />
        <button
          type='submit'
          className='term-send'
          disabled={busy || input.trim().length < MIN_QUESTION}
          aria-label='Send question'
        >
          <Icons.send className='size-4' />
        </button>
      </form>
    </section>
  );
}
