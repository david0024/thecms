/**
 * A stored file as the browser asks for it (ADR 0046): whole, or the part a
 * video or sound player asks for to start in the middle; a document named as
 * it was uploaded, and offered to keep rather than opened, unless it is a PDF.
 */
import { mediaKindOf } from '../core/index.ts';

/** `filename*` as RFC 6266 writes it: any name, in UTF-8, with nothing that ends the header. */
function disposition(kind: 'inline' | 'attachment', label: string, name: string): string {
  const ext = name.split('.').pop() ?? '';
  const base = label.replace(/[\u0000-\u001f\u007f"\\/]/g, '').trim() || name;
  const file = base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
  return `${kind}; filename*=UTF-8''${encodeURIComponent(file)}`;
}

export function mediaResponse(
  request: Request,
  name: string,
  file: { type: string; bytes: Uint8Array; label: string },
  headers: Record<string, string>,
): Response {
  const kind = mediaKindOf(name);
  const all: Record<string, string> = { 'content-type': file.type, 'accept-ranges': 'bytes', ...headers };
  if (kind === 'document') all['content-disposition'] = disposition(name.endsWith('.pdf') ? 'inline' : 'attachment', file.label, name);
  // The site's strict policy keeps the browser's own PDF reader from opening; a PDF is drawn by that reader, never by the site's pages.
  if (name.endsWith('.pdf')) delete all['content-security-policy'];
  const size = file.bytes.length;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...all, 'content-range': `bytes */${size}` } });
    const part = file.bytes.subarray(start, end + 1);
    return new Response(request.method === 'HEAD' ? null : (part as Uint8Array<ArrayBuffer>), {
      status: 206,
      headers: { ...all, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(part.length) },
    });
  }
  return new Response(request.method === 'HEAD' ? null : (file.bytes as Uint8Array<ArrayBuffer>), { headers: { ...all, 'content-length': String(size) } });
}
