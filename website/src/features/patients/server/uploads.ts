import 'server-only';

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentKind, PatientDocument } from '../api/types';

// ============================================================
// Uploaded patient images, stored on the local disk
// ============================================================
// .data/uploads/<patient-id>/index.json holds the metadata, next to the image files.
// Files are named by a random UUID, never by the uploaded name, so paths can't be steered.
// ============================================================

const ROOT = path.join(process.cwd(), '.data', 'uploads');

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Raster images only: an uploaded SVG could carry script */
const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
} as const;

type ImageType = keyof typeof IMAGE_TYPES;

const EXT_TO_TYPE = Object.fromEntries(
  Object.entries(IMAGE_TYPES).map(([type, ext]) => [ext, type])
) as Record<string, ImageType>;

const PATIENT_ID = /^[0-9a-f-]{8,64}$/i;
const FILE_NAME = /^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;

export class UploadError extends Error {}

export function isImageType(type: string): type is ImageType {
  return type in IMAGE_TYPES;
}

/** Checks the file's first bytes, so a renamed non-image is refused */
function matchesSignature(bytes: Buffer, type: ImageType): boolean {
  switch (type) {
    case 'image/png':
      return bytes
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/gif':
      return bytes.subarray(0, 4).toString('ascii') === 'GIF8';
    case 'image/webp':
      return (
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP'
      );
  }
}

function patientDir(patientId: string): string {
  if (!PATIENT_ID.test(patientId)) throw new UploadError('Unknown patient.');
  return path.join(ROOT, patientId);
}

async function readIndex(patientId: string): Promise<PatientDocument[]> {
  try {
    const raw = await readFile(path.join(patientDir(patientId), 'index.json'), 'utf8');
    return JSON.parse(raw) as PatientDocument[];
  } catch {
    return [];
  }
}

/** Newest first */
export async function listUploads(patientId: string): Promise<PatientDocument[]> {
  if (!PATIENT_ID.test(patientId)) return [];
  return readIndex(patientId);
}

// One write at a time, so two uploads can't overwrite each other's index entry
let queue: Promise<unknown> = Promise.resolve();

export function saveUpload(
  patientId: string,
  file: { bytes: Buffer; type: string },
  meta: { title: string; kind: DocumentKind; description: string }
): Promise<PatientDocument> {
  const run = async () => {
    if (!isImageType(file.type)) throw new UploadError('Upload a PNG, JPEG, WebP or GIF image.');
    if (file.bytes.length > MAX_UPLOAD_BYTES) throw new UploadError('Images can be up to 10 MB.');
    if (!matchesSignature(file.bytes, file.type)) {
      throw new UploadError('This file is not a valid image.');
    }

    const dir = patientDir(patientId);
    await mkdir(dir, { recursive: true });
    const id = randomUUID();
    const fileName = `${id}.${IMAGE_TYPES[file.type]}`;
    await writeFile(path.join(dir, fileName), file.bytes);

    const doc: PatientDocument = {
      id,
      title: meta.title,
      kind: meta.kind,
      src: `/api/patients/${patientId}/documents/${fileName}`,
      recorded_on: new Date().toISOString().slice(0, 10),
      source: 'clinic_db',
      description: meta.description,
      uploaded: true
    };
    const index = await readIndex(patientId);
    await writeFile(path.join(dir, 'index.json'), JSON.stringify([doc, ...index], null, 2));
    return doc;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

export async function readUpload(
  patientId: string,
  fileName: string
): Promise<{ bytes: Buffer; type: ImageType } | null> {
  if (!PATIENT_ID.test(patientId) || !FILE_NAME.test(fileName)) return null;
  try {
    const bytes = await readFile(path.join(ROOT, patientId, fileName));
    return { bytes, type: EXT_TO_TYPE[fileName.split('.').pop() ?? ''] };
  } catch {
    return null;
  }
}
