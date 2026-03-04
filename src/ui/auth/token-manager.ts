import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getQabotDir } from '../../utils/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TokenPayload {
  sub: string;       // userId
  jti: string;       // session ID
  role: string;      // 'admin' | 'tester' | 'viewer'
  username: string;
  iat: number;       // issued at (unix seconds)
  exp: number;       // expires at (unix seconds)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function base64UrlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

function base64UrlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf-8');
}

// ── Password Hashing ─────────────────────────────────────────────────────────

import { scryptSync } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  try {
    const test = scryptSync(password, salt!, 64);
    return timingSafeEqual(Buffer.from(hash!, 'hex'), test);
  } catch {
    return false;
  }
}

// ── Token Manager ────────────────────────────────────────────────────────────

const SECRET_FILE = 'auth-secret.key';
const DEFAULT_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

export class TokenManager {
  private secret: Buffer;

  constructor(projectPath?: string) {
    const dir = getQabotDir(projectPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const secretPath = join(dir, SECRET_FILE);

    if (existsSync(secretPath)) {
      const hex = readFileSync(secretPath, 'utf-8').trim();
      this.secret = Buffer.from(hex, 'hex');
    } else {
      this.secret = randomBytes(64);
      writeFileSync(secretPath, this.secret.toString('hex'), 'utf-8');
    }
  }

  sign(payload: Omit<TokenPayload, 'iat'>): string {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: TokenPayload = {
      ...payload,
      iat: now,
      exp: payload.exp || now + DEFAULT_EXPIRY_SECONDS,
    };

    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64UrlEncode(JSON.stringify(fullPayload));
    const signature = this.createSignature(`${header}.${body}`);

    return `${header}.${body}.${signature}`;
  }

  verify(token: string): TokenPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [header, body, signature] = parts;
      const expectedSig = this.createSignature(`${header}.${body}`);

      // Timing-safe comparison
      if (signature!.length !== expectedSig.length) return null;
      const sigBuf = Buffer.from(signature!, 'utf-8');
      const expectedBuf = Buffer.from(expectedSig, 'utf-8');
      if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

      const payload = JSON.parse(base64UrlDecode(body!)) as TokenPayload;

      // Check expiry
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) return null;

      return payload;
    } catch {
      return null;
    }
  }

  private createSignature(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('base64url');
  }
}
