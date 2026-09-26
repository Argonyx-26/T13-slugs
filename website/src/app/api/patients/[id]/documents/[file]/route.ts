import { readUpload } from '@/features/patients/server/uploads';

/** Serves an uploaded image */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; file: string }> }
) {
  const { id, file } = await params;
  const upload = await readUpload(id, file);
  if (!upload) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(upload.bytes), {
    headers: {
      'Content-Type': upload.type,
      'X-Content-Type-Options': 'nosniff',
      // Names are random and never reused, so the file never changes
      'Cache-Control': 'private, max-age=31536000, immutable'
    }
  });
}
