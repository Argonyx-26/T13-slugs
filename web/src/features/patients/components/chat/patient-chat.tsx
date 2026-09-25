'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { type CSSProperties, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import { Message, MessageAvatar, MessageContent } from '@/components/ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller';
import { cn } from '@/lib/utils';
import type { DataSource, Evidence, PatientChatMessage, PatientRecord } from '../../api/types';
import { formatDate, sourceLabel } from '../../utils/record';
import { ChatMarkdown } from './chat-markdown';

interface Suggestion {
  title: string;
  detail: string;
  prompt: string;
}

/** Record-grounded starters for this patient. Worded to stay clear of the opinion/diagnosis refusal rule. */
function suggestionsFor(p: PatientRecord): Suggestion[] {
  const first = p.displayName.split(' ')[0];
  const out: Suggestion[] = [];
  if (p.risks.length)
    out.push({
      title: 'Explain the flagged risks',
      detail: 'with the evidence behind each',
      prompt: `What risks are flagged for ${first}, and what evidence are they based on?`
    });
  out.push({
    title: 'Allergies on record',
    detail: 'and whether the records agree',
    prompt: `What allergies are on record for ${first}, and do the records agree?`
  });
  const lab = p.profile.labs.at(-1);
  if (lab)
    out.push({
      title: `${lab.name} results over time`,
      detail: 'oldest to newest',
      prompt: `Show ${first}'s ${lab.name} results over time.`
    });
  if (p.profile.active_medications.length)
    out.push({
      title: 'Current medicines',
      detail: 'doses and when they started',
      prompt: `Which medicines is ${first} taking, and since when?`
    });
  out.push({
    title: 'Summarise the history',
    detail: 'most recent records first',
    prompt: `Summarise ${first}'s history and most recent records.`
  });
  return out.slice(0, 4);
}

function lastUserText(messages: PatientChatMessage[]): string {
  const last = messages.toReversed().find((m) => m.role === 'user');
  return (
    last?.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n') ?? ''
  );
}

