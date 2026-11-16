/**
 * Makes a photograph fit for a web page before it is uploaded.
 *
 * A phone's photo is several megabytes and several thousand pixels wide, and
 * a JPEG from a phone often carries where it was taken. Drawing it again,
 * smaller, fixes all three: the copy that is uploaded is light, no wider than
 * a page needs, and has no location in it.
 *
 * Animated formats are left as they are (drawing one again would keep only its
 * first frame), and so is anything the browser cannot draw: the server decides
 * about those.
 */
const LONG_EDGE = 2400;
const QUALITY = 0.85;

export async function shrink(file: File): Promise<Blob> {
  const photo = file.type === 'image/jpeg';
  if (!photo && file.type !== 'image/png' && file.type !== 'image/webp') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    // A small PNG or WebP is kept exactly; a JPEG is always drawn again, to leave its location behind.
    if (scale === 1 && !photo) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY));
    // A browser that cannot write WebP answers with a PNG, which may be heavier than what came in.
    return blob && blob.type === 'image/webp' ? blob : file;
  } catch {
    return file;
  }
}
