import { z } from 'zod';
import { getPatientById } from '@/features/patients/api/service';
import { MAX_UPLOAD_BYTES, UploadError, saveUpload } from '@/features/patients/server/uploads';
import { DOCUMENT_KINDS } from '@/features/patients/utils/documents';

const metaSchema = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(DOCUMENT_KINDS),
  description: z.string().trim().max(500)
});

/** Upload an image to a patient's files: multipart form with file, title, kind, description */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'Choose an image to upload.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: 'Images can be up to 10 MB.' }, { status: 413 });
  }
  const meta = metaSchema.safeParse({
    title: form?.get('title'),
    kind: form?.get('kind'),
    description: form?.get('description') ?? ''
  });
  if (!meta.success) {
    return Response.json(
      { error: 'A name of up to 120 characters and a file type are required.' },
      { status: 400 }
    );
  }

  const { patient } = await getPatientById(id);
  if (!patient) return Response.json({ error: 'Unknown patient.' }, { status: 404 });

  try {
    const doc = await saveUpload(
      id,
      { bytes: Buffer.from(await file.arrayBuffer()), type: file.type },
      {
        ...meta.data,
        description: meta.data.description || 'Uploaded to the patient’s files.'
      }
    );
    return Response.json(doc, { status: 201 });
  } catch (error) {
    if (error instanceof UploadError)
      return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
