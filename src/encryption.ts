/**
 * AES-256-GCM encryption for user API keys.
 * Master key stored in data/env/env as PROMETHEUS_ENCRYPTION_KEY.
 * Auto-generated on first use.
 */
import crypto from 'crypto';
import { readEnvFile, writeEnvVars } from './env.js';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

let cachedMasterKey: Buffer | null = null;

export function getOrCreateMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  const env = readEnvFile(['PROMETHEUS_ENCRYPTION_KEY']);
  if (env.PROMETHEUS_ENCRYPTION_KEY) {
    cachedMasterKey = Buffer.from(env.PROMETHEUS_ENCRYPTION_KEY, 'hex');
    return cachedMasterKey;
  }

  // Generate and persist a new master key
  const key = crypto.randomBytes(32);
  writeEnvVars({ PROMETHEUS_ENCRYPTION_KEY: key.toString('hex') });
  logger.info('Generated new PROMETHEUS_ENCRYPTION_KEY');
  cachedMasterKey = key;
  return key;
}

export function encryptApiKey(plaintext: string): {
  encrypted: string;
  iv: string;
  authTag: string;
} {
  const key = getOrCreateMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return { encrypted, iv: iv.toString('hex'), authTag };
}

export function decryptApiKey(
  encrypted: string,
  iv: string,
  authTag: string,
): string {
  const key = getOrCreateMasterKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function generateContainerAuthToken(userId: string): string {
  const key = getOrCreateMasterKey();
  const payload = Buffer.from(userId).toString('base64url');
  const hmac = crypto
    .createHmac('sha256', key)
    .update(payload)
    .digest('base64url');
  return `${payload}.${hmac}`;
}

/**
 * Validate a container auth token and extract the userId.
 * Returns null if the token is invalid or tampered with.
 */
export function validateContainerAuthToken(token: string): string | null {
  const dotIdx = token.indexOf('.');
  if (dotIdx === -1) return null;
  const payload = token.slice(0, dotIdx);
  const signature = token.slice(dotIdx + 1);
  const key = getOrCreateMasterKey();
  const expected = crypto
    .createHmac('sha256', key)
    .update(payload)
    .digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  return Buffer.from(payload, 'base64url').toString('utf8');
}
