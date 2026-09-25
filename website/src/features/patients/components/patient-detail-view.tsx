'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';
import { Icons, type Icon } from '@/components/icons';
import {
  AccordionSpring,
  AccordionSpringContent,
  AccordionSpringItem,
  AccordionSpringTrigger
} from '@/components/ui/accordion-spring';
import { AnimatedBackground } from '@/components/ui/animated-background';
import { BlurFade } from '@/components/ui/blur-fade';
import { BorderBeam } from '@/components/ui/border-beam';
import { GlowingEffect } from '@/components/ui/glowing-effect';
import { Timeline } from '@/components/ui/timeline';
import { cn } from '@/lib/utils';
import { patientByIdOptions } from '../api/queries';
import type { Fact, LabResult, Likelihood, PatientRecord, RiskItem } from '../api/types';
import { formatDate, initials, sourceLabel } from '../utils/record';
import { AllergyChip } from './allergy-chip';
import { PatientTerminal } from './chat/patient-terminal';
import { LikelihoodBadge, RISK_META, RiskBadge, RiskMeter, riskColorVar } from './risk-indicator';

const SEX_LABEL = { M: 'Male', F: 'Female', O: 'Other' } as const;

function SectionHeading({
  icon: IconComponent,
  title,
  caption
}: {
  icon: Icon;
  title: string;
  caption?: string;
}) {
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

function RiskEvidence({ risk }: { risk: RiskItem }) {
  return (
    <>
      <p className='text-[15px] leading-7 font-medium'>{risk.outcome}</p>
      <p className='text-foreground/80 mt-2 text-[15px] leading-7'>{risk.reasoning}</p>
      {risk.evidence.length > 0 && (
        <ul className='mt-4 flex flex-col gap-1.5'>
          {risk.evidence.map((e, i) => (
            <li
              key={`${e.snippet}-${i}`}
              className='text-muted-foreground flex gap-2 text-xs leading-relaxed'
            >
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
    </>
  );
}

/** One row per risk; the highest opens first. High-likelihood rows carry a slow beam round the edge. */
function RiskAccordion({ risks }: { risks: RiskItem[] }) {
  return (
    <AccordionSpring defaultValue={[risks[0].label]} className='gap-3'>
      {risks.map((risk, i) => (
        <BlurFade key={risk.label} inView delay={i * 0.08}>
          <AccordionSpringItem
            value={risk.label}
            style={riskColorVar(risk.likelihood)}
            className='bg-card relative rounded-2xl border'
          >
            <span
              aria-hidden
              className='absolute inset-y-3 left-0 w-1 rounded-r-full'
              style={{ background: 'var(--risk)' }}
            />
            {risk.likelihood === 'high' && (
              <BorderBeam
                size={120}
                duration={10}
                borderWidth={1.5}
                colorFrom='var(--risk-high)'
                colorTo='color-mix(in oklch, var(--risk-high) 35%, transparent)'
              />
            )}
            <AccordionSpringTrigger className='px-5 py-4 pl-6'>
              <span className='flex flex-col gap-2.5'>
                <span className='flex flex-wrap items-center gap-2'>
                  <span className='font-semibold tracking-tight'>{risk.label}</span>
                  <LikelihoodBadge likelihood={risk.likelihood} />
                </span>
                <span className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs'>
                  <RiskMeter level={risk.likelihood} className='w-24' />
                  {risk.timeframe && (
                    <span className='inline-flex items-center gap-1'>
                      <Icons.clock className='size-3.5' aria-hidden /> {risk.timeframe}
                    </span>
                  )}
                  <span>{risk.origin === 'rule_engine' ? 'Rule check' : 'AI-assisted'}</span>
                </span>
              </span>
            </AccordionSpringTrigger>
            <AccordionSpringContent className='border-t border-dashed px-6 pt-4 pb-5'>
              <RiskEvidence risk={risk} />
            </AccordionSpringContent>
          </AccordionSpringItem>
        </BlurFade>
      ))}
    </AccordionSpring>
  );
}

const LIKELIHOODS: Likelihood[] = ['high', 'moderate', 'low'];

/** The patient's overall level on the larger meter, with how many risks sit at each likelihood. */
function RiskOverview({ patient }: { patient: PatientRecord }) {
  const counts = LIKELIHOODS.map((l) => ({
    l,
    n: patient.risks.filter((r) => r.likelihood === l).length
  })).filter((c) => c.n > 0);
  return (
    <div
      style={riskColorVar(patient.risk.level)}
      className='bg-card mb-3 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:gap-6'
    >
      <div className='shrink-0'>
        <p className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>Overall</p>
        <p className='font-semibold tracking-tight'>{RISK_META[patient.risk.level].label}</p>
      </div>
      <RiskMeter level={patient.risk.level} size='md' className='sm:max-w-72' />
      <ul className='text-muted-foreground flex shrink-0 gap-3 text-xs sm:ml-auto'>
        {counts.map(({ l, n }) => (
          <li key={l} className='inline-flex items-center gap-1.5'>
            <span
              aria-hidden
              className='size-2 rounded-full'
              style={{ background: RISK_META[l].color }}
            />
            {n} {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecordGlow() {
  return <GlowingEffect spread={40} proximity={64} inactiveZone={0.01} borderWidth={2} />;
}

function FactList({
  title,
  icon: IconComponent,
  facts,
  empty
}: {
  title: string;
  icon: Icon;
  facts: Fact[];
  empty: string;
}) {
  return (
    <div className='bg-card relative rounded-2xl border p-4'>
      <RecordGlow />
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
    <div className='bg-card relative rounded-2xl border p-4'>
      <RecordGlow />
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
                    {i > 0 && (
                      <Icons.arrowRight
                        className='text-muted-foreground size-3'
                        aria-label='then'
                      />
                    )}
                    {l.value}
                    <span className='text-muted-foreground text-xs'>
                      ({formatDate(l.taken_on)})
                    </span>
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
        <BlurFade>
          <Link
            href='/patients'
            className='text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm transition-colors'
          >
            <Icons.arrowLeft className='size-4' /> All patients
          </Link>
        </BlurFade>
        <BlurFade delay={0.06} className='flex items-start gap-4'>
          <div
            aria-hidden
            className='text-foreground flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--risk)_14%,var(--card))] text-lg font-semibold ring-1 ring-[color-mix(in_oklch,var(--risk)_30%,transparent)]'
          >
            {initials(patient.displayName)}
          </div>
          <div className='min-w-0'>
            <h1 className='text-2xl font-semibold tracking-tight md:text-3xl'>
              {patient.displayName}
            </h1>
            <p className='text-muted-foreground mt-0.5 text-sm'>{meta.join(' · ')}</p>
          </div>
        </BlurFade>
        <BlurFade delay={0.12} className='flex flex-wrap gap-2'>
          <RiskBadge level={patient.risk.level} />
          <AllergyChip allergy={patient.allergy} />
          {patient.isNew && (
            <span className='text-foreground inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium'>
              <Icons.userPlus className='size-3.5' /> Registered today
            </span>
          )}
        </BlurFade>
        {patient.reasonForVisit && (
          <BlurFade
            delay={0.18}
            className='bg-muted/50 flex items-start gap-3 rounded-2xl border px-4 py-3'
          >
            <Icons.stethoscope className='text-muted-foreground mt-0.5 size-4 shrink-0' />
            <p className='text-sm'>
              <span className='text-muted-foreground'>Today’s visit: </span>
              <span className='font-medium'>{patient.reasonForVisit}</span>
            </p>
          </BlurFade>
        )}
      </header>

      <BlurFade inView delay={0.1}>
        <section>
          <SectionHeading
            icon={Icons.notes}
            title='Clinical overview'
            caption='Summarised from the stored record'
          />
          <div className='flex max-w-3xl flex-col gap-4'>
            {patient.overview.map((paragraph) => (
              <p key={paragraph.slice(0, 40)} className='text-foreground/90 text-[15px] leading-7'>
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      </BlurFade>

      <BlurFade inView delay={0.1}>
        <section>
          <SectionHeading
            icon={Icons.heartbeat}
            title='Potential risks'
            caption={
              patient.risks.length ? `${patient.risks.length} flagged, highest first` : undefined
            }
          />
          {patient.risks.length ? (
            <>
              <RiskOverview patient={patient} />
              <RiskAccordion risks={patient.risks} />
            </>
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
      </BlurFade>

      <BlurFade inView delay={0.1}>
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
      </BlurFade>

      <BlurFade inView delay={0.1}>
        <section>
          <SectionHeading
            icon={Icons.history}
            title='History'
            caption={
              patient.history.length ? `${patient.history.length} records, newest first` : undefined
            }
          />
          {patient.history.length ? (
            <Timeline
              data={patient.history.map((h, i) => ({
                id: `${h.recorded_on}-${i}`,
                title: formatDate(h.recorded_on),
                marker: (
                  <span
                    className={cn(
                      'bg-background size-3 rounded-full border-2',
                      h.source === 'doctor_notes'
                        ? 'border-foreground bg-foreground'
                        : 'border-muted-foreground/50'
                    )}
                  />
                ),
                content: (
                  <>
                    <p className='text-muted-foreground text-xs'>{sourceLabel(h.source)}</p>
                    <p className='text-foreground/90 mt-0.5 text-[15px] leading-7'>{h.text}</p>
                  </>
                )
              }))}
            />
          ) : (
            <p className='text-muted-foreground text-sm'>
              No previous records. The history builds from this visit once the doctor approves the
              note.
            </p>
          )}
        </section>
      </BlurFade>

      <p className='text-muted-foreground flex gap-2 border-t pt-4 text-xs leading-relaxed'>
        <Icons.shieldCheck className='size-4 shrink-0' aria-hidden />
        {patient.disclaimer}
      </p>
    </div>
  );
}

type Pane = 'record' | 'chat';

const PANES: { id: Pane; label: string; icon: Icon }[] = [
  { id: 'record', label: 'Record', icon: Icons.record },
  { id: 'chat', label: 'Ask AI', icon: Icons.sparkles }
];

export function PatientDetailView({ patientId }: { patientId: string }) {
  const { data } = useSuspenseQuery(patientByIdOptions(patientId));
  const [pane, setPane] = useState<Pane>('record');
  const patient = data.patient;

  if (!patient) {
    return <p className='text-muted-foreground text-sm'>This patient could not be found.</p>;
  }

  return (
    <MotionConfig reducedMotion='user'>
      <div className='flex flex-1 flex-col gap-4'>
        {/* Small screens: one column at a time */}
        <div
          role='group'
          aria-label='Show record or assistant'
          className='bg-muted flex self-start rounded-lg p-0.5 lg:hidden'
        >
          <AnimatedBackground
            value={pane}
            onValueChange={(v) => setPane(v as Pane)}
            className='bg-background rounded-md shadow-sm'
            transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
          >
            {PANES.map(({ id, label, icon: PaneIcon }) => (
              <button
                key={id}
                type='button'
                data-id={id}
                aria-pressed={pane === id}
                className='text-muted-foreground data-[checked=true]:text-foreground h-7 rounded-md px-3 text-sm font-medium transition-colors'
              >
                <PaneIcon className='size-3.5' aria-hidden /> {label}
              </button>
            ))}
          </AnimatedBackground>
        </div>

        <div className='grid flex-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] xl:grid-cols-[minmax(0,1fr)_460px]'>
          <div className={cn('min-w-0', pane !== 'record' && 'hidden lg:block')}>
            <PatientNarrative patient={patient} />
          </div>
          <PatientTerminal
            patient={patient}
            source={data.source}
            className={cn(
              'h-[calc(100dvh-var(--header-height)-7rem)] lg:sticky lg:top-[calc(var(--header-height)+1.5rem)] lg:h-[calc(100dvh-var(--header-height)-3rem)]',
              pane !== 'chat' && 'hidden lg:flex'
            )}
          />
        </div>
      </div>
    </MotionConfig>
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