function messageText(message: PatientChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function Citations({ items }: { items: Evidence[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className='flex flex-col gap-2'>
      <button
        type='button'
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className='text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs font-medium transition-colors'
      >
        <Icons.record className='size-3.5' />
        {items.length} {items.length === 1 ? 'source' : 'sources'} from the record
        <Icons.chevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className='flex flex-col gap-1.5'>
          {items.map((c, i) => (
            <li key={`${c.snippet}-${i}`} className='bg-muted/50 rounded-lg border px-2.5 py-1.5 text-xs'>
              <span className='text-muted-foreground'>
                {sourceLabel(c.source)}
                {c.recorded_on ? ` · ${formatDate(c.recorded_on)}` : ''}
              </span>
              <p className='text-foreground/90 mt-0.5 leading-snug'>{c.snippet}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant='ghost'
      size='icon-xs'
      aria-label={copied ? 'Copied' : 'Copy answer'}
      className='text-muted-foreground'
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error('Could not copy to the clipboard');
        }
      }}
    >
      {copied ? <Icons.check /> : <Icons.copy />}
    </Button>
  );
}

function AssistantAvatar() {
  return (
    <MessageAvatar className='bg-background text-foreground ring-border size-8 self-start ring-1'>
      <Icons.sparkles className='size-4' />
    </MessageAvatar>
  );
}

interface PatientChatProps {
  patient: PatientRecord;
  source: DataSource;
  className?: string;
}

export function PatientChat({ patient, source, className }: PatientChatProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const first = patient.displayName.split(' ')[0];

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

  const { messages, sendMessage, status, stop, error, regenerate, setMessages, clearError } =
    useChat<PatientChatMessage>({ id: `patient-${patient.id}`, transport });

  const busy = status === 'submitted' || status === 'streaming';
  const suggestions = useMemo(() => suggestionsFor(patient), [patient]);

  function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    void sendMessage({ text: question });
    setInput('');
    textareaRef.current?.focus();
  }

  return (
    <section
      aria-label={`Ask about ${patient.displayName}`}
      className={cn('bg-card flex min-h-0 flex-col overflow-hidden rounded-2xl border shadow-xs', className)}
    >
      <header className='flex shrink-0 items-center gap-2.5 border-b px-4 py-3'>
        <div className='bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg'>
          <Icons.sparkles className='size-4' />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='text-sm font-semibold'>Clinical assistant</p>
          <p className='text-muted-foreground truncate text-xs'>
            {source === 'fastapi' ? 'Local model on the clinic server' : 'Demo mode · answers from the stored record'}
          </p>
        </div>
        <Button
          variant='ghost'
          size='sm'
          disabled={busy || messages.length === 0}
          onClick={() => {
            setMessages([]);
            clearError();
          }}
        >
          <Icons.add /> New chat
        </Button>
      </header>

      <MessageScrollerProvider defaultScrollPosition='end' scrollPreviousItemPeek={64}>
        <MessageScroller className='min-h-0 flex-1'>
          <MessageScrollerViewport>
            <MessageScrollerContent className='px-4 py-5'>
              {messages.length === 0 && (
                <div className='flex flex-1 flex-col justify-end gap-6'>
                  <div className='animate-bento-in flex flex-col gap-1.5'>
                    <p className='text-2xl font-semibold tracking-tight'>Ask about {first}</p>
                    <p className='text-muted-foreground text-sm leading-relaxed'>
                      I answer from {first}’s stored record: allergies, medicines, results, past visits and the
                      risks flagged from them. I don’t give diagnoses or treatment advice.
                    </p>
                  </div>
                  <div className='grid gap-2 sm:grid-cols-2'>
                    {suggestions.map((s, i) => (
                      <button
                        key={s.title}
                        type='button'
                        onClick={() => ask(s.prompt)}
                        style={{ '--i': i + 1 } as CSSProperties}
                        className='animate-bento-in hover:bg-muted focus-visible:ring-ring/50 flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-3'
                      >
                        <span className='font-medium'>{s.title}</span>
                        <span className='text-muted-foreground text-xs'>{s.detail}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message) => {
                if (message.role === 'user') {
                  return (
                    <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor>
                      <Message align='end'>
                        <MessageContent>
                          <Bubble variant='default' align='end'>
                            <BubbleContent className='whitespace-pre-wrap'>{messageText(message)}</BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  );
                }
                const text = messageText(message);
                const citations = message.parts.find((part) => part.type === 'data-citations');
                const refused = message.metadata?.refused;
                const streamingThis = status === 'streaming' && message.id === messages.at(-1)?.id;
                return (
                  <MessageScrollerItem key={message.id} messageId={message.id}>
                    <Message align='start' className='group/answer'>
                      <AssistantAvatar />
                      <MessageContent>
                        {refused ? (
                          <Bubble variant='outline' className='max-w-full'>
                            <BubbleContent className='flex gap-2'>
                              <Icons.shieldCheck className='text-muted-foreground mt-0.5 size-4 shrink-0' />
                              <span>
                                {text}
                                <span className='text-muted-foreground mt-1 block text-xs'>
                                  Try asking what the record says, for example about allergies, results or the
                                  flagged risks.
                                </span>
                              </span>
                            </BubbleContent>
                          </Bubble>
                        ) : (
                          <ChatMarkdown text={text} />
                        )}
                        {citations && !streamingThis && <Citations items={citations.data.items} />}
                        {!streamingThis && text && (
                          <div className='-ml-1 flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover/answer:opacity-100 md:focus-within:opacity-100'>
                            <CopyButton text={text} />
                          </div>
                        )}
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              })}

              {status === 'submitted' && (
                <MessageScrollerItem messageId='pending'>
                  <Message align='start'>
                    <AssistantAvatar />
                    <MessageContent>
                      <Marker className='min-h-8'>
                        <MarkerIcon>
                          <Icons.record />
                        </MarkerIcon>
                        <MarkerContent className='shimmer'>Searching {first}’s record…</MarkerContent>
                      </Marker>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              )}

              {error && (
                <MessageScrollerItem messageId='error'>
                  <Message align='start'>
                    <AssistantAvatar />
                    <MessageContent>
                      <Bubble variant='destructive'>
                        <BubbleContent>{error.message || 'The assistant is unavailable right now.'}</BubbleContent>
                      </Bubble>
                      <Button variant='outline' size='xs' className='w-fit' onClick={() => void regenerate()}>
                        <Icons.refresh /> Try again
                      </Button>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <form
        className='shrink-0 px-3 pb-3'
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <div className='bg-background focus-within:border-ring focus-within:ring-ring/50 relative rounded-2xl border shadow-xs transition-[border-color,box-shadow] focus-within:ring-3 dark:bg-input/30'>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={2}
            maxLength={500}
            placeholder={`Ask about ${first}’s record…`}
            aria-label='Question for the clinical assistant'
            className='placeholder:text-muted-foreground field-sizing-content block max-h-40 min-h-16 w-full resize-none bg-transparent px-3.5 pt-3 pb-11 text-sm outline-none'
          />
          <div className='absolute right-2 bottom-2 left-3 flex items-center justify-between gap-2'>
            <span className='text-muted-foreground hidden text-[11px] sm:inline'>
              Enter to send · Shift+Enter for a new line
            </span>
            {busy ? (
              <Button
                type='button'
                size='icon-sm'
                className='ml-auto rounded-full'
                aria-label='Stop'
                onClick={() => void stop()}
              >
                <Icons.stop className='size-3.5' />
              </Button>
            ) : (
              <Button
                type='submit'
                size='icon-sm'
                className='ml-auto rounded-full'
                aria-label='Send question'
                disabled={!input.trim()}
              >
                <Icons.arrowUp />
              </Button>
            )}
          </div>
        </div>
        <p className='text-muted-foreground mt-2 text-center text-[11px]'>
          Answers come only from stored records and can be incomplete. Check before acting on them.
        </p>
      </form>
    </section>
  );
}
