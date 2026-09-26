'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { patientKeys, patientsQueryOptions } from '../../api/queries';
import { checkInPatient } from '../../api/service';
import type { Vitals } from '../../api/types';
import { TRIAGE_META } from '../triage-indicator';

const FORM_ID = 'check-in-form';

/** An optional number in range: empty is fine, out of range gets a message */
const optional = (min: number, max: number, unit: string, whole = true) =>
  (whole ? z.number().int('Whole numbers only.') : z.number())
    .min(min, `${min}–${max} ${unit}`)
    .max(max, `${min}–${max} ${unit}`)
    .or(z.undefined());

const schema = z.object({
  patient_id: z.string().min(1, 'Choose the patient.'),
  complaint: z.array(z.string()),
  systolic_bp: optional(40, 300, 'mmHg'),
  diastolic_bp: optional(20, 200, 'mmHg'),
  heart_rate: optional(20, 250, '/min'),
  resp_rate: optional(4, 70, '/min'),
  temperature_c: optional(30, 45, '°C', false),
  spo2: optional(50, 100, '%'),
  on_oxygen: z.boolean(),
  consciousness: z.string(),
  blood_glucose: optional(10, 1000, 'mg/dL'),
  weight_kg: optional(1, 400, 'kg', false)
});

const CONSCIOUSNESS_OPTIONS = [
  { value: 'alert', label: 'Alert' },
  { value: 'new_confusion', label: 'New confusion' },
  { value: 'voice', label: 'Responds to voice' },
  { value: 'pain', label: 'Responds to pain' },
  { value: 'unresponsive', label: 'Unresponsive' }
];

type Values = z.infer<typeof schema>;

function toVitals(v: Values): Vitals | null {
  const vitals: Vitals = {
    systolic_bp: v.systolic_bp ?? null,
    diastolic_bp: v.diastolic_bp ?? null,
    heart_rate: v.heart_rate ?? null,
    resp_rate: v.resp_rate ?? null,
    temperature_c: v.temperature_c ?? null,
    spo2: v.spo2 ?? null,
    on_oxygen: v.on_oxygen,
    consciousness: (v.consciousness || null) as Vitals['consciousness'],
    blood_glucose: v.blood_glucose ?? null,
    weight_kg: v.weight_kg ?? null
  };
  const measured = Object.entries(vitals).some(([k, x]) =>
    k === 'on_oxygen' ? x === true : x != null
  );
  return measured ? vitals : null;
}

/**
 * The desk checks a patient into today's queue and takes their vital signs and main complaint.
 * Triage runs straight away and re-orders the queue. Without `patientId`, the desk picks the patient.
 */
export function CheckInDialog({
  patientId,
  patientName,
  trigger = 'button'
}: {
  patientId?: string;
  patientName?: string;
  trigger?: 'button' | 'small';
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const patients = useQuery({ ...patientsQueryOptions(), enabled: open && !patientId });
  const mutation = useMutation({ mutationFn: checkInPatient });

  const form = useAppForm({
    defaultValues: {
      patient_id: patientId ?? '',
      complaint: [] as string[],
      systolic_bp: undefined as number | undefined,
      diastolic_bp: undefined as number | undefined,
      heart_rate: undefined as number | undefined,
      resp_rate: undefined as number | undefined,
      temperature_c: undefined as number | undefined,
      spo2: undefined as number | undefined,
      on_oxygen: false,
      consciousness: '',
      blood_glucose: undefined as number | undefined,
      weight_kg: undefined as number | undefined
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const result = await mutation.mutateAsync({
        patient_id: value.patient_id,
        complaint: value.complaint,
        vitals: toVitals(value)
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { token, assessment } = result.data;
      void queryClient.invalidateQueries({ queryKey: patientKeys.all });
      if (assessment) {
        const meta = TRIAGE_META[assessment.level];
        const top = assessment.findings[0]?.title;
        const message = `Token ${token} · Triage: ${meta.label}${top ? ` (${top})` : ''}`;
        if (assessment.level === 'critical' || assessment.level === 'high') {
          toast.warning(message, { description: assessment.urgency, duration: 10_000 });
        } else {
          toast.success(message, { description: assessment.urgency });
        }
      } else {
        toast.success(`Checked in · token ${token}`, {
          description: 'Triage runs once vital signs are recorded.'
        });
      }
      close();
    }
  });

  function close() {
    setOpen(false);
    form.reset();
  }

  const numberField = (
    name:
      | 'systolic_bp'
      | 'diastolic_bp'
      | 'heart_rate'
      | 'resp_rate'
      | 'temperature_c'
      | 'spo2'
      | 'blood_glucose'
      | 'weight_kg',
    label: string,
    step?: string
  ) => (
    <form.AppField
      name={name}
      children={(field) => (
        <field.TextField label={label} type='number' inputMode='decimal' step={step} />
      )}
    />
  );

  return (
    <>
      {trigger === 'small' ? (
        <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
          <Icons.vitals className='size-3.5' aria-hidden /> Record vital signs
        </Button>
      ) : (
        <Button variant='outline' onClick={() => setOpen(true)}>
          <Icons.vitals className='size-4' aria-hidden /> Check in patient
        </Button>
      )}

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle>
              {patientName ? `Check in ${patientName}` : 'Check in a patient'}
            </DialogTitle>
            <DialogDescription>
              Adds them to today’s queue. Vital signs and the main complaint run the triage rules
              straight away; leave anything not measured blank.
            </DialogDescription>
          </DialogHeader>

          <form
            id={FORM_ID}
            className='flex flex-col gap-5'
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            {!patientId && (
              <form.AppField
                name='patient_id'
                children={(field) => (
                  <field.ComboboxField
                    label='Patient'
                    required
                    placeholder={patients.isLoading ? 'Loading patients…' : 'Choose a patient'}
                    searchPlaceholder='Search by name'
                    options={(patients.data?.patients ?? []).map((p) => ({
                      value: p.id,
                      label: [p.displayName, p.age != null ? `${p.age}` : null, p.sex]
                        .filter(Boolean)
                        .join(' · ')
                    }))}
                  />
                )}
              />
            )}

            <form.AppField
              name='complaint'
              mode='array'
              children={(field) => (
                <field.TagsField
                  label='Main complaint'
                  placeholder='e.g. fever since yesterday, then Enter'
                />
              )}
            />

            <fieldset className='flex flex-col gap-4'>
              <legend className='mb-3 text-sm font-medium'>Vital signs</legend>
              <div className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
                {numberField('systolic_bp', 'BP systolic')}
                {numberField('diastolic_bp', 'BP diastolic')}
                {numberField('heart_rate', 'Pulse /min')}
                {numberField('resp_rate', 'Breathing /min')}
                {numberField('temperature_c', 'Temp °C', '0.1')}
                {numberField('spo2', 'SpO₂ %')}
                {numberField('blood_glucose', 'Glucose mg/dL')}
                {numberField('weight_kg', 'Weight kg', '0.1')}
              </div>
              <div className='grid gap-4 sm:grid-cols-2'>
                <form.AppField
                  name='consciousness'
                  children={(field) => (
                    <field.SelectField
                      label='Consciousness'
                      placeholder='Not assessed'
                      options={CONSCIOUSNESS_OPTIONS}
                    />
                  )}
                />
                <form.AppField
                  name='on_oxygen'
                  children={(field) => <field.SwitchField label='On supplemental oxygen' />}
                />
              </div>
            </fieldset>
          </form>

          <DialogFooter>
            <Button variant='outline' onClick={close}>
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton form={FORM_ID}>Check in</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
