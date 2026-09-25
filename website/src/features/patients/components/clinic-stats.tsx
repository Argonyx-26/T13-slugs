import { Icons } from '@/components/icons';
import type { ClinicStats as ClinicStatsData } from '../api/types';
import { StatGrid, type Stat } from './patient-stats';

const NEUTRAL = 'var(--muted-foreground)';

export function ClinicStats({ stats }: { stats: ClinicStatsData }) {
  const growth = Math.round(((stats.patientsThisMonth - stats.patientsLastMonth) / stats.patientsLastMonth) * 100);
  const waiting = stats.consultationsToday - stats.seenToday;
  const newShare = Math.round((stats.newPatientsThisMonth / stats.patientsThisMonth) * 100);

  const tiles: Stat[] = [
    {
      label: 'Patients this month',
      value: stats.patientsThisMonth,
      detail: `${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)}% vs ${stats.previousMonth}`,
      icon: Icons.teams,
      color: NEUTRAL
    },
    {
      label: 'Consultations today',
      value: stats.consultationsToday,
      detail: `${stats.seenToday} seen · ${waiting} waiting`,
      icon: Icons.calendar,
      color: NEUTRAL
    },
    {
      label: 'New patients',
      value: stats.newPatientsThisMonth,
      detail: `${newShare}% of this month’s patients`,
      icon: Icons.userPlus,
      color: NEUTRAL
    },
    {
      label: 'Notes awaiting review',
      value: stats.notesAwaitingReview,
      detail: 'AI scribe notes to confirm',
      icon: Icons.notes,
      color: NEUTRAL
    }
  ];

  return <StatGrid caption={`This month · ${stats.month}`} stats={tiles} />;
}
