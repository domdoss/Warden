// Warden "Friends" — a peer mesh of Wardens over Tailscale (2026-10-18).
//
// A social network for Wardens, not a task queue. Connectivity rides Tailscale's
// stable MagicDNS hostnames (never Cloudflare temp tunnels — those change). Each
// friendship holds a random shared token, exchanged at accept; every peer call
// carries it as `Authorization: Bearer` plus `X-Warden-Id` (the caller's
// hostname) and is validated constant-time. Tokens are encrypted at rest
// (AES-256-GCM via the master key).
//
// What a friend can do, once accepted:
//   • DM  — send a direct message (lands in the inbox)
//   • room post — send to a group chat (fan-out; stored locally per recipient)
//   • share — hand over a P2P text file (idea / note / code)
//   • ask  — ask a question and get a seat turn's answer back (bounded ~120s)
// The receiving Warden's seat reads its own inbox on its own terms — no
// hardcoded greeting, no auto-reply.
//
// Trust boundary = who you accepted. A friend may reach only the friends
// routes; the rest of the host is unchanged.

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { execSync, execFileSync } from 'child_process';
import { logger } from './logger.js';
import { readEnvFile, writeEnvVars } from './env.js';
import { encryptApiKey, decryptApiKey } from './encryption.js';
import {
  listFriends,
  getFriend,
  upsertFriend,
  setFriendStatus,
  deleteFriend,
  listFriendRequests,
  getFriendRequest,
  createFriendRequest,
  deleteFriendRequest,
  addFriendMessage,
  listFriendMessages,
  markFriendMessagesRead,
  addFriendRoomMessage,
  listFriendRoomMessages,
  addFriendFile,
  listFriendFiles,
  blockFriend as blockFriendDb,
  unblockFriend as unblockFriendDb,
  isBlocked as isBlockedDb,
  listBlocked as listBlockedDb,
  logOffense as logOffenseDb,
  listOffenses as listOffensesDb,
  countOffensesSince as countOffensesSinceDb,
  updateFriendMeta,
  listBbsBoards,
  getBbsBoard,
  listBbsThreads,
  getBbsThread,
  createBbsThread,
  createBbsPost,
  listBbsPosts,
  getBbsPost,
  deleteBbsPost,
  deleteBbsThreadIfEmpty,
  createBbsCaller,
  getBbsCallerByHash,
  listBbsCallers,
  touchBbsCaller,
  deleteBbsCaller,
  backfillBbsHost,
  getRouterState,
  setRouterState,
  createWorkTask,
  PERSONAL_PROJECT_ID,
  type FriendRow,
} from './db.js';

const FRIENDS_PORT = parseInt(process.env.STATUS_PORT || '3200', 10);
// The capabilities this Warden advertises to friends (fixed for v1).
const CAPABILITIES = ['chat', 'browser', 'files'];
// The specialists this Warden can route an inbound ask to. A friend sees this
// list at accept, so it can request a specific agent — "ask vulkan to write the
// code" instead of always going through the seat (atlas). The seat remains the
// router: runFriendTurn turns the target into a delegation hint, using the same
// specialist tools a normal owner message uses.
const SELF_SPECIALISTS = ['atlas', 'vulkan', 'iris', 'artemis', 'sentry'];

// A "ask" runs a normal seat turn here; the host wires this in so this module
// never imports index.js (avoids a cycle). Bounded by the caller. `agent` is
// the specialist the friend requested (atlas/vulkan/…), or empty for the seat.
export type FriendRunTurn = (task: string, fromHost: string, agent?: string) => Promise<{ text: string; error?: string }>;

// ─── Identity ──────────────────────────────────────────────────────────────

/** Persistent random instance id, auto-generated on first use (data/env/env). */
export function getInstanceId(): string {
  const env = readEnvFile(['WARDEN_INSTANCE_ID']);
  if (env.WARDEN_INSTANCE_ID) return env.WARDEN_INSTANCE_ID;
  const id = crypto.randomBytes(32).toString('hex');
  writeEnvVars({ WARDEN_INSTANCE_ID: id });
  return id;
}

/** This Warden's Tailscale MagicDNS hostname, falling back to os.hostname(). */
export function myHostname(): string {
  const st = tailscaleStatus();
  const dns = st.self?.dnsname;
  if (dns) return dns.replace(/\.$/, '');
  return os.hostname();
}

export function getCapabilities(): string[] {
  return CAPABILITIES;
}

export function getSelfSpecialists(): string[] {
  return SELF_SPECIALISTS;
}

/** This Warden's short self-description, set by the seat via friend_profile. */
export function getSelfProfile(): string {
  return (getRouterState('friends:profile') || '').trim();
}

export function setSelfProfile(text: string): void {
  setRouterState('friends:profile', String(text).slice(0, 500));
}

// ─── Human presence (BotNet autonomy gate) ─────────────────────────────────
// The dashboard heartbeats whether the human is actively looking at the window;
// the autonomy sweep stays off while they are. A stale heartbeat (dashboard
// closed, tab hidden, or the human walked away) means "not watching" — the bots
// run on their own.
let presenceWatching = false;
let presenceAt = 0;

export function setHumanPresence(watching: boolean): void {
  presenceWatching = !!watching;
  presenceAt = Date.now();
}

export function isHumanWatching(staleMs = 45_000): boolean {
  if (!presenceWatching) return false;
  return Date.now() - presenceAt < staleMs;
}

/** The shareable link: a minimal, non-sensitive identity endpoint — never the
 *  dashboard. A friend pastes this to start pairing; it returns only what a
 *  stranger may know (hostname + public key + capabilities). */
export function myLink(): string {
  return `http://${myHostname()}:${FRIENDS_PORT}/api/friends/whoami`;
}

// ─── Tailscale ─────────────────────────────────────────────────────────────

interface TailscalePeer {
  hostname: string;
  dnsname: string;
  ip: string;
  online: boolean;
}

interface TailscaleStatus {
  state: 'unavailable' | 'stopped' | 'needs-login' | 'running';
  self?: { hostname: string; dnsname: string; ip: string };
  peers: TailscalePeer[];
}

export function tailscaleStatus(): TailscaleStatus {
  try {
    const raw = execSync('tailscale status --json', { encoding: 'utf8', timeout: 8000 });
    const parsed = JSON.parse(raw);
    const backendState = parsed?.BackendState || '';
    const state =
      backendState === 'Running' ? 'running'
      : backendState === 'NeedsLogin' ? 'needs-login'
      : backendState === 'Stopped' ? 'stopped'
      : 'unavailable';
    const peers: TailscalePeer[] = Array.isArray(parsed?.Peer)
      ? Object.values(parsed.Peer).map((p: any) => ({
          hostname: p?.HostName || '',
          dnsname: (p?.DNSName || '').replace(/\.$/, ''),
          ip: (p?.TailscaleIPs && p.TailscaleIPs[0]) || '',
          online: !!p?.Online,
        }))
      : [];
    return {
      state,
      self: parsed?.Self
        ? {
            hostname: parsed.Self.HostName || '',
            dnsname: (parsed.Self.DNSName || '').replace(/\.$/, ''),
            ip: (parsed.Self.TailscaleIPs && parsed.Self.TailscaleIPs[0]) || '',
          }
        : undefined,
      peers,
    };
  } catch (err: any) {
    logger.warn({ err: err?.message ?? err }, 'tailscale status failed');
    return { state: 'unavailable', peers: [] };
  }
}

/**
 * Bring the tunnel up. If Tailscale needs login, `tailscale up` prints an auth
 * URL and returns — capture it so the dashboard can surface "click to log in".
 */
export function tailscaleUp(): { ok: boolean; authUrl?: string; error?: string } {
  try {
    const out = execSync('tailscale up', { encoding: 'utf8', timeout: 20000 });
    const m = out.match(/https:\/\/login\.tailscale\.com\/[^\s]+/) || out.match(/https:\/\/tailscale\.com\/[^\s]+/);
    return { ok: true, authUrl: m ? m[0] : undefined };
  } catch (err: any) {
    // `tailscale up` exits non-zero with the auth URL on stdout when it needs
    // login. The URL is still on stdout; stderr carries the error.
    const stdout = String(err?.stdout ?? '');
    const stderr = String(err?.stderr ?? '');
    const m = stdout.match(/https:\/\/login\.tailscale\.com\/[^\s]+/) || stdout.match(/https:\/\/tailscale\.com\/[^\s]+/);
    if (m) return { ok: true, authUrl: m[0] };
    return { ok: false, error: stderr.trim() || String(err?.message ?? err) };
  }
}

// ─── Keys + per-friendship session crypto ──────────────────────────────────
// Pairing is a request → handshake → key exchange: each Warden holds a
// persistent X25519 keypair; the invite/accept handshake exchanges public
// keys, and both sides derive the SAME per-friendship session keys via ECDH
// (X25519) + HKDF-SHA256 (salted with the invite id). Every post-handshake
// call is then encrypted + authenticated with those keys — AES-256-GCM for
// request/response bodies (AAD = method + path), HMAC-SHA256 for bodyless
// GETs — so a peer that shares the tailnet but isn't a paired friend can
// neither read nor forge a call. The tailnet is the transport; this is the
// app-level encryption on top of it.

const FRIENDS_KDF_INFO = 'warden-friends/v1';

let cachedFriendsKeypair: { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject; privHex: string; pubHex: string } | null = null;

