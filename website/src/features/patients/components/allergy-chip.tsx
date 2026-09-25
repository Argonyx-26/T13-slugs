import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { PatientCard } from '../api/types';

/** Allergy status at a glance. "Unknown" is shown as its own state: it is never the same as "none". */
export function AllergyChip({
  allergy,
  hideNone = false,
  className
}: {
  allergy: PatientCard['allergy'];
  hideNone?: boolean;
  className?: string;
}) {
  if (allergy.state === 'none' && hideNone) return null;

  const config = {
    conflict: { icon: Icons.riskHigh, color: 'var(--risk-high)', text: allergy.label },
    present: { icon: Icons.riskHigh, color: 'var(--risk-high)', text: `Allergy: ${allergy.label}` },
    unknown: { icon: Icons.riskUnknown, color: 'var(--risk-unknown)', text: 'Allergy status unknown' },
    none: { icon: Icons.shieldCheck, color: 'var(--muted-foreground)', text: allergy.label }
  }[allergy.state];
  const IconComponent = config.icon;

  return (
    <span
      className={cn(
        'text-foreground inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
        allergy.state === 'none' && 'text-muted-foreground',
        className
      )}
    >
      <IconComponent className='size-3.5 shrink-0' style={{ color: config.color }} aria-hidden />
      <span className='truncate'>{config.text}</span>
    </span>
  );
}
