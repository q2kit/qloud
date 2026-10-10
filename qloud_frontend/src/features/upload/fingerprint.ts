/** Match a reselected file without reading its whole contents into memory. */
export async function fingerprint(file: File): Promise<string> {
  const prefix = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as ArrayBuffer);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('file read failed'));
    };
    reader.readAsArrayBuffer(file.slice(0, 1024 * 1024));
  });
  const digest = await crypto.subtle.digest('SHA-256', prefix);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  // The API allows 128 characters; hash the metadata too so long filenames fit.
  const metadata = new TextEncoder().encode(
    JSON.stringify([file.name, file.size, file.lastModified, hash]),
  );
  const identity = await crypto.subtle.digest('SHA-256', metadata);
  return [...new Uint8Array(identity)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
