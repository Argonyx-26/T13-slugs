import type * as React from 'react';
import { Icons, type Icon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { Likelihood, RiskLevel } from '../api/types';

interface RiskMeta {
  label: string;
  likelihood: string;
  icon: Icon;
  /** The status colour, as a CSS value. Fixed across themes (see globals.css). */
  color: string;
  /** Filled steps on the three-step meter */
  steps: number;
}

export const RISK_META: Record<RiskLevel, RiskMeta> = {
  high: {
    label: 'High risk',
    likelihood: 'High likelihood',
    icon: Icons.riskHigh,
    color: 'var(--risk-high)',
    steps: 3
  },
  moderate: {
    label: 'Moderate risk',
    likelihood: 'Moderate likelihood',
    icon: Icons.riskModerate,
    color: 'var(--risk-moderate)',
    steps: 2
  },
  low: {
    label: 'Low risk',
    likelihood: 'Low likelihood',
    icon: Icons.riskLow,
    color: 'var(--risk-low)',
    steps: 1
  },
  unknown: {
    label: 'Not assessed',
    likelihood: 'Not assessed',
    icon: Icons.riskUnknown,
    color: 'var(--risk-unknown)',
    steps: 0
  }
};

/** CSS custom property carrying the level's colour, for glows and tints inside a card. */
export function riskColorVar(level: RiskLevel): React.CSSProperties {
  return { '--risk': RISK_META[level].color } as React.CSSProperties;
}

interface RiskBadgeProps {
  level: RiskLevel;
  /** Show "High likelihood" instead of "High risk" (for individual risk items) */
  asLikelihood?: boolean;
  className?: string;
}

/** Icon + text label; the text stays in foreground ink, only the icon carries the status colour. */
export function RiskBadge({ level, asLikelihood = false, className }: RiskBadgeProps) {
  const meta = RISK_META[level];
  const IconComponent = meta.icon;
  return (
    <span
      className={cn(
        'bg-background/70 text-foreground inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap backdrop-blur-sm',
        className
      )}
    >
      <IconComponent className='size-3.5' style={{ color: meta.color }} aria-hidden />
      {asLikelihood ? meta.likelihood : meta.label}
    </span>
  );
}

export function LikelihoodBadge({ likelihood, className }: { likelihood: Likelihood; className?: string }) {
  return <RiskBadge level={likelihood} asLikelihood className={className} />;
}

/** Three-step meter. Unfilled steps are a light tint of the same colour, so the track reads as one scale. */
export function RiskMeter({ level, className }: { level: RiskLevel; className?: string }) {
  const meta = RISK_META[level];
  return (
    <div
      role='img'
      aria-label={level === 'unknown' ? 'Risk not assessed' : `${meta.label}: ${meta.steps} of 3`}
      className={cn('flex w-full items-center gap-0.5', className)}
    >
      {[0, 1, 2].map((step) => (
        <span
          key={step}
          className={cn('h-1.5 flex-1 rounded-full', level === 'unknown' && 'bg-muted')}
          style={
            level === 'unknown'
              ? undefined
              : {
                  background:
                    step < meta.steps
                      ? meta.color
                      : `color-mix(in oklch, ${meta.color} 18%, transparent)`
                }
          }
        />
      ))}
    </div>
  );
}
