'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { useAppForm } from '@/lib/form';
import { patientKeys } from '../../api/queries';
import { registerPatient } from '../../api/service';
import type { PossibleDuplicate, Sex } from '../../api/types';

const FORM_ID = 'register-patient-form';

const schema = z
  .object({
    full_name: z.string().trim().min(1, 'Enter the patient’s name.').max(120),
    phone: z
      .string()
      .trim()
      .max(20)
      .regex(/^[+\d\s()-]*$/, 'Use digits only.'),
    age: z.number().int('Whole years only.').min(0).max(130, 'Check the age.').or(z.undefined()),
    sex: z.string(),
    allergies: z.array(z.string()),
    no_known_allergies: z.boolean(),
    conditions: z.array(z.string()),
    medications: z.array(z.string()),
    check_in: z.boolean()
  })
  .refine((v) => !(v.allergies.length && v.no_known_allergies), {
    message: 'Remove the listed allergies or untick this.',
    path: ['no_known_allergies']
  });

const SEX_OPTIONS = [
  { value: 'F', label: 'Female' },
  { value: 'M', label: 'Male' },
  { value: 'O', label: 'Other' }
];

const DUPLICATE_REASON = { phone: 'same phone number', name: 'same name' };

export function RegisterPatientSheet() {
  const [open, setOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<PossibleDuplicate[] | null>(null);
  const allowDuplicate = useRef(false);
  const queryClient = useQueryClient();
  const router = useRouter();

  const mutation = useMutation({ mutationFn: registerPatient });

  const form = useAppForm({
    defaultValues: {
      full_name: '',
      phone: '',
      age: undefined as number | undefined,
      sex: '',
      allergies: [] as string[],
      no_known_allergies: false,
      conditions: [] as string[],
      medications: [] as string[],
      check_in: true
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const result = await mutation.mutateAsync({
        ...value,
        phone: value.phone || null,
        age: value.age ?? null,
        sex: (value.sex || null) as Sex | null,
        allow_duplicate: allowDuplicate.current
      });
      allowDuplicate.current = false;
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.status === 'possible_duplicate') {
        setDuplicates(result.data.matches);
        return;
      }
      const { patient_id, display_code, token } = result.data;
      void queryClient.invalidateQueries({ queryKey: patientKeys.all });
      toast.success(
        `Registered ${value.full_name.trim()} as ${display_code}` +
          (token ? ` · token ${token}` : '')
      );
      close();
      router.push(`/patients/${patient_id}`);
    }
  });

  function close() {
    setOpen(false);
    setDuplicates(null);
    allowDuplicate.current = false;
    form.reset();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Icons.userPlus className='size-4' aria-hidden /> Register patient
      </Button>

      <Sheet open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <SheetContent className='flex w-full flex-col gap-0 sm:max-w-md'>
          <SheetHeader>
            <SheetTitle>Register a new patient</SheetTitle>
            <SheetDescription>
              What the patient reports at the desk goes straight into the clinic record, so the
              doctor’s allergy and interaction checks work from the first visit.
            </SheetDescription>
          </SheetHeader>

          <form
            id={FORM_ID}
            className='flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4'
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            {duplicates && (
              <Alert>
                <Icons.warning className='size-4' aria-hidden />
                <AlertTitle>This patient may already be registered</AlertTitle>
                <AlertDescription>
                  <ul className='my-2 flex flex-col gap-1'>
                    {duplicates.map((d) => (
                      <li key={d.patient_id}>
                        <Link
                          href={`/patients/${d.patient_id}`}
                          className='font-medium underline underline-offset-2'
                          onClick={close}
                        >
                          {d.display_name}
                        </Link>
                        {d.age != null && `, ${d.age}`}
                        {d.sex && ` ${d.sex}`} · {DUPLICATE_REASON[d.reason]}
                      </li>
                    ))}
                  </ul>
                  A second registration would split their history: an allergy on one record would be
                  invisible on the other. Families often share a phone, so check before going on.
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='mt-3'
                    onClick={() => {
                      allowDuplicate.current = true;
                      setDuplicates(null);
                      void form.handleSubmit();
                    }}
                  >
                    It’s a different person, register anyway
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <form.AppField
              name='full_name'
              children={(field) => (
                <field.TextField label='Full name' required autoComplete='off' />
              )}
            />
            <form.AppField
              name='phone'
              children={(field) => (
                <field.TextField
                  label='Phone'
                  type='tel'
                  inputMode='tel'
                  placeholder='98xxxxxxxx'
                  description='Used to find the patient next time. Never sent to the AI.'
                />
              )}
            />
            <div className='grid grid-cols-2 gap-4'>
              <form.AppField
                name='age'
                children={(field) => (
                  <field.TextField label='Age' type='number' min={0} max={130} />
                )}
              />
              <form.AppField
                name='sex'
                children={(field) => (
                  <field.SelectField label='Sex' placeholder='Select' options={SEX_OPTIONS} />
                )}
              />
            </div>

            <form.AppField
              name='allergies'
              mode='array'
              children={(field) => (
                <field.TagsField label='Drug allergies' placeholder='e.g. Penicillin, then Enter' />
              )}
            />
            <form.AppField
              name='no_known_allergies'
              children={(field) => (
                <field.CheckboxField
                  label='No known drug allergies'
                  description='Only tick this if the patient says so. Left blank, the allergy status stays “unknown”, not “none”.'
                />
              )}
            />
            <form.AppField
              name='conditions'
              mode='array'
              children={(field) => (
                <field.TagsField label='Long-term conditions' placeholder='e.g. Diabetes' />
              )}
            />
            <form.AppField
              name='medications'
              mode='array'
              children={(field) => (
                <field.TagsField label='Current medicines' placeholder='e.g. Metformin 500 mg' />
              )}
            />
            <form.AppField
              name='check_in'
              children={(field) => (
                <field.SwitchField
                  label='Add to today’s queue'
                  description='Gives them a token. Record their vital signs next.'
                />
              )}
            />
          </form>

          <SheetFooter className='flex-row justify-end border-t'>
            <Button variant='outline' onClick={close}>
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton form={FORM_ID}>Register</form.SubmitButton>
            </form.AppForm>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
