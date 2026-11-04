import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const mfaKey = () =>
  /^[0-9a-f]{64}$/i.test(process.env.MFA_ENCRYPTION_KEY || '')
    ? Buffer.from(process.env.MFA_ENCRYPTION_KEY, 'hex')
    : null;

export function seal(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
export function unseal(token, key) {
  const bytes = Buffer.from(token, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
  );
}
export function base32(bytes) {
  let bits = 0,
    value = 0,
    result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
export function totp(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', Buffer.from(secret, 'hex')).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function matchStep(secret, code, last = -1, now = Date.now()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const step of [current, current - 1, current + 1]) {
    if (
      step > last &&
      step >= 0 &&
      timingSafeEqual(Buffer.from(totp(secret, step)), Buffer.from(code))
    )
      return step;
  }
  return null;
}
export const recoveryHash = (code) => createHash('sha256').update(code).digest('hex');
export function verifyMfa(profile, code, key) {
  if (typeof code !== 'string') return null;
  const mfa = profile.mfa;
  const normalized = code.trim().toLowerCase();
  if (/^[0-9a-f]{24}$/.test(normalized)) {
    const hash = recoveryHash(normalized);
    return mfa.recovery.includes(hash)
      ? { ...mfa, recovery: mfa.recovery.filter((item) => item !== hash) }
      : null;
  }
  if (!key) return null;
  const payload = unseal(mfa.secret, key);
  if (payload.account !== profile.id) return null;
  const step = matchStep(payload.secret, normalized, mfa.step);
  return step === null ? null : { ...mfa, step };
}
