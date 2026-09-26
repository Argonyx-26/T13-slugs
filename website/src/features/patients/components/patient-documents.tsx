'use client';

import { AnimatePresence, motion } from 'motion/react';
import Image from 'next/image';
import { useState } from 'react';
import { Icons, type Icon } from '@/components/icons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Carousel_003 } from '@/components/ui/skiper-ui/skiper49';
import type { DocumentKind, PatientDocument } from '../api/types';
import { DOCUMENT_KIND_LABEL } from '../utils/documents';
import { formatDate, sourceLabel } from '../utils/record';
import { PatientDocumentUpload } from './patient-document-upload';

const KIND_ICON: Record<DocumentKind, Icon> = {
  xray: Icons.xray,
  lab_report: Icons.lab,
  ecg: Icons.heartbeat,
  prescription: Icons.prescription,
  scan: Icons.scan,
  photo: Icons.media
};

const originLabel = (doc: PatientDocument) => (doc.uploaded ? 'Uploaded' : sourceLabel(doc.source));

function DocumentDetails({ doc }: { doc: PatientDocument }) {
  const KindIcon = KIND_ICON[doc.kind];
  return (
    <div className='flex flex-col items-center gap-1.5 text-center'>
      <span className='text-muted-foreground inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium'>
        <KindIcon className='size-3.5' aria-hidden /> {DOCUMENT_KIND_LABEL[doc.kind]}
      </span>
      <p className='text-foreground text-[15px] font-semibold'>{doc.title}</p>
      <p className='text-muted-foreground text-xs'>
        {formatDate(doc.recorded_on)} · {originLabel(doc)}
      </p>
      <p className='text-foreground/90 max-w-md text-sm leading-6'>{doc.description}</p>
    </div>
  );
}

export function PatientDocuments({
  patientId,
  documents
}: {
  patientId: string;
  documents: PatientDocument[];
}) {
  return (
    <div className='flex flex-col gap-3'>
      {documents.length ? (
        // A new upload goes first, so start again from the newest file
        <DocumentCarousel key={documents[0].id} documents={documents} />
      ) : (
        <p className='text-muted-foreground rounded-2xl border border-dashed px-4 py-5 text-sm'>
          No scans, reports or photos on record for this patient.
        </p>
      )}
      <div className='flex justify-center'>
        <PatientDocumentUpload patientId={patientId} />
      </div>
    </div>
  );
}

function DocumentCarousel({ documents }: { documents: PatientDocument[] }) {
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<PatientDocument | null>(null);

  const current = documents[active] ?? documents[0];

  return (
    <div className='bg-muted/40 overflow-hidden rounded-2xl border pt-2 pb-5'>
      <Carousel_003
        items={documents.map((d) => ({ src: d.src, alt: d.title }))}
        showPagination={documents.length > 1}
        showNavigation
        onActiveChange={setActive}
        onOpen={(index) => setOpen(documents[index] ?? null)}
      />

      <div aria-live='polite' className='min-h-28 px-4'>
        <AnimatePresence mode='wait' initial={false}>
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <DocumentDetails doc={current} />
          </motion.div>
        </AnimatePresence>
      </div>
      <p className='text-muted-foreground mt-3 text-center text-xs'>
        Swipe or scroll sideways to browse · click the centre file to open it
      </p>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className='sm:max-w-2xl'>
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.title}</DialogTitle>
                <DialogDescription>
                  {DOCUMENT_KIND_LABEL[open.kind]} · {formatDate(open.recorded_on)} ·{' '}
                  {originLabel(open)}
                </DialogDescription>
              </DialogHeader>
              <Image
                src={open.src}
                alt={open.title}
                width={480}
                height={640}
                unoptimized
                className='mx-auto h-auto max-h-[70dvh] w-auto rounded-lg border'
              />
              <p className='text-foreground/90 text-sm leading-6'>{open.description}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