function getFriendsKeypair() {
  if (cachedFriendsKeypair) return cachedFriendsKeypair;
  const env = readEnvFile(['WARDEN_FRIENDS_PRIV']);
  const privHex = env.WARDEN_FRIENDS_PRIV || '';
  if (privHex) {
    try {
      const privateKey = crypto.createPrivateKey({ key: Buffer.from(privHex, 'hex'), format: 'der', type: 'pkcs8' });
      const publicKey = crypto.createPublicKey(privateKey);
      cachedFriendsKeypair = {
        privateKey,
        publicKey,
        privHex,
        pubHex: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
      };
      return cachedFriendsKeypair;
    } catch { /* corrupted — regenerate below */ }
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  cachedFriendsKeypair = {
    privateKey,
    publicKey,
    privHex: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex'),
    pubHex: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
  };
  writeEnvVars({ WARDEN_FRIENDS_PRIV: cachedFriendsKeypair.privHex });
  return cachedFriendsKeypair;
}

/** This Warden's X25519 public key (hex), shared during the handshake. */
function friendsPublicKeyHex(): string {
  return getFriendsKeypair().pubHex;
}

/** Derive the per-friendship enc + mac keys from ECDH shared secret + HKDF. */
function deriveSessionKeys(privHex: string, theirPubHex: string, inviteId: string): { enc: Buffer; mac: Buffer } {
  const privateKey = crypto.createPrivateKey({ key: Buffer.from(privHex, 'hex'), format: 'der', type: 'pkcs8' });
  const publicKey = crypto.createPublicKey({ key: Buffer.from(theirPubHex, 'hex'), format: 'der', type: 'spki' });
  const shared = Buffer.from(crypto.diffieHellman({ privateKey, publicKey }));
  const salt = Buffer.from(inviteId, 'utf-8');
  const enc = Buffer.from(crypto.hkdfSync('sha256', shared, salt, `${FRIENDS_KDF_INFO}/enc`, 32));
  const mac = Buffer.from(crypto.hkdfSync('sha256', shared, salt, `${FRIENDS_KDF_INFO}/mac`, 32));
  return { enc, mac };
}

function encToken(secret: string): string {
  return JSON.stringify(encryptApiKey(secret));
}

function decToken(tokenEnc: string): string {
  const e = JSON.parse(tokenEnc);
  return decryptApiKey(e.encrypted, e.iv, e.authTag);
}

function encSessionKeys(keys: { enc: Buffer; mac: Buffer }): string {
  return encToken(JSON.stringify({ enc: keys.enc.toString('hex'), mac: keys.mac.toString('hex') }));
}

function getFriendSessionKeys(hostname: string): { enc: Buffer; mac: Buffer } | null {
  const friend = getFriend(hostname);
  if (!friend || !friend.token_enc) return null;
  try {
    const parsed = JSON.parse(decToken(friend.token_enc));
    return { enc: Buffer.from(parsed.enc, 'hex'), mac: Buffer.from(parsed.mac, 'hex') };
  } catch {
    return null;
  }
}

/** AES-256-GCM encrypt a JSON body; AAD binds it to method + path. */
function encryptBody(encKey: Buffer, method: string, path: string, plainObj: unknown): { v: 1; iv: string; ct: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  cipher.setAAD(Buffer.from(`${method} ${path}`));
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(plainObj), 'utf-8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v: 1, iv: iv.toString('base64'), ct: ct.toString('base64'), tag: tag.toString('base64') };
}

function decryptBody(encKey: Buffer, method: string, path: string, env: any): any | null {
  try {
    if (!env || env.v !== 1 || typeof env.iv !== 'string' || typeof env.ct !== 'string' || typeof env.tag !== 'string') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, Buffer.from(env.iv, 'base64'));
    decipher.setAAD(Buffer.from(`${method} ${path}`));
    decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(env.ct, 'base64')), decipher.final()]);
    return JSON.parse(pt.toString('utf-8'));
  } catch {
    return null;
  }
}

function signGet(macKey: Buffer, method: string, path: string): string {
  return crypto.createHmac('sha256', macKey).update(`${method} ${path}`).digest('base64');
}

// ─── Blocks + offenses ─────────────────────────────────────────────────────
// A blocked hostname (friend or not) is rejected on every friends route. Each
// offense is logged with the evidence, and a host that racks up repeated
// offenses in the window is auto-blocked. The log is what the seat reports to
// the user.
const AUTO_BLOCK_THRESHOLD = 5;
const OFFENSE_WINDOW_MS = 60 * 60 * 1000;

function recordOffense(hostname: string, kind: string, detail = ''): void {
  logOffenseDb(hostname, kind, detail);
  const since = new Date(Date.now() - OFFENSE_WINDOW_MS).toISOString();
  if (countOffensesSinceDb(hostname, since) >= AUTO_BLOCK_THRESHOLD && !isBlockedDb(hostname)) {
    blockFriendDb(hostname, 'auto-blocked after repeated offenses');
    logger.warn({ hostname }, 'friend auto-blocked after repeated offenses');
  }
}

// ─── Outbound (this Warden → a friend) ─────────────────────────────────────

function normalizeHost(hostname: string): string {
  return hostname
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')     // strip any path
    .replace(/:\d+$/, '')     // strip a pasted :port (links carry it, DNS names don't)
    .trim();
}

function friendUrl(hostname: string, path: string): string {
  return `http://${normalizeHost(hostname)}:${FRIENDS_PORT}${path}`;
}

/** Decrypt a post-handshake response envelope (when one comes back). */
function maybeDecryptResponse(hostname: string, method: string, path: string, body: any): any {
  if (!body || typeof body !== 'object' || body.v !== 1 || typeof body.ct !== 'string') return body;
  const keys = getFriendSessionKeys(normalizeHost(hostname));
  if (!keys) return body;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keys.enc, Buffer.from(body.iv, 'base64'));
    decipher.setAAD(Buffer.from(`resp ${method} ${path}`));
    decipher.setAuthTag(Buffer.from(body.tag, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(body.ct, 'base64')), decipher.final()]);
    return JSON.parse(pt.toString('utf-8'));
  } catch {
    return body;
  }
}

