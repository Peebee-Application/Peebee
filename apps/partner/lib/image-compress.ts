/**
 * Resizes and re-encodes an image client-side before it ever hits the
 * network — on Uganda's mobile data prices, a stock camera photo (often
 * 3-8MB at full sensor resolution) costs real money to upload for no
 * benefit: nothing in this app displays a photo larger than a phone
 * screen. Shrinking to a sane max dimension and re-encoding as a
 * moderate-quality JPEG routinely cuts a multi-MB photo to under 300KB.
 *
 * Falls back to the original file untouched if anything goes wrong (a
 * format canvas can't decode, a very old browser, etc.) — compression is
 * an optimization, never a hard requirement to send a photo.
 */
export async function compressImage(
  file: File,
  { maxDimension = 1280, quality = 0.72 }: { maxDimension?: number; quality?: number } = {},
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;

    // Only worth it if we actually saved space — a small/simple image can
    // occasionally re-encode larger than a well-compressed original.
    if (blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}
