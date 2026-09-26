'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { uploadPatientDocument, type UploadDocumentInput } from '../api/documents';
import { patientKeys } from '../api/queries';
import type { DocumentKind } from '../api/types';
import { DOCUMENT_KIND_LABEL, DOCUMENT_KINDS, UPLOAD_ACCEPT } from '../utils/documents';

const MAX_SIZE = 10 * 1024 * 1024;

const uploadSchema = z.object({
  files: z.array(z.instanceof(File)).length(1, 'Choose an image to upload.'),
  title: z.string().trim().min(1, 'Give the file a name.').max(120),
  kind: z.enum(DOCUMENT_KINDS),
  description: z.string().trim().max(500)
});

const KIND_OPTIONS = DOCUMENT_KINDS.map((value) => ({
  value,
  label: DOCUMENT_KIND_LABEL[value]
}));

export function PatientDocumentUpload({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const upload = useMutation({
    mutationFn: (input: UploadDocumentInput) => uploadPatientDocument(patientId, input),
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) });
      toast.success(`Added “${doc.title}” to the patient’s files`);
    }
  });

  const form = useAppForm({
    defaultValues: {
      files: [] as File[],
      title: '',
      kind: 'photo' as DocumentKind,
      description: ''
    },
    validators: { onSubmit: uploadSchema },
    onSubmit: async ({ value }) => {
      try {
        await upload.mutateAsync({
          file: value.files[0],
          title: value.title.trim(),
          kind: value.kind,
          description: value.description.trim()
        });
        setOpen(false);
        form.reset();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'The upload failed. Try again.');
      }
    }
  });

  return (
    <>
      <Button variant='outline' className='w-full sm:w-auto' onClick={() => setOpen(true)}>
        <Icons.add className='size-4' aria-hidden /> Add image
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) form.reset();
        }}
      >
        <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>Add an image</DialogTitle>
            <DialogDescription>
              Upload a scan, report or photo to this patient’s files. PNG, JPEG, WebP or GIF, up to
              10 MB.
            </DialogDescription>
          </DialogHeader>

          <form
            id='patient-document-upload'
            className='flex flex-col gap-4'
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.AppField
              name='files'
              listeners={{
                onChange: ({ value }) => {
                  const file = value?.[0];
                  if (file && !form.getFieldValue('title').trim()) {
                    form.setFieldValue('title', file.name.replace(/\.[^.]+$/, ''));
                  }
                }
              }}
              children={(field) => (
                <field.FileUploadField
                  label='Image'
                  required
                  maxSize={MAX_SIZE}
                  maxFiles={1}
                  accept={UPLOAD_ACCEPT}
                />
              )}
            />
            <form.AppField
              name='title'
              children={(field) => (
                <field.TextField label='Name' required placeholder='e.g. Chest X-ray' />
              )}
            />
            <form.AppField
              name='kind'
              children={(field) => (
                <field.SelectField label='Type' required options={KIND_OPTIONS} />
              )}
            />
            <form.AppField
              name='description'
              children={(field) => (
                <field.TextareaField
                  label='What it shows'
                  placeholder='Optional, e.g. taken at today’s visit'
                  maxLength={500}
                  rows={2}
                />
              )}
            />
          </form>

          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton form='patient-document-upload'>
                <Icons.upload className='size-4' aria-hidden /> Upload
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
