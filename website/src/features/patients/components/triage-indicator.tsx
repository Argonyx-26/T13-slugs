import type * as React from 'react';
import { Icons, type Icon } from '@/components/icons';
import { EnergyMeter } from '@/components/ui/energy-meter';
import { cn } from '@/lib/utils';
import type { PatientCard, TriageLevel } from '../api/types';

// ============================================================
// Triage: how urgent the patient is *now*, from the vital signs and complaint taken
// at check-in (backend/rag/risk.py). Separate from the risk indicator, which shows
// what may happen later. Four levels, the same as the backend.
// ============================================================

interface TriageMeta {
  label: string;
  /** What the level means for the queue */
  action: string;
  icon: Icon;
  color: string;
  steps: number;
}

export const TRIAGE_META: Record<TriageLevel, TriageMeta> = {
  critical: {
    label: 'Critical',
    action: 'Emergency now',
    icon: Icons.triageCritical,
    color: 'var(--risk-critical)',
    steps: 4
  },
  high: {
    label: 'High',
    action: 'See next',
    icon: Icons.riskHigh,
    color: 'var(--risk-high)',
    steps: 3
  },
  medium: {
    label: 'Medium',
    action: 'See soon',
    icon: Icons.riskModerate,
    color: 'var(--risk-moderate)',
    steps: 2
  },
  low: {
    label: 'Low',
    action: 'Routine',
    icon: Icons.riskLow,
    color: 'var(--risk-low)',
    steps: 1
  }
};

/** Critical and high change who is seen first; they drive a card's accent colour. */
export function isUrgent(triage: PatientCard['triage']): boolean {
  return triage?.level === 'critical' || triage?.level === 'high';
}

export function triageColorVar(level: TriageLevel): React.CSSProperties {
  return { '--risk': TRIAGE_META[level].color } as React.CSSProperties;
}

/**
 * "Critical · NEWS2 11". Critical is a filled pill so it can't be missed in a grid; the
 * others match the risk badge. The text always says the level: colour is never the only cue.
 */
export function TriageBadge({
  level,
  news2,
  className
}: {
  level: TriageLevel;
  news2?: number | null;
  className?: string;
}) {
  const meta = TRIAGE_META[level];
  const IconComponent = meta.icon;
  const critical = level === 'critical';
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap',
        critical
          ? 'border-transparent text-white shadow-sm'
          : 'bg-background/70 text-foreground backdrop-blur-sm',
        className
      )}
      style={critical ? { background: meta.color } : undefined}
    >
      <IconComponent
        className={cn('size-3.5', critical && 'motion-safe:animate-pulse')}
        style={critical ? undefined : { color: meta.color }}
        aria-hidden
      />
      Triage: {meta.label}
      {news2 != null && (
        <span className={critical ? 'text-white/85' : 'text-muted-foreground'}>
          · NEWS2 {news2}
        </span>
      )}
    </span>
  );
}

/** Four-step meter: low, medium, high, critical. */
export function TriageMeter({
  level,
  size = 'sm',
  className
}: {
  level: TriageLevel;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const meta = TRIAGE_META[level];
  return (
    <EnergyMeter
      value={meta.steps}
      segments={4}
      color={meta.color}
      size={size}
      label={`Triage ${meta.label}: ${meta.steps} of 4`}
      className={className}
    />
  );
}
