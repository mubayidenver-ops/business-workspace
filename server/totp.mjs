import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buffer) {
  let bits = 0,
    value = 0,
    out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(text) {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0,
    value = 0;
  const out = [];
  for (const c of clean) {
    const index = alphabet.indexOf(c);
    if (index < 0) throw new Error('Invalid base32 secret.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export const newSecret = () => base32Encode(randomBytes(20));
export function totpCode(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1e6).padStart(6, '0');
}
export const currentStep = (now = Date.now()) => Math.floor(now / 30000);
/** Returns the matched time step (±1 step drift) or null. Steps at or before `lastStep` are rejected to prevent replay. */
export function verifyTotp(secret, code, lastStep = -1, now = Date.now()) {
  const value = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(value)) return null;
  const step = currentStep(now);
  for (const candidate of [step - 1, step, step + 1]) {
    if (candidate <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, candidate)), Buffer.from(value)))
      return candidate;
  }
  return null;
}
export const otpauthURL = (secret, email, issuer = 'Business Workspace') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
const hashCode = (code) =>
  createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');
export function newRecoveryCodes(count = 8) {
  const codes = Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex');
    return raw.slice(0, 5) + '-' + raw.slice(5);
  });
  return { codes, hashes: codes.map(hashCode) };
}
/** Returns the remaining hashes when the code matches one, otherwise null. */
export function useRecoveryCode(hashes, code) {
  const value = String(code || '');
  if (!/^[a-f0-9]{5}-?[a-f0-9]{5}$/i.test(value.trim())) return null;
  const hash = hashCode(value);
  const index = (hashes || []).indexOf(hash);
  return index < 0 ? null : hashes.filter((_, i) => i !== index);
}
