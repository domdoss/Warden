/**
 * OAuth flow manager.
 * Handles the full OAuth lifecycle: authorization URL generation, callback
 * handling with HMAC-signed state, token encryption/storage, automatic
 * refresh, and revocation.
 *
 * Tokens are AES-256-GCM encrypted at rest using PROMETHEUS_ENCRYPTION_KEY.
 * State parameters are HMAC-SHA256 signed to prevent CSRF.
 * Nonces expire after 10 minutes and are single-use.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { encryptApiKey, decryptApiKey, getOrCreateMasterKey } from './encryption.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { OAUTH_REDIRECT_BASE } from './config.js';
import {
  getOAuthAccount,
  getOAuthAccountsByUser,
  createOAuthAccount,
  updateOAuthAccount,
  deleteOAuthAccount,
  getOAuthAccountsWithCalendar,
  createEmailAccount,
  updateEmailAccount as updateEmailAccountDb,
} from './db.js';
import { GoogleProvider } from './providers/google.js';
import { MicrosoftProvider } from './providers/microsoft.js';
import type { OAuthProvider, OAuthProviderType } from './providers/types.js';

// ---------------------------------------------------------------------------
// Scopes per provider — all requested at connect time
// ---------------------------------------------------------------------------

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

const MICROSOFT_SCOPES = [
  'Calendars.ReadWrite',
  'Mail.Read',
  'Mail.Send',
  'offline_access',
];

// ---------------------------------------------------------------------------
// Pending flow state — persisted to data/oauth-pending.json so server restarts
// don't wipe in-flight OAuth flows. Nonces still expire after 10 minutes.
// ---------------------------------------------------------------------------

interface PendingFlow {
  userId: string;
  provider: string;
  nonce: string;
  readOnly: boolean;
  createdAt: number;
  reconnectAccountId?: string;
}

const NONCE_TTL_MS = 10 * 60 * 1000;
const PENDING_FILE = path.join(process.cwd(), 'data', 'oauth-pending.json');
const pendingFlows = new Map<string, PendingFlow>();

// Load any persisted flows on module init.
try {
  if (fs.existsSync(PENDING_FILE)) {
    const raw = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf-8')) as PendingFlow[];
    for (const f of raw) pendingFlows.set(f.nonce, f);
  }
} catch (err) {
  logger.warn({ err }, 'Failed to load pending OAuth flows');
}

function flushPendingFlows(): void {
  try {
    fs.mkdirSync(path.dirname(PENDING_FILE), { recursive: true });
    fs.writeFileSync(PENDING_FILE, JSON.stringify([...pendingFlows.values()]));
  } catch (err) {
    logger.warn({ err }, 'Failed to persist pending OAuth flows');
  }
}

/** Purge expired nonces. Called lazily before reads/writes. */
function purgeExpiredNonces(): void {
  const now = Date.now();
  let changed = false;
  for (const [nonce, flow] of pendingFlows) {
    if (now - flow.createdAt > NONCE_TTL_MS) {
      pendingFlows.delete(nonce);
      changed = true;
    }
  }
  if (changed) flushPendingFlows();
}

// ---------------------------------------------------------------------------
// HMAC helpers
// ---------------------------------------------------------------------------

/**
 * Sign a payload object as base64url(json).base64url(hmac).
 */
export function signState(payload: object): string {
  const key = getOrCreateMasterKey();
  const json = JSON.stringify(payload);
  const jsonB64 = Buffer.from(json).toString('base64url');
  const hmac = crypto
    .createHmac('sha256', key)
    .update(jsonB64)
    .digest('base64url');
  return `${jsonB64}.${hmac}`;
}

/**
 * Verify HMAC on a signed state string. Returns the parsed payload.
 * Throws if the signature is invalid or the format is wrong.
 */
export function verifyState(state: string): object {
  const dotIdx = state.indexOf('.');
  if (dotIdx === -1) throw new Error('Invalid state format');

  const jsonB64 = state.slice(0, dotIdx);
  const signature = state.slice(dotIdx + 1);

  const key = getOrCreateMasterKey();
  const expected = crypto
    .createHmac('sha256', key)
    .update(jsonB64)
    .digest('base64url');

  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw new Error('Invalid state signature');
  }

  return JSON.parse(Buffer.from(jsonB64, 'base64url').toString('utf8'));
}

// ---------------------------------------------------------------------------
// Provider instantiation
// ---------------------------------------------------------------------------

/**
 * Create a provider instance with credentials from the env file.
 * Throws if the provider's client credentials are not configured.
 */
export function getProviderInstance(provider: OAuthProviderType): OAuthProvider {
  if (!OAUTH_REDIRECT_BASE) {
    throw new Error('OAUTH_REDIRECT_BASE not configured');
  }
  const redirectUri = `${OAUTH_REDIRECT_BASE}/api/oauth/callback`;

  if (provider === 'google') {
    const env = readEnvFile(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth not configured: missing Client ID or Client Secret');
    }
    return new GoogleProvider({ clientId, clientSecret, redirectUri });
  }

  if (provider === 'microsoft') {
    const env = readEnvFile(['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET']);
    const clientId = env.MICROSOFT_CLIENT_ID;
    const clientSecret = env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Microsoft OAuth not configured: missing Client ID or Client Secret');
    }
    return new MicrosoftProvider({ clientId, clientSecret, redirectUri });
  }

  throw new Error(`Unknown OAuth provider: ${provider}`);
}

