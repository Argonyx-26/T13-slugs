import type { DocumentKind } from '../api/types';

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  photo: 'Clinical photo',
  xray: 'X-ray',
  scan: 'Scan',
  lab_report: 'Lab report',
  ecg: 'ECG',
  prescription: 'Prescription'
};

export const DOCUMENT_KINDS = Object.keys(DOCUMENT_KIND_LABEL) as [DocumentKind, ...DocumentKind[]];

/** What the upload form and the upload route accept */
export const UPLOAD_ACCEPT = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif']
};
