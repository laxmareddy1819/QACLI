import { randomBytes, createHash } from 'node:crypto';

export function generateId(prefix?: string): string {
  const hex = randomBytes(8).toString('hex');
  return prefix ? `${prefix}_${hex}` : hex;
}

export function hash(data: string, algorithm: 'md5' | 'sha256' = 'sha256'): string {
  return createHash(algorithm).update(data).digest('hex');
}