// ---------------------------------------------------------------------------
// Flow start
// ---------------------------------------------------------------------------

/**
 * Start an OAuth flow for a provider.
 * Generates an HMAC-signed state parameter and returns the full authorization URL.
 * Requests all scopes (calendar + email read + email send) for the provider.
 *
 * When `reconnectAccountId` is provided, the callback will update the existing
 * account's tokens instead of creating a new one (used by the Reconnect button).
 */
export function startOAuthFlow(
  provider: OAuthProviderType,
  userId: string,
  readOnly: boolean = true, // DEFAULT READ ONLY for OAuth
  reconnectAccountId?: string,
): string {
  purgeExpiredNonces();

  const nonce = crypto.randomBytes(32).toString('hex');
  const statePayload: any = { userId, provider, nonce, readOnly };
  if (reconnectAccountId) statePayload.reconnectAccountId = reconnectAccountId;
  const state = signState(statePayload);

  pendingFlows.set(nonce, {
    userId,
    provider,
    nonce,
    readOnly,
    createdAt: Date.now(),
    ...(reconnectAccountId && { reconnectAccountId }),
  });
  flushPendingFlows();

  const providerInstance = getProviderInstance(provider);
  const scopes = provider === 'google' ? GOOGLE_SCOPES : MICROSOFT_SCOPES;

  logger.info({ provider, userId }, 'OAuth flow started');
  return providerInstance.getAuthUrl(state, scopes);
}

/**
 * Start an OAuth reconnect flow for an existing account whose refresh token
 * has expired.  Re-uses the same provider and userId, and passes the account
 * ID through state so the callback updates tokens in-place.
 */
export function reconnectOAuthAccount(accountId: string): string {
  const account = getOAuthAccount(accountId);
  if (!account) throw new Error(`OAuth account not found: ${accountId}`);

  return startOAuthFlow(
    account.provider as OAuthProviderType,
    account.user_id,
    true,
    accountId,
  );
}

// ---------------------------------------------------------------------------
// Callback handling
// ---------------------------------------------------------------------------

/**
 * Handle the OAuth callback. Validates state HMAC, verifies nonce,
 * exchanges code for tokens, encrypts and stores them, and creates
 * a linked email_accounts row.
 */