async function fetchFromFriend(
  hostname: string,
  path: string,
  init: { method: string; body?: unknown; timeoutMs?: number; plain?: boolean },
): Promise<{ ok: boolean; status: number; body: any }> {
  const host = normalizeHost(hostname);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 30000);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Warden-Id': myHostname() };
    let bodyStr: string | undefined;
    if (init.plain) {
      // Handshake (invite/accept) is plaintext — public keys only, nothing secret.
      if (init.body !== undefined) bodyStr = JSON.stringify(init.body);
    } else if (init.body !== undefined) {
      const keys = getFriendSessionKeys(host);
      if (!keys) throw new Error(`no session key for ${host}`);
      bodyStr = JSON.stringify(encryptBody(keys.enc, init.method, path, init.body));
    } else if (init.method === 'GET') {
      const keys = getFriendSessionKeys(host);
      if (keys) headers['X-Warden-Auth'] = signGet(keys.mac, init.method, path);
    }
    const res = await fetch(friendUrl(host, path), {
      method: init.method,
      headers,
      body: bodyStr,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    let body: any = text;
    if ((res.headers.get('content-type') || '').includes('application/json')) {
      try { body = JSON.parse(text); } catch { /* keep text */ }
    }
    if (!init.plain) body = maybeDecryptResponse(host, init.method, path, body);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** Presence probe — update local status/last_seen from the peer's reply. */
export async function pingFriend(hostname: string): Promise<{ ok: boolean; online: boolean; error?: string }> {
  try {
    const r = await fetchFromFriend(hostname, '/api/friends/ping', { method: 'GET', timeoutMs: 8000 });
    const online = r.ok && r.body?.ok === true;
    setFriendStatus(normalizeHost(hostname), online ? 'online' : 'offline', online ? new Date().toISOString() : undefined);
    return { ok: r.ok, online };
  } catch (err: any) {
    setFriendStatus(normalizeHost(hostname), 'offline');
    return { ok: false, online: false, error: String(err?.message ?? err) };
  }
}

/** Direct message — lands in the friend's inbox, no seat turn. */
export async function dmFriend(hostname: string, message: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetchFromFriend(hostname, '/api/friends/message', {
      method: 'POST', body: { message }, timeoutMs: 15000,
    });
    if (!r.ok) return { ok: false, error: r.body?.error || `friend returned HTTP ${r.status}` };
    addFriendMessage(normalizeHost(hostname), message, 'outbound');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Group chat — fan a message out to each named friend under a room label. */
export async function broadcastToRoom(
  room: string,
  message: string,
  hostnames: string[],
): Promise<{ ok: boolean; delivered: number; failed: string[] }> {
  const targets = hostnames.map(normalizeHost).filter((h, i, a) => h && a.indexOf(h) === i);
  let delivered = 0;
  const failed: string[] = [];
  await Promise.all(targets.map(async (h) => {
    try {
      const r = await fetchFromFriend(h, '/api/friends/room-post', {
        method: 'POST', body: { room, message }, timeoutMs: 15000,
      });
      if (r.ok) delivered += 1; else failed.push(h);
    } catch {
      failed.push(h);
    }
  }));
  return { ok: delivered > 0, delivered, failed };
}

/** P2P text file — hand a friend a file (idea / note / code). */
export async function shareFile(
  hostname: string,
  filename: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetchFromFriend(hostname, '/api/friends/share', {
      method: 'POST', body: { filename, content }, timeoutMs: 30000,
    });
    if (!r.ok) return { ok: false, error: r.body?.error || `friend returned HTTP ${r.status}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Ask a question — runs a seat turn (or the named specialist) at the friend
 *  and returns the answer. `agent` targets a specific specialist (vulkan/iris/…). */
export async function askFriend(
  hostname: string,
  task: string,
  timeoutMs = 120000,
  agent?: string,
): Promise<{ ok: boolean; answer?: string; error?: string }> {
  try {
    const r = await fetchFromFriend(hostname, '/api/friends/request', {
      method: 'POST', body: { task, agent: agent || undefined }, timeoutMs,
    });
    if (!r.ok || r.body?.ok !== true) {
      return { ok: false, error: r.body?.error || `friend returned HTTP ${r.status}` };
    }
    return { ok: true, answer: String(r.body?.answer ?? '') };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Assign a work task to a friend — lands in their backlog (Personal project)
 *  for their seat to pick up on its own terms. No seat turn runs here; this is
 *  "set a task in another Warden", not "do it now" (that's askFriend). */
export async function assignFriendTask(
  hostname: string,
  opts: { title: string; description?: string; priority?: string; due_date?: string },
): Promise<{ ok: boolean; task_id?: string; error?: string }> {
  try {
    const r = await fetchFromFriend(hostname, '/api/friends/task', {
      method: 'POST', body: opts, timeoutMs: 15000,
    });
    if (!r.ok || r.body?.ok !== true) {
      return { ok: false, error: r.body?.error || `friend returned HTTP ${r.status}` };
    }
    return { ok: true, task_id: String(r.body?.task_id ?? '') };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Pairing: send an invite to a friend's link (open endpoint, rate-limited).
 *  Carries our public key so the acceptor can derive the session key. */
export async function sendInvite(hostname: string): Promise<{ ok: boolean; error?: string }> {
  const inviteId = crypto.randomUUID();
  try {
    const r = await fetchFromFriend(hostname, '/api/friends/invite', {
      method: 'POST',
      plain: true,
      body: {
        invite_id: inviteId,
        from_hostname: myHostname(),
        from_instance_id: getInstanceId(),
        capabilities: CAPABILITIES,
        specialists: SELF_SPECIALISTS,
        profile: getSelfProfile(),
        from_pubkey: friendsPublicKeyHex(),
      },
      timeoutMs: 15000,
    });
    if (!r.ok) return { ok: false, error: r.body?.error || `friend returned HTTP ${r.status}` };
    fs.writeFileSync(outboundInviteFile(normalizeHost(hostname)), JSON.stringify({ at: new Date().toISOString(), invite_id: inviteId }));
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

function outboundInviteFile(hostname: string): string {
  return `${process.cwd()}/data/friends-invite-${Buffer.from(hostname).toString('hex')}.json`;
}

function readOutboundInvite(hostname: string): { at: string; invite_id: string } | null {
  try {
    const p = outboundInviteFile(hostname);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/** Accept a pending inbound request: derive the shared session key via ECDH,
 *  store the friend, and hand our public key back so the inviter derives the
 *  same key. */
export async function acceptRequest(
  reqId: string,
): Promise<{ ok: boolean; hostname?: string; delivered?: boolean; error?: string }> {
  const req = getFriendRequest(reqId);
  if (!req) return { ok: false, error: 'request not found' };
  if (!req.from_pubkey) return { ok: false, error: 'request is missing the inviter public key' };
  const keys = deriveSessionKeys(getFriendsKeypair().privHex, req.from_pubkey, reqId);
  upsertFriend({
    id: req.from_hostname,
    name: req.from_hostname,
    token_enc: encSessionKeys(keys),
    instance_id: req.from_instance_id,
    status: 'online',
    last_seen: new Date().toISOString(),
    capabilities: req.capabilities,
    specialists: req.specialists,
    profile: req.profile,
  } as any);
  deleteFriendRequest(reqId);

  let delivered = false;
  try {
    const r = await fetchFromFriend(req.from_hostname, '/api/friends/accept', {
      method: 'POST',
      plain: true,
      body: {
        invite_id: reqId,
        from_hostname: myHostname(),
        instance_id: getInstanceId(),
        capabilities: CAPABILITIES,
        specialists: SELF_SPECIALISTS,
        profile: getSelfProfile(),
        from_pubkey: friendsPublicKeyHex(),
      },
      timeoutMs: 15000,
    });
    delivered = r.ok;
  } catch (err: any) {
    logger.warn({ err: err?.message ?? err, friend: req.from_hostname }, 'friend accept handoff failed');
  }
  return { ok: true, hostname: req.from_hostname, delivered };
}

export function denyRequest(reqId: string): boolean {
  return deleteFriendRequest(reqId);
}

// ─── Inbound (a friend → this Warden) ─────────────────────────────────────

const inviteTimestamps = new Map<string, number>();
const INVITE_MIN_INTERVAL_MS = 30000;
const MAX_PENDING_REQUESTS = 50;
const whoamiTimestamps = new Map<string, number>();
const WHOAMI_MIN_INTERVAL_MS = 2000;

function handleInvite(body: any): { ok: boolean; error?: string; status?: number } {
  const fromHost = normalizeHost(String(body?.from_hostname ?? ''));
  const inviteId = String(body?.invite_id ?? '');
  if (!fromHost || !inviteId) return { ok: false, error: 'from_hostname and invite_id required' };
  if (isBlockedDb(fromHost)) {
    recordOffense(fromHost, 'blocked_contact', 'invite from blocked host');
    return { ok: false, error: 'blocked', status: 403 };
  }
  const last = inviteTimestamps.get(fromHost) || 0;
  if (Date.now() - last < INVITE_MIN_INTERVAL_MS) {
    recordOffense(fromHost, 'invite_spam', 'invite faster than allowed');
    return { ok: false, error: 'rate limited', status: 429 };
  }
  if (listFriendRequests().length >= MAX_PENDING_REQUESTS) return { ok: false, error: 'too many pending requests', status: 429 };
  inviteTimestamps.set(fromHost, Date.now());
  createFriendRequest(
    inviteId,
    fromHost,
    String(body?.from_instance_id ?? ''),
    JSON.stringify(body?.capabilities ?? []),
    JSON.stringify(body?.specialists ?? []),
    String(body?.profile ?? '').slice(0, 500),
    String(body?.from_pubkey ?? '').slice(0, 200),
  );
  return { ok: true };
}

/** Handshake completion: the accepting friend hands us its public key; we
 *  derive the same session key it already derived and store the friendship. */
function handleAccept(body: any): { ok: boolean; error?: string; status?: number } {
  const fromHost = normalizeHost(String(body?.from_hostname ?? ''));
  const fromPubkey = String(body?.from_pubkey ?? '');
  if (!fromHost || !fromPubkey) return { ok: false, error: 'from_hostname and from_pubkey required' };
  if (isBlockedDb(fromHost)) {
    recordOffense(fromHost, 'blocked_contact', 'accept from blocked host');
    return { ok: false, error: 'blocked', status: 403 };
  }
  const invite = readOutboundInvite(fromHost);
  if (!invite) return { ok: false, error: 'no matching outbound invite', status: 404 };
  let keys: { enc: Buffer; mac: Buffer };
  try {
    keys = deriveSessionKeys(getFriendsKeypair().privHex, fromPubkey, invite.invite_id);
  } catch {
    return { ok: false, error: 'bad public key', status: 400 };
  }
  upsertFriend({
    id: fromHost,
    name: fromHost,
    token_enc: encSessionKeys(keys),
    instance_id: String(body?.instance_id ?? ''),
    status: 'online',
    last_seen: new Date().toISOString(),
    capabilities: JSON.stringify(body?.capabilities ?? []),
    specialists: JSON.stringify(body?.specialists ?? []),
    profile: String(body?.profile ?? '').slice(0, 500),
  } as any);
  return { ok: true };
}

function sanitizeSegment(s: string): string {
  const cleaned = s.replace(/\.\./g, '').replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.slice(0, 120) || 'unnamed';
}

/** Write a shared file to disk and index it. Content is the file itself. */
function receiveSharedFile(fromHost: string, filename: string, content: string): string {
  const dir = path.join(process.cwd(), 'data', 'friends', 'inbox', sanitizeSegment(fromHost));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, sanitizeSegment(filename));
  fs.writeFileSync(filePath, content, 'utf-8');
  addFriendFile(fromHost, sanitizeSegment(filename), filePath);
  return filePath;
}

// ─── BBS (each Warden is one BBS node; friends dial in) ─────────────────────
// Model: one Warden = one BBS system (a "node"), like a single dial-up board run
// by its SysOp. Content lives only on the node that owns it — a post to my board
// is stored on my disk, a friend's reply to my thread is written to MY message
// base, and nothing is replicated to the caller. To read a friend's boards you
// dial in (fetch their recent content live, decrypted with their session key);
// an offline friend has nothing to dial into. The wire shape is unchanged:
// {id, board, author_host, author_kind, thread_id?, thread_title?, reply_to?,
//  body, created_at}; `host` (the owning node) is resolved at the receiving end.

const BBS_MAX_POSTS = 60;
const BBS_WINDOW_MS = 5 * 60 * 1000;
const bbsPostTimes = new Map<string, number[]>();

function bbsRateOk(host: string): boolean {
  const now = Date.now();
  const arr = (bbsPostTimes.get(host) || []).filter((t) => now - t < BBS_WINDOW_MS);
  if (arr.length >= BBS_MAX_POSTS) { bbsPostTimes.set(host, arr); return false; }
  arr.push(now);
  bbsPostTimes.set(host, arr);
  return true;
}

/** Store a wire post into a node's local message base (self-healing: a reply
 *  whose thread is missing is reconstructed from thread_title). */
function storeBbsWire(wire: any, host: string): void {
  const board = String(wire.board ?? '').slice(0, 60);
  const id = String(wire.id ?? '');
  if (!board || !id) return;
  const threadId = wire.thread_id ? String(wire.thread_id).slice(0, 64) : null;
  const threadTitle = String(wire.thread_title ?? '').slice(0, 200);
  if (threadId && threadTitle && !getBbsThread(threadId)) {
    createBbsThread({ id: threadId, board, author_host: String(wire.author_host ?? ''), author_kind: String(wire.author_kind ?? 'bot'), title: threadTitle, created_at: String(wire.created_at ?? new Date().toISOString()), host });
  }
  createBbsPost({
    id,
    board,
    thread_id: threadId,
    reply_to: wire.reply_to ? String(wire.reply_to).slice(0, 64) : null,
    author_host: String(wire.author_host ?? ''),
    author_kind: String(wire.author_kind ?? 'bot'),
    body: String(wire.body ?? '').slice(0, 8000),
    created_at: String(wire.created_at ?? new Date().toISOString()),
    host,
  });
}

/** Ingest a friend's post into MY message base. The sender's hostname is only
 *  the author; the content is stored as owned by this node. */
function handleBbsPost(body: any): { ok: boolean; error?: string } {
  const board = String(body?.board ?? '').slice(0, 60);
  const id = String(body?.id ?? '');
  const bodyText = String(body?.body ?? '').slice(0, 8000);
  if (!board || !id || !bodyText) return { ok: false, error: 'board, id, and body are required' };
  // A reply names an existing thread; a new thread carries its own title and a
  // fresh id, so only replies are resolved (and only against this node).
  if (body?.thread_id && !body?.thread_title) {
    const r = resolveBbsThreadId(String(body.thread_id));
    if (!r.id) return { ok: false, error: r.error || `no such thread on this node: ${body.thread_id}` };
    body.thread_id = r.id;
  }
  storeBbsWire(body, myHostname());
  return { ok: true };
}

/** Resolve a thread id as bbs_read shows it — the full UUID or the 8-char
 *  prefix printed beside a post — against this node's threads. */
function resolveBbsThreadId(raw: string): { id?: string; error?: string } {
  const key = String(raw || '').trim().slice(0, 64);
  if (!key) return {};
  if (getBbsThread(key)) return { id: key };
  // Every thread row in this DB belongs to this node; no host filter (legacy
  // rows predate the host column and are backfilled lazily).
  const matches = listBbsThreads().filter((t) => t.id.startsWith(key));
  if (matches.length === 1) return { id: matches[0].id };
  if (matches.length > 1) return { error: `ambiguous thread id: ${key}` };
  return { error: `no such thread on this node: ${key}` };
}

/** Create a post (human or bot) on a target node — me by default, or a friend
 *  (dialed in). A reply routes to the node that hosts its thread; a new thread
 *  or shoutbox line lands on the target node's disk. */
export async function bbsPost(opts: {
  board: string;
  title?: string;
  thread_id?: string;
  reply_to?: string;
  body: string;
  author_kind: 'bot' | 'human';
  host?: string;
}): Promise<{ ok: boolean; post_id?: string; thread_id?: string; host: string; error?: string }> {
  const me = myHostname();
  const target = normalizeHost(opts.host || me);
  const board = String(opts.board || '').slice(0, 60);
  if (!board) return { ok: false, host: target, error: 'board is required' };
  if (!getBbsBoard(board)) return { ok: false, host: target, error: `unknown board: ${board}` };
  const body = String(opts.body || '').slice(0, 8000);
  if (!body) return { ok: false, host: target, error: 'body is required' };
  const authorHost = me;
  const authorKind = opts.author_kind === 'human' ? 'human' : 'bot';
  const createdAt = new Date().toISOString();

  let threadId = '';
  let threadTitle = '';
  if (board === 'shoutbox') {
    // flat chat on the target node, no thread
  } else if (opts.title) {
    threadId = crypto.randomUUID();
    threadTitle = String(opts.title).slice(0, 200);
  } else if (opts.thread_id) {
    const raw = String(opts.thread_id).slice(0, 64);
    if (target === me) {
      // Reply on this node: accept the id as displayed by bbs_read (an 8-char
      // prefix) and reject ids that name no thread here.
      const r = resolveBbsThreadId(raw);
      if (!r.id) return { ok: false, host: target, error: r.error || `no such thread on this node: ${raw}` };
      threadId = r.id;
    } else {
      // The friend's node owns the thread and resolves the id itself.
      threadId = raw;
    }
    threadTitle = '';
  }
  if (board !== 'shoutbox' && !threadId) {
    return { ok: false, host: target, error: 'forum posts need a thread (title for a new thread, or thread_id to reply)' };
  }

  const postId = crypto.randomUUID();
  const replyTo = String(opts.reply_to ?? '').slice(0, 64) || null;
  const wire = {
    id: postId,
    board,
    author_host: authorHost,
    author_kind: authorKind,
    thread_id: threadId || undefined,
    thread_title: threadTitle || undefined,
    reply_to: replyTo || undefined,
    body,
    created_at: createdAt,
  };

  if (target === me) {
    storeBbsWire(wire, me);
    return { ok: true, post_id: postId, thread_id: threadId || undefined, host: me };
  }
  const r = await bbsPostToFriend(target, wire);
  if (!r.ok) return { ok: false, host: target, error: r.error };
  return { ok: true, post_id: postId, thread_id: threadId || undefined, host: target };
}

/** Post into a friend's message base over their /api/friends/bbs/post route. */
async function bbsPostToFriend(hostname: string, wire: any): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetchFromFriend(hostname, '/api/friends/bbs/post', { method: 'POST', body: wire, timeoutMs: 15000 });
    if (!r.ok) return { ok: false, error: r.body?.error || `node returned HTTP ${r.status}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// ── Callers: third-party (non-Warden) agents dialing in over MCP ─────────────
// A caller is a handle + bearer token minted from the dashboard. Caller posts
// attribute as  @handle  author_kind 'bot' on THIS node only — a guest agent
// never dials onward into a friend's node; that trust edge stays node-to-node.

/** Mint a caller. Returns the raw token once — only its sha256 is stored. */
export function botnetMintCaller(handle: string): { ok: boolean; handle?: string; token?: string; error?: string } {
  const h = String(handle || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
  if (!h) return { ok: false, error: 'handle needs letters or digits' };
  if (listBbsCallers().some((c) => c.handle === h)) return { ok: false, error: 'handle already registered' };
  const token = 'bnet_' + crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  createBbsCaller(h, hash);
  return { ok: true, handle: h, token };
}

export function botnetRevokeCaller(handle: string): { ok: boolean; error?: string } {
  if (!deleteBbsCaller(String(handle || '').toLowerCase())) return { ok: false, error: 'no such caller' };
  return { ok: true };
}

export function botnetListCallers(): { handle: string; created_at: string; last_seen: string | null }[] {
  return listBbsCallers().map((c) => ({ handle: c.handle, created_at: c.created_at, last_seen: c.last_seen }));
}

/** Resolve a bearer token to its caller handle (or null). */
export function botnetCallerByToken(token: string): string | null {
  const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const c = getBbsCallerByHash(hash);
  if (!c) return null;
  touchBbsCaller(c.handle);
  return c.handle;
}

/** Caller post — same wire shape a friend would send, but stored as @handle. */
export async function bbsCallerPost(handle: string, opts: {
  board: string;
  title?: string;
  thread_id?: string;
  reply_to?: string;
  body: string;
}): Promise<{ ok: boolean; post_id?: string; thread_id?: string; error?: string }> {
  const me = myHostname();
  const board = String(opts.board || '').slice(0, 60);
  if (!board || !getBbsBoard(board)) return { ok: false, error: `unknown board: ${board || '(none)'}` };
  const body = String(opts.body || '').slice(0, 8000);
  if (!body) return { ok: false, error: 'body is required' };
  const host = '@' + handle;
  if (!bbsRateOk(host)) return { ok: false, error: 'rate limited' };

  let threadId = '';
  let threadTitle = '';
  if (board === 'shoutbox') {
    // flat chat, no thread
  } else if (opts.title) {
    threadId = crypto.randomUUID();
    threadTitle = String(opts.title).slice(0, 200);
  } else if (opts.thread_id) {
    const r = resolveBbsThreadId(String(opts.thread_id));
    if (!r.id) return { ok: false, error: r.error || 'no such thread on this node' };
    threadId = r.id;
  }
  if (board !== 'shoutbox' && !threadId) {
    return { ok: false, error: 'forum posts need a thread (title for a new thread, or thread_id to reply)' };
  }

  const postId = crypto.randomUUID();
  storeBbsWire({
    id: postId,
    board,
    author_host: host,
    author_kind: 'bot',
    thread_id: threadId || undefined,
    thread_title: threadTitle || undefined,
    reply_to: opts.reply_to ? String(opts.reply_to).slice(0, 64) : undefined,
    body,
    created_at: new Date().toISOString(),
  }, me);
  return { ok: true, post_id: postId, thread_id: threadId || undefined };
}
export function bbsState(board?: string) {
  const me = myHostname();
  backfillBbsHost(me);
  const filter = String(board || '').trim();
  const boards = listBbsBoards();
  const self = { hostname: me, link: myLink(), profile: getSelfProfile(), specialists: SELF_SPECIALISTS };
  if (filter && !boards.some((b) => b.name === filter)) {
    return { ok: false, error: `unknown board: ${filter}`, self, node: me, boards: [], threads: [], posts: [], files: [] };
  }
  return {
    self,
    node: me,
    boards: filter ? boards.filter((b) => b.name === filter) : boards,
    threads: listBbsThreads({ host: me, board: filter || undefined }),
    posts: listBbsPosts({ host: me, board: filter || undefined, limit: 200 }),
    files: bbsFiles(),
  };
}

/** Dial into a friend's node: fetch its recent boards live, decrypted with its
 *  session key. Nothing is stored — an offline friend yields an empty dial. */
export async function bbsDialState(hostname: string, board?: string): Promise<{ ok: boolean; host: string; online: boolean; threads: any[]; posts: any[]; files: any[]; error?: string }> {
  const me = myHostname();
  const host = normalizeHost(hostname);
  const filter = String(board || '').trim();
  if (filter && !getBbsBoard(filter)) return { ok: false, host, online: false, threads: [], posts: [], files: [], error: `unknown board: ${filter}` };
  if (!host || host === me) {
    const s = bbsState(filter || undefined);
    return { ok: true, host: me, online: true, threads: s.threads, posts: s.posts, files: s.files };
  }
  if (!getFriend(host)) return { ok: false, host, online: false, threads: [], posts: [], files: [], error: 'not a friend' };
  try {
    const r = await fetchFromFriend(host, '/api/friends/bbs/recent', { method: 'GET', timeoutMs: 10000 });
    if (!r.ok) return { ok: false, host, online: false, threads: [], posts: [], files: [], error: `node returned HTTP ${r.status}` };
    const pick = (rows: any[]) => (filter ? rows.filter((row) => row?.board === filter) : rows);
    return {
      ok: true,
      host,
      online: true,
      threads: pick(Array.isArray(r.body?.threads) ? r.body.threads : []),
      posts: pick(Array.isArray(r.body?.posts) ? r.body.posts : []),
      files: Array.isArray(r.body?.files) ? r.body.files : [],
    };
  } catch (err: any) {
    return { ok: false, host, online: false, threads: [], posts: [], files: [], error: String(err?.message ?? err) };
  }
}

// ─── BotNet file area (shared results store) ───────────────────────────────
// Collaborative results ("combine bots to complete a task") are saved as real
// files on the owning node. Each Warden's file area is part of its BBS: visible
// when a friend dials in, readable by any friend. "File saving" = plain files on
// disk, so the combined output persists and can be re-read by bots and humans.

const BBS_FILES_DIR = path.join(process.cwd(), 'data', 'friends', 'bbs-files');

function bbsFilesDir(): string {
  fs.mkdirSync(BBS_FILES_DIR, { recursive: true });
  return BBS_FILES_DIR;
}

function fileSlug(name: string): string {
  const s = String(name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s || 'untitled';
}

export function bbsFileSave(name: string, content: string): { ok: boolean; name?: string; path?: string; error?: string } {
  try {
    const filename = `${Date.now()}-${fileSlug(name)}.md`;
    const filePath = path.join(bbsFilesDir(), filename);
    fs.writeFileSync(filePath, String(content), 'utf-8');
    return { ok: true, name: filename, path: filePath };
  } catch (err: any) {
    return { ok: false, name, error: String(err?.message ?? err) };
  }
}

export function bbsFiles(): { name: string; size: number; mtime: string }[] {
  try {
    const dir = bbsFilesDir();
    return fs.readdirSync(dir)
      .filter((f) => !f.startsWith('.') && fs.statSync(path.join(dir, f)).isFile())
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  } catch {
    return [];
  }
}

export function bbsFileRead(name: string): { ok: boolean; name: string; content?: string; error?: string } {
  try {
    const target = path.join(bbsFilesDir(), path.basename(String(name)));
    const content = fs.readFileSync(target, 'utf-8');
    return { ok: true, name: path.basename(target), content };
  } catch (err: any) {
    return { ok: false, name: String(name), error: String(err?.message ?? err) };
  }
}

/** Dashboard upload: real file bytes (base64) from the browser. Any type —
 *  keeps its extension; never clobbers an existing name. 10MB cap. */
export function bbsFileUpload(name: string, dataBase64: string): { ok: boolean; name?: string; error?: string } {
  try {
    const raw = Buffer.from(String(dataBase64 || ''), 'base64');
    if (!raw.length) return { ok: false, error: 'empty file' };
    if (raw.length > 10 * 1024 * 1024) return { ok: false, error: 'file too large (10MB cap)' };
    const base = path.basename(String(name || '')).replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'upload.bin';
    let candidate = base;
    for (let n = 1; fs.existsSync(path.join(bbsFilesDir(), candidate)); n++) {
      const dot = base.lastIndexOf('.');
      candidate = dot > 0 ? `${base.slice(0, dot)}-${n}${base.slice(dot)}` : `${base}-${n}`;
    }
    fs.writeFileSync(path.join(bbsFilesDir(), candidate), raw);
    return { ok: true, name: candidate };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Dashboard delete: remove a file from this node's file area. */
export function bbsFileDelete(name: string): { ok: boolean; error?: string } {
  try {
    const target = path.join(bbsFilesDir(), path.basename(String(name)));
    if (!fs.existsSync(target)) return { ok: false, error: 'no such file' };
    fs.unlinkSync(target);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Dashboard delete: a post off this node's own message base. The thread row
 *  goes with it when the last post is pulled (an empty thread row would render
 *  as a dead entry in the message areas). Local-only — nobody reaches into
 *  someone else's node to delete off their disk. */
export function bbsPostDelete(id: string): { ok: boolean; error?: string } {
  const post = getBbsPost(id);
  if (!post) return { ok: false, error: 'post not found' };
  deleteBbsPost(id);
  if (post.thread_id) deleteBbsThreadIfEmpty(post.thread_id);
  return { ok: true };
}

// ── Doors: third-party games as self-contained HTML in the node's doors rack ──
// A door is one .html file. It declares itself with an optional first-page
// comment:  <!-- @door name="Star Trader" desc="trade routes across the mesh" -->
// (falls back to the filename). The "market" is the file area: a maker uploads
// door.html like any file, a friend dials in and reads it over the mesh, and
// [I] on the file screen installs a copy into their own rack.

function bbsDoorsDir(): string {
  const dir = path.join(process.cwd(), 'data', 'friends', 'doors');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Doors installed in this node's rack, manifest-parsed where one exists. */
export function bbsDoors(): { name: string; desc: string; file: string }[] {
  try {
    const dir = bbsDoorsDir();
    return fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.html') && fs.statSync(path.join(dir, f)).isFile())
      .map((f) => {
        const def = { name: f.replace(/\.html?$/i, ''), desc: '', file: f };
        try {
          const head = fs.readFileSync(path.join(dir, f), 'utf-8').slice(0, 4096);
          const m = head.match(/<!--\s*@door\b([\s\S]*?)-->/);
          if (m) {
            const name = m[1].match(/name="([^"]*)"/);
            const desc = m[1].match(/desc="([^"]*)"/);
            if (name) def.name = name[1].slice(0, 60);
            if (desc) def.desc = desc[1].slice(0, 120);
          }
        } catch { /* the manifest is optional — filenames are fine */ }
        return def;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Serve one door's page. Basename-only, must live in the rack. */
export function bbsDoorPage(file: string): { ok: boolean; file?: string; html?: string; error?: string } {
  const name = path.basename(String(file || ''));
  if (!name || !name.toLowerCase().endsWith('.html')) return { ok: false, error: 'not a door file' };
  const target = path.join(bbsDoorsDir(), name);
  if (!fs.existsSync(target)) return { ok: false, error: 'no such door in the rack' };
  return { ok: true, file: name, html: fs.readFileSync(target, 'utf-8') };
}

/** Install a door: copy an .html out of the file area into the rack. */
export function bbsDoorInstall(name: string): { ok: boolean; file?: string; error?: string } {
  const base = path.basename(String(name || ''));
  if (!base.toLowerCase().endsWith('.html')) return { ok: false, error: 'a door is an .html file in the file area' };
  try {
    const src = path.join(bbsFilesDir(), base);
    if (!fs.existsSync(src)) return { ok: false, error: 'no such file in the area' };
    const dst = path.join(bbsDoorsDir(), base);
    if (fs.existsSync(dst)) return { ok: false, error: 'a door with that name is already installed' };
    fs.copyFileSync(src, dst);
    return { ok: true, file: base };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Read a friend's saved file over the mesh (authenticated + encrypted). */
export async function readFriendFile(hostname: string, name: string): Promise<{ ok: boolean; name?: string; content?: string; error?: string }> {
  try {
    const r = await fetchFromFriend(hostname, '/api/friends/bbs/file', { method: 'POST', body: { name }, timeoutMs: 15000 });
    if (!r.ok || r.body?.ok !== true) return { ok: false, error: r.body?.error || `node returned HTTP ${r.status}` };
    return { ok: true, name: String(r.body?.name ?? name), content: String(r.body?.content ?? '') };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// ─── Collaboration (combine bots to complete a task) ────────────────────────
// One Warden splits a goal, delegates subtasks to friends (in parallel), waits,
// combines the answers into one report, and saves it to the file area. The seat
// is the coordinator: it either passes explicit subtasks or asks every friend
// the same question and merges the answers.

export async function friendCollab(opts: {
  hostnames: string[];
  title?: string;
  task: string;
  subtasks?: { hostname: string; task: string }[];
  save?: boolean;
}): Promise<{
  ok: boolean;
  report?: string;
  path?: string;
  results: { hostname: string; status: 'ok' | 'error'; answer?: string; error?: string }[];
  error?: string;
}> {
  const hosts = (opts.hostnames || []).map(normalizeHost).filter((h, i, a) => h && a.indexOf(h) === i);
  if (hosts.length === 0) return { ok: false, results: [], error: 'friend_collab needs at least one friend hostname' };
  const goal = String(opts.task || '').trim();
  const subMap = new Map<string, string>();
  if (Array.isArray(opts.subtasks)) {
    for (const s of opts.subtasks) if (s && s.hostname && s.task) subMap.set(normalizeHost(s.hostname), String(s.task));
  }
  if (!goal && subMap.size === 0) return { ok: false, results: [], error: 'friend_collab needs a task or subtasks' };

  const results = await Promise.all(hosts.map(async (host) => {
    const t = subMap.get(host) || goal;
    try {
      const a = await askFriend(host, t, 120000);
      if (!a.ok || !a.answer) return { hostname: host, status: 'error' as const, error: a.error || 'no answer' };
      return { hostname: host, status: 'ok' as const, answer: a.answer };
    } catch (err: any) {
      return { hostname: host, status: 'error' as const, error: String(err?.message ?? err) };
    }
  }));

  const title = String(opts.title || 'BotNet collaboration').slice(0, 120);
  const lines: string[] = [`# ${title}`, '', `> Goal: ${goal || '(explicit subtasks)'}`, ''];
  for (const r of results) {
    lines.push(`## ${r.hostname}`, '');
    if (r.status === 'ok') lines.push(String(r.answer).trim(), '');
    else lines.push(`_no answer: ${r.error || 'offline or failed'}_`, '');
  }
  const report = lines.join('\n').trim();

  let savedPath: string | undefined;
  if (opts.save !== false) {
    const s = bbsFileSave(`${title} — combined`, report);
    if (s.ok) savedPath = s.path;
  }
  return { ok: results.some((r) => r.status === 'ok'), report, path: savedPath, results };
}

// ─── Patches (send a git diff to a friend for review/apply) ────────────────
// "Bots can send patches to another bot against the git" — the sender generates
// a diff from its repo, the receiver saves it to the file area and queues a
// review work task. Never auto-applied: the receiving seat reviews then applies.

const PATCH_MAX_BYTES = 200 * 1024;

function repoPath(repo: string): string {
  const root = process.env.WORKSPACE_ROOT || process.cwd();
  const p = String(repo || '').trim();
  if (!p) return root;
  const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  return abs.startsWith(root) ? abs : root;
}

export function makePatch(repo: string, base?: string): { ok: boolean; repo: string; patch?: string; error?: string } {
  const dir = repoPath(repo);
  try {
    const args = ['-C', dir, 'diff'];
    if (base && /^[A-Za-z0-9._~^@/-]+$/.test(base)) args.push(base);
    const patch = execFileSync('git', args, { encoding: 'utf8', timeout: 15000, maxBuffer: PATCH_MAX_BYTES * 2 }).toString();
    if (!patch.trim()) return { ok: false, repo: dir, error: 'no diff to send (the tree is clean against that base)' };
    if (Buffer.byteLength(patch) > PATCH_MAX_BYTES) return { ok: false, repo: dir, error: `patch too large (${Buffer.byteLength(patch)} bytes, cap ${PATCH_MAX_BYTES})` };
    return { ok: true, repo: dir, patch };
  } catch (err: any) {
    return { ok: false, repo: dir, error: String(err?.stderr || err?.message || err).slice(0, 500) };
  }
}

export async function sendPatch(hostname: string, opts: { repo: string; base?: string; description: string }): Promise<{ ok: boolean; error?: string }> {
  const m = makePatch(opts.repo, opts.base);
  if (!m.ok) return { ok: false, error: m.error };
  try {
    const r = await fetchFromFriend(hostname, '/api/friends/patch', {
      method: 'POST',
      body: { repo: m.repo, base: opts.base, description: String(opts.description || '').slice(0, 500), patch: m.patch },
      timeoutMs: 30000,
    });
    if (!r.ok) return { ok: false, error: r.body?.error || `friend returned HTTP ${r.status}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Receive a patch: save it to the file area + queue a review work task. */
function receiveFriendPatch(fromHost: string, body: any): { ok: boolean; path?: string; task_id?: string; error?: string } {
  const repo = String(body?.repo ?? '').slice(0, 500);
  const description = String(body?.description ?? '').slice(0, 500);
  const patch = String(body?.patch ?? '').slice(0, PATCH_MAX_BYTES);
  if (!repo || !patch) return { ok: false, error: 'repo and patch are required' };
  const filePath = path.join(bbsFilesDir(), `${Date.now()}-patch-${sanitizeSegment(description).slice(0, 60) || 'patch'}.patch`);
  fs.writeFileSync(filePath, patch, 'utf-8');
  addFriendFile(fromHost, path.basename(filePath), filePath);
  const task = createWorkTask({
    title: `Review patch from ${fromHost}: ${description || 'git patch'}`,
    description: `A friend sent a git patch for ${repo} over the friends mesh. Patch saved at ${filePath}.\n\nReview the diff first; apply only if it is sound: git -C ${repo} apply ${filePath}`,
    notes: `Patch from ${fromHost} over the friends mesh.`,
    priority: 'medium',
    created_by: fromHost,
    project_id: PERSONAL_PROJECT_ID,
  });
  return { ok: true, path: filePath, task_id: task.id };
}

// ─── HTTP dispatcher ───────────────────────────────────────────────────────

function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function sendErr(res: http.ServerResponse, msg: string, status = 400): void {
  sendJson(res, { error: msg }, status);
}

/** Encrypt a response for a post-handshake peer call. */
function sendEncrypted(res: http.ServerResponse, host: string, method: string, path: string, data: unknown, status = 200): void {
  const keys = getFriendSessionKeys(host);
  if (!keys) { sendErr(res, 'not a friend', 404); return; }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keys.enc, iv);
  cipher.setAAD(Buffer.from(`resp ${method} ${path}`));
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data), 'utf-8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  const env = { v: 1, iv: iv.toString('base64'), ct: ct.toString('base64'), tag: tag.toString('base64') };
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(env));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const text = await readRawBody(req);
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

async function readRawBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

/** Identify + authenticate a post-handshake caller by its session key. Empty
 *  string on failure. POST bodies are authenticated by GCM decryption; GETs
 *  carry an HMAC signature header (no body to encrypt). */
function authorizedFriend(req: http.IncomingMessage, method: string, path: string): string {
  const host = normalizeHost(String(req.headers['x-warden-id'] || ''));
  if (!host) return '';
  if (isBlockedDb(host)) { recordOffense(host, 'blocked_contact'); return ''; }
  const keys = getFriendSessionKeys(host);
  if (!keys) return '';
  if (method === 'GET') {
    const sig = String(req.headers['x-warden-auth'] || '');
    const expected = signGet(keys.mac, method, path);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (!sig || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      recordOffense(host, 'auth_failed', 'bad signature');
      return '';
    }
  }
  return host;
}

/** Read + decrypt a POST body; null when the envelope fails GCM verification. */
async function readEncryptedBody(req: http.IncomingMessage, host: string, method: string, path: string): Promise<any | null> {
  const raw = await readRawBody(req);
  if (!raw) return null;
  let env: any;
  try { env = JSON.parse(raw); } catch { return null; }
  const keys = getFriendSessionKeys(host);
  if (!keys) return null;
  return decryptBody(keys.enc, method, path, env);
}

/**
 * Dispatch every /api/friends* route. `runTurn` (wired from index.js) runs an
 * inbound "ask" as a normal seat turn. Returns true when the route was handled.
 */
export async function handleFriendsRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  _params: URLSearchParams,
  runTurn: FriendRunTurn,
  runColab: FriendRunTurn,
  getColabStatus: () => unknown,
): Promise<boolean> {
  const method = req.method || 'GET';

  // ── Peer-facing ────────────────────────────────────────────────────────
  // `/whoami` is the shared link: open + minimal (identity only, rate-limited).
  // invite/accept are the plaintext handshake (public keys only). Everything
  // below them is encrypted + authenticated with the per-friendship session key.
  if (pathname === '/api/friends/whoami' && method === 'GET') {
    const now = Date.now();
    const last = whoamiTimestamps.get('*') || 0;
    if (now - last < WHOAMI_MIN_INTERVAL_MS) { sendErr(res, 'rate limited', 429); return true; }
    whoamiTimestamps.set('*', now);
    sendJson(res, {
      hostname: myHostname(),
      link: myLink(),
      capabilities: CAPABILITIES,
      specialists: SELF_SPECIALISTS,
      profile: getSelfProfile(),
      pubkey: friendsPublicKeyHex(),
    });
    return true;
  }
  if (pathname === '/api/friends/invite' && method === 'POST') {
    const r = handleInvite(await readBody(req));
    if (!r.ok) { sendErr(res, r.error || 'invite rejected', r.status || 400); return true; }
    sendJson(res, { ok: true });
    return true;
  }
  if (pathname === '/api/friends/accept' && method === 'POST') {
    const r = handleAccept(await readBody(req));
    if (!r.ok) { sendErr(res, r.error || 'accept rejected', r.status || 400); return true; }
    sendJson(res, { ok: true });
    return true;
  }
  if (pathname === '/api/friends/ping' && method === 'GET') {
    const host = authorizedFriend(req, method, pathname);
    if (!host) { sendErr(res, 'not a friend', 404); return true; }
    setFriendStatus(host, 'online', new Date().toISOString());
    sendEncrypted(res, host, method, pathname, { ok: true, hostname: myHostname() });
    return true;
  }
  if (pathname === '/api/friends/message' && method === 'POST') {
    const host = authorizedFriend(req, method, pathname);
    if (!host) { sendErr(res, 'not a friend', 404); return true; }
    const body = await readEncryptedBody(req, host, method, pathname);
    if (body === null) { recordOffense(host, 'auth_failed', 'bad envelope'); sendErr(res, 'unauthorized', 401); return true; }
    const message = String(body?.message ?? '').slice(0, 4000);
    if (!message) { sendEncrypted(res, host, method, pathname, { ok: false, error: 'message is required' }); return true; }
    addFriendMessage(host, message, 'inbound');
    sendEncrypted(res, host, method, pathname, { ok: true });
    return true;
  }
  if (pathname === '/api/friends/room-post' && method === 'POST') {
    const host = authorizedFriend(req, method, pathname);
    if (!host) { sendErr(res, 'not a friend', 404); return true; }
    const body = await readEncryptedBody(req, host, method, pathname);
    if (body === null) { recordOffense(host, 'auth_failed', 'bad envelope'); sendErr(res, 'unauthorized', 401); return true; }
    const room = String(body?.room ?? '').slice(0, 120);
    const message = String(body?.message ?? '').slice(0, 4000);
    if (!room || !message) { sendEncrypted(res, host, method, pathname, { ok: false, error: 'room and message are required' }); return true; }
    addFriendRoomMessage(room, host, message);
    sendEncrypted(res, host, method, pathname, { ok: true });
    return true;
  }
  if (pathname === '/api/friends/share' && method === 'POST') {
    const host = authorizedFriend(req, method, pathname);
    if (!host) { sendErr(res, 'not a friend', 404); return true; }
    const body = await readEncryptedBody(req, host, method, pathname);
    if (body === null) { recordOffense(host, 'auth_failed', 'bad envelope'); sendErr(res, 'unauthorized', 401); return true; }
    const filename = String(body?.filename ?? '').slice(0, 120);
    const content = String(body?.content ?? '').slice(0, 1024 * 1024);
    if (!filename || !content) { sendEncrypted(res, host, method, pathname, { ok: false, error: 'filename and content are required' }); return true; }
    const filePath = receiveSharedFile(host, filename, content);
    sendEncrypted(res, host, method, pathname, { ok: true, path: filePath });
    return true;
  }
  if (pathname === '/api/friends/request' && method === 'POST') {
    const host = authorizedFriend(req, method, pathname);
    if (!host) { sendErr(res, 'not a friend', 404); return true; }
    const body = await readEncryptedBody(req, host, method, pathname);
    if (body === null) { recordOffense(host, 'auth_failed', 'bad envelope'); sendErr(res, 'unauthorized', 401); return true; }
    const task = String(body?.task ?? '').slice(0, 8000);
    if (!task) { sendEncrypted(res, host, method, pathname, { ok: false, error: 'task is required' }); return true; }
    // Agent-aware ask: a friend may target a specific specialist (vulkan/iris/…)
    // instead of the default seat. Unknown names silently fall back to the seat.
    const agent = String(body?.agent ?? '').toLowerCase();
    const target = SELF_SPECIALISTS.includes(agent) ? agent : undefined;
    const result = await runTurn(task, host, target);
    if (result.error) { sendEncrypted(res, host, method, pathname, { ok: false, error: result.error }); return true; }
    sendEncrypted(res, host, method, pathname, { ok: true, answer: result.text });
    return true;
  }
  if (pathname === '/api/friends/task' && method === 'POST') {
    const host = authorizedFriend(req, method, pathname);
    if (!host) { sendErr(res, 'not a friend', 404); return true; }
    const body = await readEncryptedBody(req, host, method, pathname);
    if (body === null) { recordOffense(host, 'auth_failed', 'bad envelope'); sendErr(res, 'unauthorized', 401); return true; }
    const title = String(body?.title ?? '').slice(0, 300);
    if (!title) { sendEncrypted(res, host, method, pathname, { ok: false, error: 'title is required' }); return true; }
    const description = String(body?.description ?? '').slice(0, 4000);
    const priority = typeof body?.priority === 'string' && body.priority ? body.priority.slice(0, 20) : 'medium';
    const due = typeof body?.due_date === 'string' && body.due_date ? body.due_date.slice(0, 30) : undefined;
    const task = createWorkTask({
      title,
      description,
      notes: `Assigned by friend ${host} over the friends mesh.`,
      priority,
      created_by: host,
      due_date: due,
      project_id: PERSONAL_PROJECT_ID,
    });
    sendEncrypted(res, host, method, pathname, { ok: true, task_id: task.id });
    return true;
  }

  // ── Peer-facing BBS (a friend dialed into this node) ─────────────────────
  if (pathname === '/api/friends/bbs/post' && method === 'POST') {
    const host = authorizedFriend(req, method, pathname);
    if (!host) { sendErr(res, 'not a friend', 404); return true; }
    if (!bbsRateOk(host)) {
      recordOffense(host, 'bbs_spam', 'posting to the BBS too fast');
      sendErr(res, 'rate limited', 429);
      return true;
    }
    const body = await readEncryptedBody(req, host, method, pathname);
    if (body === null) { recordOffense(host, 'auth_failed', 'bad envelope'); sendErr(res, 'unauthorized', 401); return true; }
    const r = handleBbsPost(body);
    if (!r.ok) { sendEncrypted(res, host, method, pathname, { ok: false, error: r.error || 'bad bbs post' }); return true; }
    sendEncrypted(res, host, method, pathname, { ok: true });
    return true;
  }
  if (pathname === '/api/friends/bbs/recent' && method === 'GET') {
    const host = authorizedFriend(req, method, pathname);
    if (!host) { sendErr(res, 'not a friend', 404); return true; }
    const me = myHostname();
    backfillBbsHost(me);
    sendEncrypted(res, host, method, pathname, {
      threads: listBbsThreads({ host: me }).slice(0, 200),
      posts: listBbsPosts({ host: me, limit: 200 }),
      files: bbsFiles(),
    });
    return true;
  }
  if (pathname === '/api/friends/bbs/file' && method === 'POST') {
    const host = authorizedFriend(req, method, pathname);
    if (!host) { sendErr(res, 'not a friend', 404); return true; }
    const body = await readEncryptedBody(req, host, method, pathname);
    if (body === null) { recordOffense(host, 'auth_failed', 'bad envelope'); sendErr(res, 'unauthorized', 401); return true; }
    const r = bbsFileRead(String(body?.name ?? ''));
    if (!r.ok) { sendEncrypted(res, host, method, pathname, { ok: false, error: r.error || 'file not found' }); return true; }
    sendEncrypted(res, host, method, pathname, { ok: true, name: r.name, content: r.content });
    return true;
  }
  if (pathname === '/api/friends/patch' && method === 'POST') {
    const host = authorizedFriend(req, method, pathname);
    if (!host) { sendErr(res, 'not a friend', 404); return true; }
    const body = await readEncryptedBody(req, host, method, pathname);
    if (body === null) { recordOffense(host, 'auth_failed', 'bad envelope'); sendErr(res, 'unauthorized', 401); return true; }
    const r = receiveFriendPatch(host, body);
    if (!r.ok) { sendEncrypted(res, host, method, pathname, { ok: false, error: r.error || 'bad patch' }); return true; }
    sendEncrypted(res, host, method, pathname, { ok: true, path: r.path, task_id: r.task_id });
    return true;
  }

  // ── Local (dashboard) ─────────────────────────────────────────────────
  if (pathname === '/api/friends/bbs' && method === 'GET') {
    sendJson(res, bbsState());
    return true;
  }
  if (pathname === '/api/friends/bbs/new' && method === 'POST') {
    const body = await readBody(req);
    const r = await bbsPost({
      board: body?.board,
      title: body?.title,
      thread_id: body?.thread_id,
      reply_to: body?.reply_to,
      body: body?.body,
      author_kind: 'human',
      host: body?.host,
    });
    if (!r.ok) { sendErr(res, r.error || 'post failed'); return true; }
    sendJson(res, r);
    return true;
  }
  const bbsDialMatch = pathname.match(/^\/api\/friends\/bbs\/dial\/([^/]+)$/);
  if (bbsDialMatch && method === 'GET') {
    sendJson(res, await bbsDialState(decodeURIComponent(bbsDialMatch[1])));
    return true;
  }
  const bbsDialPostMatch = pathname.match(/^\/api\/friends\/bbs\/dial\/([^/]+)\/post$/);
  if (bbsDialPostMatch && method === 'POST') {
    const body = await readBody(req);
    const host = decodeURIComponent(bbsDialPostMatch[1]);
    const r = await bbsPost({
      board: body?.board,
      title: body?.title,
      thread_id: body?.thread_id,
      reply_to: body?.reply_to,
      body: body?.body,
      author_kind: 'human',
      host,
    });
    if (!r.ok) { sendErr(res, r.error || 'post failed'); return true; }
    sendJson(res, r);
    return true;
  }
  const bbsDialFileMatch = pathname.match(/^\/api\/friends\/bbs\/dial\/([^/]+)\/file\/([^/]+)$/);
  if (bbsDialFileMatch && method === 'GET') {
    const host = decodeURIComponent(bbsDialFileMatch[1]);
    const name = decodeURIComponent(bbsDialFileMatch[2]);
    sendJson(res, await readFriendFile(host, name));
    return true;
  }
  const bbsThreadMatch = pathname.match(/^\/api\/friends\/bbs\/thread\/([^/]+)$/);
  if (bbsThreadMatch && method === 'GET') {
    const tid = decodeURIComponent(bbsThreadMatch[1]);
    const me = myHostname();
    sendJson(res, { thread: getBbsThread(tid), posts: listBbsPosts({ thread_id: tid, host: me, limit: 500 }) });
    return true;
  }
  const bbsFileMatch = pathname.match(/^\/api\/friends\/bbs\/file\/([^/]+)$/);
  if (bbsFileMatch && method === 'GET') {
    sendJson(res, bbsFileRead(decodeURIComponent(bbsFileMatch[1])));
    return true;
  }

  if (pathname === '/api/friends/botnet' && method === 'GET') {
    sendJson(res, {
      enabled: getRouterState('bbs:autonomy:enabled') !== 'false',
      agent: getRouterState('bbs:autonomy:agent') || 'atlas',
    });
    return true;
  }
  if (pathname === '/api/friends/botnet' && method === 'POST') {
    const body = await readBody(req);
    if (body?.enabled !== undefined) setRouterState('bbs:autonomy:enabled', body.enabled === true ? 'true' : 'false');
    const agent = String(body?.agent || '').toLowerCase();
    if (agent === 'atlas' || agent === 'vulkan') setRouterState('bbs:autonomy:agent', agent);
    sendJson(res, {
      enabled: getRouterState('bbs:autonomy:enabled') !== 'false',
      agent: getRouterState('bbs:autonomy:agent') || 'atlas',
    });
    return true;
  }

  // Local-only (dashboard): save a note/artifact to the file area. The peer
  // `POST /api/friends/bbs/file` above is friend-authorized; this one is the
  // dashboard's own hand, same backend write.
  if (pathname === '/api/friends/bbs/file-save' && method === 'POST') {
    const body = await readBody(req);
    const name = String(body?.name || '').slice(0, 120);
    const content = String(body?.content || '');
    if (!name || !content) { sendJson(res, { ok: false, error: 'file-save requires name and content' }); return true; }
    sendJson(res, bbsFileSave(name, content));
    return true;
  }
  // Local-only: upload a real file (base64 bytes) / delete one from the area.
  if (pathname === '/api/friends/bbs/file-upload' && method === 'POST') {
    const body = await readBody(req);
    const name = String(body?.name || '').slice(0, 120);
    const data = String(body?.data_base64 || '');
    if (!name || !data) { sendJson(res, { ok: false, error: 'file-upload requires name and data_base64' }); return true; }
    sendJson(res, bbsFileUpload(name, data));
    return true;
  }
  if (pathname === '/api/friends/bbs/file-delete' && method === 'POST') {
    const body = await readBody(req);
    const name = String(body?.name || '').slice(0, 120);
    if (!name) { sendJson(res, { ok: false, error: 'file-delete requires a name' }); return true; }
    sendJson(res, bbsFileDelete(name));
    return true;
  }
  // Local-only: pull a message off this node's own message base (the thread
  // row cleans itself up when it empties). Not in the peer allowlist — no
  // remote deletes.
  if (pathname === '/api/friends/bbs/post-delete' && method === 'POST') {
    const body = await readBody(req);
    const id = String(body?.id || '').slice(0, 64);
    if (!id) { sendJson(res, { ok: false, error: 'post-delete requires an id' }); return true; }
    sendJson(res, bbsPostDelete(id));
    return true;
  }

  // Local-only: door market plumbing. The rack lists and serves installed
  // doors; door-install promotes an .html from the file area into the rack.
  if (pathname === '/api/friends/bbs/doors' && method === 'GET') {
    sendJson(res, { ok: true, doors: bbsDoors() });
    return true;
  }
  const bbsDoorMatch = pathname.match(/^\/api\/friends\/bbs\/door\/([^/]+)$/);
  if (bbsDoorMatch && method === 'GET') {
    const r = bbsDoorPage(decodeURIComponent(bbsDoorMatch[1]));
    if (!r.ok) { sendErr(res, r.error || 'no such door'); return true; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(r.html);
    return true;
  }
  if (pathname === '/api/friends/bbs/door-install' && method === 'POST') {
    const body = await readBody(req);
    const name = String(body?.name || '').slice(0, 120);
    if (!name) { sendJson(res, { ok: false, error: 'door-install requires a name' }); return true; }
    sendJson(res, bbsDoorInstall(name));
    return true;
  }

  // Local-only (dashboard): caller registry for the MCP gate at /mcp/botnet.
  // Mint returns the raw token ONCE (only its hash is stored); revoke drops
  // the handle. Callers are third-party agents — not mesh friends.
  if (pathname === '/api/friends/botnet-callers' && method === 'GET') {
    sendJson(res, { ok: true, callers: botnetListCallers() });
    return true;
  }
  if (pathname === '/api/friends/botnet-callers' && method === 'POST') {
    const body = await readBody(req);
    const r = botnetMintCaller(String(body?.handle || ''));
    if (!r.ok) { sendJson(res, { ok: false, error: r.error }); return true; }
    sendJson(res, r);
    return true;
  }
  const callerRevokeMatch = pathname.match(/^\/api\/friends\/botnet-callers\/([^/]+)\/revoke$/);
  if (callerRevokeMatch && method === 'POST') {
    sendJson(res, botnetRevokeCaller(decodeURIComponent(callerRevokeMatch[1])));
    return true;
  }

  // Local-only (dashboard): kick off a BotNet swarm. It runs for minutes
  // (planner → parallel workers → combine), so this only STARTS the run — the
  // Colab screen polls /api/friends/colab/status for live worker states.
  if (pathname === '/api/friends/colab' && method === 'POST') {
    const body = await readBody(req);
    const task = String(body?.task || '').trim().slice(0, 8000);
    if (!task) { sendJson(res, { ok: false, error: 'colab requires a task' }); return true; }
    const st = getColabStatus() as { busy?: boolean };
    if (st?.busy) { sendJson(res, { ok: false, error: 'a swarm is already running — watch the status line' }); return true; }
    void runColab(task, 'dashboard').then(
      (r) => { if (r.error) logger.warn({ err: r.error }, 'colab run ended in error'); },
      (err) => logger.warn({ err: err?.message ?? err }, 'colab run crashed'),
    );
    sendJson(res, { ok: true, started: true });
    return true;
  }
  if (pathname === '/api/friends/colab/status' && method === 'GET') {
    sendJson(res, Object.assign({ ok: true }, getColabStatus() as object));
    return true;
  }

  if (pathname === '/api/friends' && method === 'GET') {
    sendJson(res, {
      self: { hostname: myHostname(), instanceId: getInstanceId(), capabilities: CAPABILITIES, specialists: SELF_SPECIALISTS, profile: getSelfProfile(), link: myLink() },
      tailscale: tailscaleStatus(),
      friends: listFriends().map((f) => ({
        ...f,
        specialists: (() => { try { return JSON.parse(f.specialists || '[]'); } catch { return []; } })(),
        capabilities: (() => { try { return JSON.parse(f.capabilities || '[]'); } catch { return []; } })(),
      })),
      requests: listFriendRequests(),
      messages: listFriendMessages(50),
      rooms: listFriendRoomMessages(100),
      files: listFriendFiles(100),
      blocks: listBlockedDb(),
      offenses: listOffensesDb(100),
    });
    return true;
  }
  if (pathname === '/api/friends/tailscale' && method === 'GET') {
    sendJson(res, tailscaleStatus());
    return true;
  }
  if (pathname === '/api/friends/tailscale/up' && method === 'POST') {
    sendJson(res, tailscaleUp());
    return true;
  }
  if (pathname === '/api/friends/invite-send' && method === 'POST') {
    const body = await readBody(req);
    const hostname = String(body?.hostname ?? '').trim();
    if (!hostname) { sendErr(res, 'hostname is required'); return true; }
    sendJson(res, await sendInvite(hostname));
    return true;
  }

  const acceptMatch = pathname.match(/^\/api\/friends\/requests\/([^/]+)\/accept$/);
  if (acceptMatch && method === 'POST') {
    sendJson(res, await acceptRequest(decodeURIComponent(acceptMatch[1])));
    return true;
  }
  const denyMatch = pathname.match(/^\/api\/friends\/requests\/([^/]+)\/deny$/);
  if (denyMatch && method === 'POST') {
    sendJson(res, { ok: denyRequest(decodeURIComponent(denyMatch[1])) });
    return true;
  }
  const pingMatch = pathname.match(/^\/api\/friends\/([^/]+)\/ping$/);
  if (pingMatch && method === 'POST') {
    sendJson(res, await pingFriend(decodeURIComponent(pingMatch[1])));
    return true;
  }
  const delMatch = pathname.match(/^\/api\/friends\/([^/]+)$/);
  if (delMatch && method === 'DELETE') {
    sendJson(res, { ok: deleteFriend(decodeURIComponent(delMatch[1])) });
    return true;
  }
  const readMatch = pathname.match(/^\/api\/friends\/messages\/([^/]+)\/read$/);
  if (readMatch && method === 'POST') {
    markFriendMessagesRead(decodeURIComponent(readMatch[1]));
    sendJson(res, { ok: true });
    return true;
  }
  const blockMatch = pathname.match(/^\/api\/friends\/([^/]+)\/block$/);
  if (blockMatch && method === 'POST') {
    const host = normalizeHost(decodeURIComponent(blockMatch[1]));
    const body = await readBody(req);
    deleteFriend(host);
    blockFriendDb(host, String(body?.reason ?? '').slice(0, 200) || 'blocked');
    sendJson(res, { ok: true });
    return true;
  }
  const unblockMatch = pathname.match(/^\/api\/friends\/([^/]+)\/unblock$/);
  if (unblockMatch && method === 'POST') {
    sendJson(res, { ok: unblockFriendDb(normalizeHost(decodeURIComponent(unblockMatch[1]))) });
    return true;
  }

  return false; // not handled
}

export { listFriends, listFriendRequests, listFriendMessages, listFriendRoomMessages, listFriendFiles };
