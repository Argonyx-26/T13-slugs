import { isLumenApiConfigured } from '../server/lumen-api';

/** Tells the doctor whether they are looking at demo patients or the clinic's records. */
export function DataSourceBadge() {
  const live = isLumenApiConfigured();
  return (
    <span className='text-muted-foreground inline-flex h-7 items-center gap-2 rounded-full border px-3 text-xs font-medium'>
      <span
        className={
          live ? 'bg-risk-low size-2 rounded-full' : 'bg-muted-foreground/50 size-2 rounded-full'
        }
      />
      {live ? 'Clinic server' : 'Demo patients'}
    </span>
  );
}
