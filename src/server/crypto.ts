import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { appSecret } from './config.ts';

let key: Buffer | null = null;
const encKey = () => (key ??= createHash('sha256').update(`repoeasy:enc:${appSecret()}`).digest());

/** AES-256-GCM, output `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

export function decrypt(blob: string): string {
  const [version, iv, tag, data] = blob.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unreadable encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function hmac(value: string, secret = appSecret()): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
