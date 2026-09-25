'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Icons, type Icon } from '@/components/icons';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { patientByIdOptions } from '../api/queries';
import type { Fact, LabResult, PatientRecord, RiskItem } from '../api/types';
import { formatDate, initials, sourceLabel } from '../utils/record';
import { AllergyChip } from './allergy-chip';
import { PatientChat } from './chat/patient-chat';
import { LikelihoodBadge, RISK_META, RiskBadge, riskColorVar } from './risk-indicator';

const SEX_LABEL = { M: 'Male', F: 'Female', O: 'Other' } as const;

function SectionHeading({ icon: IconComponent, title, caption }: { icon: Icon; title: string; caption?: string }) {
  return (
    <div className='mb-4 flex items-end justify-between gap-3 border-b pb-2'>
      <h2 className='flex items-center gap-2 text-base font-semibold tracking-tight'>
        <IconComponent className='text-muted-foreground size-4' aria-hidden />
        {title}
      </h2>
      {caption && <span className='text-muted-foreground text-xs'>{caption}</span>}
    </div>
  );
}

function RiskArticle({ risk }: { risk: RiskItem }) {
  return (
    <article
      style={riskColorVar(risk.likelihood)}
      className='bg-card relative overflow-hidden rounded-2xl border p-5 pl-6'
    >
      <span aria-hidden className='absolute inset-y-0 left-0 w-1' style={{ background: 'var(--risk)' }} />
      <div className='flex flex-wrap items-center gap-2'>
        <h3 className='font-semibold tracking-tight'>{risk.label}</h3>
        <LikelihoodBadge likelihood={risk.likelihood} />
        {risk.timeframe && (
          <span className='text-muted-foreground inline-flex items-center gap-1 text-xs'>
            <Icons.clock className='size-3.5' /> {risk.timeframe}
          </span>
        )}
        <span className='text-muted-foreground ml-auto text-xs'>
          {risk.origin === 'rule_engine' ? 'Rule check' : 'AI-assisted'}
        </span>
      </div>
      <p className='mt-3 text-[15px] leading-7 font-medium'>{risk.outcome}</p>
      <p className='text-foreground/80 mt-2 text-[15px] leading-7'>{risk.reasoning}</p>
      {risk.evidence.length > 0 && (
        <ul className='mt-4 flex flex-col gap-1.5'>
          {risk.evidence.map((e, i) => (
            <li key={`${e.snippet}-${i}`} className='text-muted-foreground flex gap-2 text-xs leading-relaxed'>
              <Icons.record className='mt-0.5 size-3.5 shrink-0' aria-hidden />
              <span>
                <span className='text-foreground/80 font-medium'>
                  {sourceLabel(e.source)}
                  {e.recorded_on ? `, ${formatDate(e.recorded_on)}` : ''}:
                </span>{' '}
                “{e.snippet}”
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function FactList({ title, icon: IconComponent, facts, empty }: { title: string; icon: Icon; facts: Fact[]; empty: string }) {
  return (
    <div className='bg-card rounded-2xl border p-4'>
      <h3 className='text-muted-foreground mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase'>
        <IconComponent className='size-3.5' aria-hidden /> {title}
      </h3>
      {facts.length ? (
        <ul className='flex flex-col gap-2.5'>
          {facts.map((f) => (
            <li key={`${f.value}-${f.recorded_on}`} className='text-sm'>
              <p className='font-medium'>{f.value}</p>
              {f.note && <p className='text-foreground/80'>{f.note}</p>}
              <p className='text-muted-foreground text-xs'>
                {sourceLabel(f.source)} · {formatDate(f.recorded_on)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className='text-muted-foreground text-sm'>{empty}</p>
      )}
    </div>
  );
}

function LabList({ labs }: { labs: LabResult[] }) {
  const byName = new Map<string, LabResult[]>();
  for (const l of labs.toSorted((a, b) => a.taken_on.localeCompare(b.taken_on))) {
    byName.set(l.name, [...(byName.get(l.name) ?? []), l]);
  }
  return (
    <div className='bg-card rounded-2xl border p-4'>
      <h3 className='text-muted-foreground mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase'>
        <Icons.lab className='size-3.5' aria-hidden /> Lab results
      </h3>
      {byName.size ? (
        <ul className='flex flex-col gap-2.5'>
          {[...byName.entries()].map(([name, series]) => (
            <li key={name} className='text-sm'>
              <p className='font-medium'>{name}</p>
              <p className='text-foreground/80 flex flex-wrap items-center gap-x-1.5 tabular-nums'>
                {series.map((l, i) => (
                  <span key={l.taken_on} className='inline-flex items-center gap-1.5'>
                    {i > 0 && <Icons.arrowRight className='text-muted-foreground size-3' aria-label='then' />}
                    {l.value}
                    <span className='text-muted-foreground text-xs'>({formatDate(l.taken_on)})</span>
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className='text-muted-foreground text-sm'>No lab results on record.</p>
      )}
    </div>
  );
}

function PatientNarrative({ patient }: { patient: PatientRecord }) {
  const meta = [
    patient.age != null ? `${patient.age} years` : null,
    patient.sex ? SEX_LABEL[patient.sex] : null,
    patient.token != null ? `Token ${patient.token}` : null,
    patient.visitStatus ? (patient.visitStatus === 'waiting' ? 'Waiting' : 'Seen today') : null
  ].filter(Boolean);

  return (
    <div className='flex flex-col gap-10 pb-8'>
      <header className='flex flex-col gap-4' style={riskColorVar(patient.risk.level)}>
        <Link
          href='/patients'
          className='text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm transition-colors'
        >
          <Icons.arrowLeft className='size-4' /> All patients
        </Link>
        <div className='flex items-start gap-4'>
          <div
            aria-hidden
            className='text-foreground flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--risk)_14%,var(--card))] text-lg font-semibold ring-1 ring-[color-mix(in_oklch,var(--risk)_30%,transparent)]'
          >
            {initials(patient.displayName)}
          </div>
          <div className='min-w-0'>
            <h1 className='text-2xl font-semibold tracking-tight md:text-3xl'>{patient.displayName}</h1>
            <p className='text-muted-foreground mt-0.5 text-sm'>{meta.join(' · ')}</p>
          </div>
        </div>
        <div className='flex flex-wrap gap-2'>
          <RiskBadge level={patient.risk.level} />
          <AllergyChip allergy={patient.allergy} />
          {patient.isNew && (
            <span className='text-foreground inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium'>
              <Icons.userPlus className='size-3.5' /> Registered today
            </span>
          )}
        </div>
        {patient.reasonForVisit && (
          <div className='bg-muted/50 flex items-start gap-3 rounded-2xl border px-4 py-3'>
            <Icons.stethoscope className='text-muted-foreground mt-0.5 size-4 shrink-0' />
            <p className='text-sm'>
              <span className='text-muted-foreground'>Today’s visit: </span>
              <span className='font-medium'>{patient.reasonForVisit}</span>
            </p>
          </div>
        )}
      </header>

      <section>
        <SectionHeading icon={Icons.notes} title='Clinical overview' caption='Summarised from the stored record' />
        <div className='flex max-w-3xl flex-col gap-4'>
          {patient.overview.map((paragraph) => (
            <p key={paragraph.slice(0, 40)} className='text-foreground/90 text-[15px] leading-7'>
              {paragraph}
            </p>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading
          icon={Icons.heartbeat}
          title='Potential risks'
          caption={patient.risks.length ? `${patient.risks.length} flagged, highest first` : undefined}
        />
        {patient.risks.length ? (
          <div className='flex flex-col gap-3'>
            {patient.risks.map((r) => (
              <RiskArticle key={r.label} risk={r} />
            ))}
          </div>
        ) : (
          <div className='text-muted-foreground flex items-center gap-2 rounded-2xl border border-dashed px-4 py-5 text-sm'>
            {(() => {
              const IconComponent = RISK_META[patient.risk.level].icon;
              return (
                <IconComponent
                  className='size-4 shrink-0'
                  style={{ color: RISK_META[patient.risk.level].color }}
                  aria-hidden
                />
              );
            })()}
            {patient.isNew
              ? 'Nothing to assess yet: there are no previous records for this patient.'
              : 'No risks have been flagged from this patient’s record.'}
          </div>
        )}
      </section>

      <section>
        <SectionHeading icon={Icons.record} title='On record' />
        <div className='grid gap-3 md:grid-cols-2'>
          <FactList
            title='Allergies'
            icon={Icons.riskHigh}
            facts={patient.profile.allergies}
            empty='Not recorded. Allergy status is unknown, not “none”.'
          />
          <FactList
            title='Current medicines'
            icon={Icons.pill}
            facts={patient.profile.active_medications}
            empty='No regular medicines on record.'
          />
          <FactList
            title='Long-term conditions'
            icon={Icons.activity}
            facts={patient.profile.conditions}
            empty='No long-term conditions on record.'
          />
          <LabList labs={patient.profile.labs} />
        </div>
      </section>

      <section>
        <SectionHeading
          icon={Icons.history}
          title='History'
          caption={patient.history.length ? `${patient.history.length} records, newest first` : undefined}
        />
        {patient.history.length ? (
          <ol className='relative flex flex-col gap-5 border-l pl-6'>
            {patient.history.map((h, i) => (
              <li key={`${h.recorded_on}-${i}`} className='relative'>
                <span
                  aria-hidden
                  className={cn(
                    'bg-background absolute top-1.5 -left-[29px] size-2.5 rounded-full border-2',
                    h.source === 'doctor_notes' ? 'border-foreground' : 'border-muted-foreground/50'
                  )}
                />
                <p className='text-muted-foreground text-xs'>
                  {formatDate(h.recorded_on)} · {sourceLabel(h.source)}
                </p>
                <p className='text-foreground/90 mt-0.5 text-[15px] leading-7'>{h.text}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className='text-muted-foreground text-sm'>
            No previous records. The history builds from this visit once the doctor approves the note.
          </p>
        )}
      </section>

      <p className='text-muted-foreground flex gap-2 border-t pt-4 text-xs leading-relaxed'>
        <Icons.shieldCheck className='size-4 shrink-0' aria-hidden />
        {patient.disclaimer}
      </p>
    </div>
  );
}

export function PatientDetailView({ patientId }: { patientId: string }) {
  const { data } = useSuspenseQuery(patientByIdOptions(patientId));
  const [pane, setPane] = useState<'record' | 'chat'>('record');
  const patient = data.patient;

  if (!patient) {
    return <p className='text-muted-foreground text-sm'>This patient could not be found.</p>;
  }

  return (
    <div className='flex flex-1 flex-col gap-4'>
      {/* Small screens: one column at a time */}
      <ToggleGroup
        variant='outline'
        size='sm'
        spacing={0}
        value={[pane]}
        onValueChange={(v) => v[0] && setPane(v[0] as 'record' | 'chat')}
        className='self-start lg:hidden'
        aria-label='Show record or assistant'
      >
        <ToggleGroupItem value='record'>
          <Icons.record className='size-3.5' /> Record
        </ToggleGroupItem>
        <ToggleGroupItem value='chat'>
          <Icons.sparkles className='size-3.5' /> Ask AI
        </ToggleGroupItem>
      </ToggleGroup>

      <div className='grid flex-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] xl:grid-cols-[minmax(0,1fr)_460px]'>
        <div className={cn('min-w-0', pane !== 'record' && 'hidden lg:block')}>
          <PatientNarrative patient={patient} />
        </div>
        <PatientChat
          patient={patient}
          source={data.source}
          className={cn(
            'h-[calc(100dvh-var(--header-height)-7rem)] lg:sticky lg:top-[calc(var(--header-height)+1.5rem)] lg:h-[calc(100dvh-var(--header-height)-3rem)]',
            pane !== 'chat' && 'hidden lg:flex'
          )}
        />
      </div>
    </div>
  );
}

export function PatientDetailSkeleton() {
  return (
    <div
      className='grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] xl:grid-cols-[minmax(0,1fr)_460px]'
      role='status'
      aria-label='Loading patient'
    >
      <div className='flex flex-col gap-4'>
        <div className='bg-muted h-6 w-28 animate-pulse rounded' />
        <div className='flex items-center gap-4'>
          <div className='bg-muted size-14 animate-pulse rounded-2xl' />
          <div className='bg-muted h-8 w-48 animate-pulse rounded' />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className='bg-muted h-24 animate-pulse rounded-2xl' />
        ))}
      </div>
      <div className='bg-muted hidden h-[70vh] animate-pulse rounded-2xl lg:block' />
    </div>
  );
}