export async function handleOAuthCallback(
  code: string,
  state: string,
): Promise<{ accountId: string; provider: string; email: string }> {
  // Validate HMAC on state
  const payload = verifyState(state) as {
    userId: string;
    provider: OAuthProviderType;
    nonce: string;
    readOnly?: boolean;
    reconnectAccountId?: string;
  };

  const { userId, provider, nonce, readOnly } = payload;

  // Check nonce exists and hasn't expired
  purgeExpiredNonces();
  const pending = pendingFlows.get(nonce);
  if (!pending) {
    throw new Error('OAuth nonce expired or not found');
  }
  if (pending.userId !== userId || pending.provider !== provider) {
    throw new Error('OAuth state mismatch');
  }

  // Consume nonce (single-use)
  pendingFlows.delete(nonce);
  flushPendingFlows();

  // Exchange code for tokens
  const providerInstance = getProviderInstance(provider);
  const tokens = await providerInstance.exchangeCode(code);

  // Encrypt tokens separately
  const accessEnc = encryptApiKey(tokens.accessToken);
  const refreshEnc = encryptApiKey(tokens.refreshToken);

  // Compute expiry timestamp
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();

  // Scopes granted (store the full set we requested)
  const scopes = provider === 'google' ? GOOGLE_SCOPES : MICROSOFT_SCOPES;

  // Reconnect: update existing account's tokens in-place
  if (payload.reconnectAccountId) {
    const accountId = payload.reconnectAccountId;
    await updateOAuthAccount(accountId, {
      access_token: accessEnc.encrypted,
      refresh_token: refreshEnc.encrypted,
      token_iv: accessEnc.iv,
      token_auth_tag: accessEnc.authTag,
      refresh_iv: refreshEnc.iv,
      refresh_auth_tag: refreshEnc.authTag,
      expires_at: expiresAt,
      enabled: 1,
      updated_at: new Date().toISOString(),
    });

    logger.info(
      { accountId, provider, email: tokens.email, userId },
      'OAuth account reconnected',
    );

    return { accountId, provider, email: tokens.email };
  }

  // Store in oauth_accounts
  const accountId = crypto.randomUUID();
  const now = new Date().toISOString();

  await createOAuthAccount({
    id: accountId,
    user_id: userId,
    provider,
    scopes: JSON.stringify(scopes),
    access_token: accessEnc.encrypted,
    refresh_token: refreshEnc.encrypted,
    token_iv: accessEnc.iv,
    token_auth_tag: accessEnc.authTag,
    refresh_iv: refreshEnc.iv,
    refresh_auth_tag: refreshEnc.authTag,
    expires_at: expiresAt,
    email: tokens.email,
    calendar_enabled: 1,
    email_enabled: 1,
    enabled: 1,
  });

  // Create linked email_accounts row so existing email UI/MCP picks it up
  const displayName = provider === 'google' ? 'Gmail' : 'Outlook';
  const emailAccount = createEmailAccount({
    user_id: userId,
    name: `${displayName} (${tokens.email})`,
    email: tokens.email,
    imap_host: '',
    smtp_host: '',
    username: '',
    password: '',
    read_only: pending.readOnly ?? true, // DEFAULT READ ONLY for OAuth
  });
  // Link it to the OAuth account
  updateEmailAccountDb(emailAccount.id, { oauth_account_id: accountId });

  logger.info(
    { accountId, provider, email: tokens.email, userId },
    'OAuth account connected',
  );

  return { accountId, provider, email: tokens.email };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Ensure the access token for an account is fresh. If the token expires
 * within 5 minutes, refreshes it first. Returns the decrypted access token.
 *
 * If refresh fails (token revoked, etc.), disables the account and throws.
 */
export async function ensureFreshToken(accountId: string): Promise<string> {
  const account = await getOAuthAccount(accountId);
  if (!account) {
    throw new Error(`OAuth account not found: ${accountId}`);
  }
  if (!account.enabled) {
    throw new Error(`OAuth account disabled: ${accountId}`);
  }

  const expiresAt = new Date(account.expires_at).getTime();
  const now = Date.now();

  // Token is still fresh — more than 5 minutes until expiry
  if (expiresAt - now > REFRESH_BUFFER_MS) {
    return decryptApiKey(
      account.access_token,
      account.token_iv,
      account.token_auth_tag,
    );
  }

  // Need to refresh
  const refreshToken = decryptApiKey(
    account.refresh_token,
    account.refresh_iv,
    account.refresh_auth_tag,
  );

  const provider = account.provider as OAuthProviderType;
  const providerInstance = getProviderInstance(provider);

  let freshTokens: { accessToken: string; expiresIn: number };
  try {
    freshTokens = await providerInstance.refreshAccessToken(refreshToken);
  } catch (err) {
    // Refresh failed — disable the account
    logger.error(
      { err, accountId, provider },
      'OAuth token refresh failed, disabling account',
    );
    await updateOAuthAccount(accountId, {
      enabled: 0,
      updated_at: new Date().toISOString(),
    });
    throw new Error(
      `Token refresh failed for ${provider} account ${accountId}. Please reconnect.`,
    );
  }

  // Encrypt new access token and update DB
  const accessEnc = encryptApiKey(freshTokens.accessToken);
  const newExpiresAt = new Date(
    Date.now() + freshTokens.expiresIn * 1000,
  ).toISOString();

  await updateOAuthAccount(accountId, {
    access_token: accessEnc.encrypted,
    token_iv: accessEnc.iv,
    token_auth_tag: accessEnc.authTag,
    expires_at: newExpiresAt,
    updated_at: new Date().toISOString(),
  });

  logger.info({ accountId, provider }, 'OAuth access token refreshed');
  return freshTokens.accessToken;
}

/**
 * Convenience wrapper: returns both a fresh access token and the provider name.
 * Used by email.ts to route to the correct provider implementation.
 */
export async function refreshTokenIfNeeded(
  oauthAccountId: string,
): Promise<{ token: string; provider: string }> {
  const account = getOAuthAccount(oauthAccountId);
  if (!account) {
    throw new Error(`OAuth account not found: ${oauthAccountId}`);
  }
  const token = await ensureFreshToken(oauthAccountId);
  return { token, provider: account.provider };
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

/**
 * Revoke an OAuth account. Attempts provider-side revocation (best-effort),
 * then deletes the oauth_accounts row and any linked email_accounts rows.
 */
export async function revokeOAuthAccount(accountId: string): Promise<void> {
  const account = await getOAuthAccount(accountId);
  if (!account) {
    logger.warn({ accountId }, 'OAuth account not found for revocation');
    return;
  }

  const provider = account.provider as OAuthProviderType;

  // Best-effort revocation with provider
  try {
    const accessToken = decryptApiKey(
      account.access_token,
      account.token_iv,
      account.token_auth_tag,
    );
    const providerInstance = getProviderInstance(provider);
    if (
      'revokeToken' in providerInstance &&
      typeof (providerInstance as any).revokeToken === 'function'
    ) {
      await (providerInstance as any).revokeToken(accessToken);
    }
  } catch (err) {
    logger.warn(
      { err, accountId, provider },
      'Provider-side token revocation failed (best-effort)',
    );
  }

  // Delete from oauth_accounts (db function also handles linked email_accounts)
  await deleteOAuthAccount(accountId);

  logger.info({ accountId, provider }, 'OAuth account revoked and deleted');
}
