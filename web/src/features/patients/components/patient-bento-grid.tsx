'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useMemo } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { patientsQueryOptions } from '../api/queries';
import { PatientBentoCard, bentoSize } from './patient-bento-card';
import { PatientStats } from './patient-stats';

const SORTS = ['risk', 'queue'] as const;

export function PatientBentoGrid() {
  const { data } = useSuspenseQuery(patientsQueryOptions());
  const [query, setQuery] = useQueryState('q', { defaultValue: '', shallow: true });
  const [sort, setSort] = useQueryState(
    'sort',
    parseAsStringLiteral(SORTS).withDefault('risk').withOptions({ shallow: true })
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = data.patients.filter(
      (p) =>
        !q ||
        [p.displayName, p.reasonForVisit ?? '', p.summary, ...p.conditions].some((t) =>
          t.toLowerCase().includes(q)
        )
    );
    // The service returns risk order; queue order is by token
    return sort === 'queue'
      ? matches.toSorted((a, b) => (a.token ?? 999) - (b.token ?? 999))
      : matches;
  }, [data.patients, query, sort]);

  return (
    <div className='flex flex-col gap-5'>
      <PatientStats patients={data.patients} />

      <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div className='relative w-full sm:max-w-xs'>
          <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
          <Input
            value={query}
            onChange={(e) => void setQuery(e.target.value || null)}
            placeholder='Search name, condition, complaint…'
            aria-label='Search patients'
            className='h-9 pl-8'
          />
        </div>
        <ToggleGroup
          variant='outline'
          size='sm'
          spacing={0}
          value={[sort]}
          onValueChange={(v) => {
            const next = v[0] as (typeof SORTS)[number] | undefined;
            if (next) void setSort(next);
          }}
          aria-label='Sort patients'
        >
          <ToggleGroupItem value='risk' aria-label='Sort by risk'>
            <Icons.riskHigh className='size-3.5' /> Risk first
          </ToggleGroupItem>
          <ToggleGroupItem value='queue' aria-label='Sort by queue token'>
            <Icons.sort className='size-3.5' /> Queue order
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {visible.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Icons.search />
            </EmptyMedia>
            <EmptyTitle>No patients match “{query}”</EmptyTitle>
            <EmptyDescription>Search looks at names, conditions and today’s complaints.</EmptyDescription>
          </EmptyHeader>
          <Button variant='outline' size='sm' onClick={() => void setQuery(null)}>
            Clear search
          </Button>
        </Empty>
      ) : (
        <div className='bg-dot-grid -mx-2 rounded-3xl p-2'>
          <div className='grid grid-flow-dense auto-rows-[minmax(11rem,auto)] grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'>
            {visible.map((patient, i) => (
              <PatientBentoCard key={patient.id} patient={patient} size={bentoSize(patient)} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PatientBentoGridSkeleton() {
  const sizes = ['lg', 'lg', 'md', 'md', 'sm', 'sm', 'sm', 'sm'] as const;
  return (
    <div className='flex flex-col gap-5' role='status' aria-label='Loading patients'>
      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className='bg-muted h-24 animate-pulse rounded-2xl' />
        ))}
      </div>
      <div className='grid auto-rows-[11rem] grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'>
        {sizes.map((s, i) => (
          <div
            key={i}
            className={`bg-muted animate-pulse rounded-2xl ${s === 'lg' ? 'md:col-span-2 md:row-span-2' : s === 'md' ? 'md:col-span-2' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}
