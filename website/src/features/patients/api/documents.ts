import type { DocumentKind, PatientDocument } from './types';

export interface UploadDocumentInput {
  file: File;
  title: string;
  kind: DocumentKind;
  description: string;
}

/** POST /api/patients/{id}/documents */
export async function uploadPatientDocument(
  patientId: string,
  input: UploadDocumentInput
): Promise<PatientDocument> {
  const body = new FormData();
  body.set('file', input.file);
  body.set('title', input.title);
  body.set('kind', input.kind);
  body.set('description', input.description);

  const res = await fetch(`/api/patients/${encodeURIComponent(patientId)}/documents`, {
    method: 'POST',
    body
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? 'The upload failed. Try again.');
  return data as PatientDocument;
}
