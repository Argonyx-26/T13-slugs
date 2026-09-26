'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { useAppForm } from '@/lib/form';
import { patientKeys } from '../../api/queries';
import { addClinicRecord } from '../../api/service';
import type { ClinicRecordType } from '../../api/types';

const FORM_ID = 'add-clinic-record-form';

export const RECORD_TYPE_LABEL: Record<ClinicRecordType, string> = {
  allergy: 'Allergy',
  diagnosis: 'Diagnosis (long-term condition)',
  prescription: 'Prescription',
  lab: 'Lab result',
  visit: 'Visit note'
};

const PLACEHOLDER: Record<Exclude<ClinicRecordType, 'lab'>, string> = {
  allergy: 'e.g. Penicillin (rash)',
  diagnosis: 'e.g. Type 2 diabetes',
  prescription: 'e.g. Metformin 500 mg twice daily',
  visit: 'e.g. Viral fever for three days; paracetamol and fluids.'
};

const TYPE_OPTIONS = (Object.keys(RECORD_TYPE_LABEL) as ClinicRecordType[]).map((value) => ({
  value,
  label: RECORD_TYPE_LABEL[value]
}));

const schema = z
  .object({
    record_type: z.enum(['allergy', 'diagnosis', 'prescription', 'lab', 'visit']),
    content: z.string().trim().max(500),
    lab_name: z.string().trim().max(80),
    lab_value: z.string().trim().max(80),
    recorded_on: z.date({ error: 'Pick the date.' }).max(new Date(), 'Can’t be in the future.')
  })
  .superRefine((v, ctx) => {
    if (v.record_type === 'lab') {
      if (!v.lab_name)
        ctx.addIssue({ code: 'custom', path: ['lab_name'], message: 'Name the test.' });
      if (!v.lab_value)
        ctx.addIssue({ code: 'custom', path: ['lab_value'], message: 'Enter the result.' });
    } else if (!v.content) {
      ctx.addIssue({ code: 'custom', path: ['content'], message: 'Write what to record.' });
    }
  });

/** Adds one clinic record. Records are never edited afterwards: a mistake is marked, not changed. */
export function AddRecordDialog({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: addClinicRecord });

  const form = useAppForm({
    defaultValues: {
      record_type: 'allergy' as ClinicRecordType,
      content: '',
      lab_name: '',
      lab_value: '',
      recorded_on: new Date() as Date | undefined
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const result = await mutation.mutateAsync({
        patient_id: patientId,
        record_type: value.record_type,
        content:
          value.record_type === 'lab'
            ? `${value.lab_name.trim()}: ${value.lab_value.trim()}`
            : value.content.trim(),
        recorded_on: format(value.recorded_on!, 'yyyy-MM-dd')
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: patientKeys.all });
      toast.success(`${RECORD_TYPE_LABEL[value.record_type].split(' (')[0]} added to the record`);
      close();
    }
  });

  function close() {
    setOpen(false);
    form.reset();
  }

  return (
    <>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <Icons.add className='size-3.5' aria-hidden /> Add record
      </Button>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Add to the clinic record</DialogTitle>
            <DialogDescription>
              Clinic records can’t be edited or deleted once saved. If one turns out wrong, mark it
              “entered in error” and add the right one.
            </DialogDescription>
          </DialogHeader>

          <form
            id={FORM_ID}
            className='flex flex-col gap-4'
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.AppField
              name='record_type'
              children={(field) => (
                <field.SelectField label='Type' required options={TYPE_OPTIONS} />
              )}
            />
            <form.Subscribe selector={(s) => s.values.record_type}>
              {(type) =>
                type === 'lab' ? (
                  <div className='grid grid-cols-2 gap-4'>
                    <form.AppField
                      name='lab_name'
                      children={(field) => (
                        <field.TextField label='Test' required placeholder='e.g. HbA1c' />
                      )}
                    />
                    <form.AppField
                      name='lab_value'
                      children={(field) => (
                        <field.TextField label='Result' required placeholder='e.g. 7.2 %' />
                      )}
                    />
                  </div>
                ) : (
                  <form.AppField
                    name='content'
                    children={(field) => (
                      <field.TextareaField
                        label='Record'
                        required
                        rows={3}
                        maxLength={500}
                        placeholder={PLACEHOLDER[type]}
                      />
                    )}
                  />
                )
              }
            </form.Subscribe>
            <form.AppField
              name='recorded_on'
              children={(field) => (
                <field.DatePickerField
                  label='Date'
                  required
                  disabledDates={(d) => d > new Date()}
                />
              )}
            />
          </form>

          <DialogFooter>
            <Button variant='outline' onClick={close}>
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton form={FORM_ID}>Save record</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
