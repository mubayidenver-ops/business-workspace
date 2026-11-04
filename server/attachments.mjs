import { storageError } from './storage/rules.mjs';

export function validateAttachment(input) {
  if (!input) return '';
  let file;
  try {
    file = typeof input === 'string' ? JSON.parse(input) : input;
  } catch {
    throw storageError(400, 'The attachment is invalid.');
  }
  const { name, mime, content } = file || {};
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 120 ||
    /[\x00-\x1f<>:"/\\|?*]/.test(name) ||
    typeof content !== 'string' ||
    content.length > 43692 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(content)
  )
    throw storageError(400, 'Attach a PDF, PNG, or JPEG up to 32 KiB.');
  const bytes = Buffer.from(content, 'base64');
  const signatures = {
    'application/pdf': '255044462d',
    'image/png': '89504e470d0a1a0a',
    'image/jpeg': 'ffd8ff',
  };
  if (
    !Object.hasOwn(signatures, mime) ||
    bytes.length > 32768 ||
    bytes.toString('base64') !== content ||
    !bytes.subarray(0, 8).toString('hex').startsWith(signatures[mime])
  )
    throw storageError(400, 'Attach a valid PDF, PNG, or JPEG up to 32 KiB.');
  return JSON.stringify({ name, mime, content });
}
