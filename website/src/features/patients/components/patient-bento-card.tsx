'use client';

import Link from 'next/link';
import type * as React from 'react';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { PatientCard } from '../api/types';
import { formatDate, initials } from '../utils/record';
import { AllergyChip } from './allergy-chip';
import { RISK_META, RiskBadge, RiskMeter, riskColorVar } from './risk-indicator';

export type BentoSize = 'lg' | 'md' | 'sm';

/** High risk gets a 2×2 tile, moderate a wide tile, everything else one cell. */
export function bentoSize(patient: PatientCard): BentoSize {
  if (patient.risk.level === 'high') return 'lg';
  if (patient.risk.level === 'moderate') return 'md';
  return 'sm';
}

const SPAN: Record<BentoSize, string> = {
  lg: 'md:col-span-2 md:row-span-2',
  md: 'md:col-span-2',
  sm: ''
};

const SEX_LABEL = { M: 'Male', F: 'Female', O: 'Other' } as const;

interface PatientBentoCardProps {
  patient: PatientCard;
  size: BentoSize;
  index: number;
}

/** Spotlight: track the pointer in CSS variables, no re-render */
function handlePointerMove(e: React.PointerEvent<HTMLAnchorElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
}

export function PatientBentoCard({ patient, size, index }: PatientBentoCardProps) {
  const meta = [
    patient.age != null ? `${patient.age}` : null,
    patient.sex ? SEX_LABEL[patient.sex] : null,
    patient.token != null ? `Token ${patient.token}` : null
  ].filter(Boolean);

  const summaryLines =
    size === 'lg' ? 'line-clamp-4' : size === 'md' ? 'line-clamp-2' : 'line-clamp-3';

  return (
    <Link
      href={`/patients/${patient.id}`}
      onPointerMove={handlePointerMove}
      aria-label={`${patient.displayName}, ${patient.risk.level === 'unknown' ? 'risk not assessed' : `${patient.risk.level} risk`}. Open record`}
      style={{ ...riskColorVar(patient.risk.level), '--i': index } as React.CSSProperties}
      className={cn(
        'group/card animate-bento-in bg-card text-card-foreground relative isolate flex min-h-44 flex-col gap-4 overflow-hidden rounded-2xl border p-5 shadow-xs outline-none',
        'transition-[translate,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:shadow-lg',
        'hover:border-[color-mix(in_oklch,var(--risk)_35%,var(--border))] focus-visible:ring-ring/50 focus-visible:ring-3',
        SPAN[size]
      )}
    >
      {/* Pointer spotlight, tinted by the risk colour */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-300 group-hover/card:opacity-100'
        style={{
          background:
            'radial-gradient(420px circle at var(--mx, 50%) var(--my, 0%), color-mix(in oklch, var(--risk) 13%, transparent), transparent 65%)'
        }}
      />
      {/* Corner glow on the larger tiles */}
      {size !== 'sm' && (
        <div
          aria-hidden
          className='pointer-events-none absolute -top-28 -right-28 -z-10 size-64 rounded-full opacity-[0.14] blur-3xl'
          style={{ background: 'var(--risk)' }}
        />
      )}

      <header className='flex items-start gap-3'>
        <div
          aria-hidden
          className={cn(
            'text-foreground flex shrink-0 items-center justify-center rounded-xl font-semibold ring-1 ring-[color-mix(in_oklch,var(--risk)_30%,transparent)]',
            'bg-[color-mix(in_oklch,var(--risk)_14%,var(--card))]',
            size === 'lg' ? 'size-12 text-base' : 'size-10 text-sm'
          )}
        >
          {initials(patient.displayName)}
        </div>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <h3
              className={cn(
                'truncate font-semibold tracking-tight',
                size === 'lg' ? 'text-xl' : 'text-base'
              )}
            >
              {patient.displayName}
            </h3>
            {patient.isNew && (
              <span className='bg-primary text-primary-foreground rounded-full px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase'>
                New
              </span>
            )}
          </div>
          <p className='text-muted-foreground flex items-center gap-1.5 text-xs'>
            <span className='truncate'>{meta.join(' · ')}</span>
            {patient.visitStatus && (
              <span className='inline-flex shrink-0 items-center gap-1'>
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    patient.visitStatus === 'waiting' ? 'bg-foreground' : 'bg-muted-foreground/40'
                  )}
                />
                {patient.visitStatus === 'waiting' ? 'Waiting' : 'Seen'}
              </span>
            )}
          </p>
        </div>
        {size !== 'sm' && <RiskBadge level={patient.risk.level} />}
      </header>

      <div className='flex min-h-0 flex-1 flex-col gap-2'>
        {patient.reasonForVisit && (
          <p className='text-sm font-medium'>
            <span className='text-muted-foreground font-normal'>Today · </span>
            {patient.reasonForVisit}
          </p>
        )}
        <p className={cn('text-muted-foreground text-sm leading-relaxed', summaryLines)}>
          {patient.summary}
        </p>

        {size === 'lg' && patient.conditions.length > 0 && (
          <div className='mt-auto flex flex-wrap gap-1.5 pt-2'>
            {patient.conditions.map((c) => (
              <span
                key={c}
                className='bg-muted text-foreground/80 rounded-full px-2.5 py-0.5 text-xs'
              >
                {c}
              </span>
            ))}
          </div>
        )}
      </div>

      <footer className='flex flex-col gap-3'>
        <AllergyChip allergy={patient.allergy} hideNone className='self-start' />
        <div className='flex items-end justify-between gap-3'>
          <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
            <div className='flex items-baseline justify-between gap-2 text-xs'>
              <span className='truncate font-medium'>
                {size === 'sm' ? RISK_META[patient.risk.level].label : patient.risk.label}
              </span>
              {size !== 'sm' && patient.risk.count > 1 && (
                <span className='text-muted-foreground shrink-0'>
                  +{patient.risk.count - 1} more
                </span>
              )}
            </div>
            <RiskMeter level={patient.risk.level} className='max-w-56' />
            {size === 'sm' && (
              <span className='text-muted-foreground truncate text-xs'>{patient.risk.label}</span>
            )}
          </div>
          <span className='text-muted-foreground group-hover/card:text-foreground flex shrink-0 items-center gap-1 text-xs transition-colors'>
            {patient.lastRecordOn && size !== 'sm' && (
              <span className='hidden sm:inline'>
                Last record {formatDate(patient.lastRecordOn)}
              </span>
            )}
            <Icons.arrowRight className='size-4 transition-transform duration-300 group-hover/card:translate-x-0.5' />
          </span>
        </div>
      </footer>
    </Link>
  );
}
