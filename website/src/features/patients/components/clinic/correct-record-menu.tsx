'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { patientKeys } from '../../api/queries';
import { retractClinicRecord } from '../../api/service';
import type { RetractReason } from '../../api/types';

export interface CorrectableRecord {
  record_id: string;
  /** What the record says, as shown to the doctor */
  label: string;
}

const REASON: Record<
  RetractReason,
  { item: string; title: string; confirm: string; body: string }
> = {
  entered_in_error: {
    item: 'Entered in error…',
    title: 'Mark as entered in error?',
    confirm: 'Mark entered in error',
    body: 'It leaves the safety checks and the AI’s context, but stays in the database for the audit trail. Add the correct record separately.'
  },
  stopped: {
    item: 'Medicine stopped…',
    title: 'Mark this medicine as stopped?',
    confirm: 'Mark stopped',
    body: 'It leaves the current medicines and the interaction checks, but stays in the history.'
  }
};

/**
 * The clinic tier's only correction (backend retract_clinic_record): a record is marked
 * 'entered in error', or a prescription 'stopped'. Nothing is edited or deleted.
 */
export function CorrectRecordMenu({
  patientId,
  records,
  prescription = false
}: {
  patientId: string;
  /** One record, or several (a lab test's results over time) to choose from */
  records: CorrectableRecord[];
  prescription?: boolean;
}) {
  const [pending, setPending] = useState<{
    record: CorrectableRecord;
    reason: RetractReason;
  } | null>(null);
  const [note, setNote] = useState('');
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: retractClinicRecord });

  const reasons: RetractReason[] = prescription
    ? ['stopped', 'entered_in_error']
    : ['entered_in_error'];

  async function confirm() {
    if (!pending) return;
    const result = await mutation.mutateAsync({
      patient_id: patientId,
      record_id: pending.record.record_id,
      reason: pending.reason,
      note: note.trim() || null
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: patientKeys.all });
    toast.success(
      pending.reason === 'stopped' ? 'Marked as stopped' : 'Marked as entered in error'
    );
    setPending(null);
    setNote('');
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant='ghost'
              size='icon-xs'
              className='text-muted-foreground -mr-1 shrink-0'
              aria-label={`Correct ${records.length === 1 ? records[0].label : 'a result'}`}
            />
          }
        >
          <Icons.dots />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='min-w-48'>
          {records.flatMap((record) =>
            reasons.map((reason) => (
              <DropdownMenuItem
                key={`${record.record_id}-${reason}`}
                onClick={() => setPending({ record, reason })}
              >
                {records.length > 1
                  ? `${record.label}: ${REASON[reason].item}`
                  : REASON[reason].item}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            setNote('');
          }
        }}
      >
        <AlertDialogContent>
          {pending && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{REASON[pending.reason].title}</AlertDialogTitle>
                <AlertDialogDescription>
                  <span className='text-foreground font-medium'>“{pending.record.label}”</span>.{' '}
                  {REASON[pending.reason].body}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className='flex flex-col gap-2'>
                <Label htmlFor='correction-note'>Reason (optional)</Label>
                <Textarea
                  id='correction-note'
                  value={note}
                  maxLength={300}
                  rows={2}
                  placeholder={
                    pending.reason === 'stopped'
                      ? 'e.g. Stopped for side effects'
                      : 'e.g. Wrong patient'
                  }
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  variant='destructive'
                  disabled={mutation.isPending}
                  onClick={() => void confirm()}
                >
                  {REASON[pending.reason].confirm}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
