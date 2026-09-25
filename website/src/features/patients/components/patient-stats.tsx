import { Icons, type Icon } from '@/components/icons';
import type { PatientCard } from '../api/types';

export interface Stat {
  label: string;
  value: number;
  detail: string;
  icon: Icon;
  color: string;
}

export function StatGrid({ caption, stats }: { caption: string; stats: Stat[] }) {
  return (
    <section className='flex flex-col gap-2' aria-label={caption}>
      <h2 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>{caption}</h2>
      <dl className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        {stats.map((s) => (
          <div key={s.label} className='bg-card flex flex-col gap-1 rounded-2xl border px-4 py-3.5'>
            <dt className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
              <s.icon className='size-3.5 shrink-0' style={{ color: s.color }} aria-hidden />
              {s.label}
            </dt>
            <dd className='text-3xl font-semibold tracking-tight tabular-nums'>{s.value}</dd>
            <dd className='text-muted-foreground truncate text-xs'>{s.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function PatientStats({ patients }: { patients: PatientCard[] }) {
  const waiting = patients.filter((p) => p.visitStatus === 'waiting').length;
  const seen = patients.filter((p) => p.visitStatus === 'seen').length;
  const count = (level: PatientCard['risk']['level']) => patients.filter((p) => p.risk.level === level).length;
  const allergyChecks = patients.filter(
    (p) => p.allergy.state === 'conflict' || p.allergy.state === 'unknown'
  ).length;

  const stats: Stat[] = [
    {
      label: 'Waiting',
      value: waiting,
      detail: `${seen} seen · ${patients.length} in today's list`,
      icon: Icons.teams,
      color: 'var(--muted-foreground)'
    },
    {
      label: 'High risk',
      value: count('high'),
      detail: 'Flagged from the record',
      icon: Icons.riskHigh,
      color: 'var(--risk-high)'
    },
    {
      label: 'Moderate risk',
      value: count('moderate'),
      detail: 'Flagged from the record',
      icon: Icons.riskModerate,
      color: 'var(--risk-moderate)'
    },
    {
      label: 'Allergy status to check',
      value: allergyChecks,
      detail: 'Records disagree or never recorded',
      icon: Icons.riskUnknown,
      color: 'var(--risk-unknown)'
    }
  ];

  return <StatGrid caption="Today's list" stats={stats} />;
}
