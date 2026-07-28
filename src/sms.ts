/**
 * SMS integration module for Warden.
 * Provides Twilio SMS send/receive functionality.
 * No npm dependencies — uses native fetch (Node 18+).
 */

import { getSmsAccount, storeSmsMessage } from './db.js';
import { logger } from './logger.js';

export interface SmsMessageResult {
  sid: string;
  from: string;
  to: string;
  body: string;
  date_sent: string;
  direction: string;
  status: string;
}

export interface SendSmsResult {
  success: boolean;
  messageSid?: string;
  error?: string;
}

function twilioAuth(accountSid: string, authToken: string): string {
  return 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
}

/**
 * Send an SMS via Twilio.
 */
export async function sendSMS(
  accountId: string,
  to: string,
  body: string,
): Promise<SendSmsResult> {
  const account = getSmsAccount(accountId);
  if (!account) return { success: false, error: 'SMS account not found' };
  if (!account.enabled) return { success: false, error: 'SMS account is disabled' };

  // Enforce read-only at the lowest level
  if (account.read_only) {
    logger.warn({ accountId, to }, 'SMS send blocked: account is read-only');
    return { success: false, error: 'Read Only Mode: This account cannot send SMS. Disable read-only mode in settings to allow sending.' };
  }

  try {
    const params = new URLSearchParams({
      To: to,
      From: account.phone_number,
      Body: body,
    });

    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${account.account_sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': twilioAuth(account.account_sid, account.auth_token),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
    );

    const data = await resp.json() as any;

    if (!resp.ok) {
      const errMsg = data.message || data.error_message || `Twilio error (${resp.status})`;
      logger.error({ accountId, to, status: resp.status, error: errMsg }, 'SMS send failed');
      return { success: false, error: errMsg };
    }

    // Store outbound message
    storeSmsMessage({
      account_id: accountId,
      direction: 'outbound',
      from_number: account.phone_number,
      to_number: to,
      body,
      twilio_sid: data.sid,
      status: data.status,
    });

    logger.info({ accountId, to, sid: data.sid }, 'SMS sent');
    return { success: true, messageSid: data.sid };
  } catch (err: any) {
    logger.error({ accountId, to, err }, 'SMS send error');
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Fetch recent messages from Twilio API.
 */
export async function fetchMessages(
  accountId: string,
  limit: number = 50,
  fromNumber?: string,
): Promise<SmsMessageResult[]> {
  const account = getSmsAccount(accountId);
  if (!account) throw new Error('SMS account not found');
  if (!account.enabled) throw new Error('SMS account is disabled');

  const params = new URLSearchParams({ PageSize: String(Math.min(limit, 100)) });
  if (fromNumber) params.set('From', fromNumber);

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${account.account_sid}/Messages.json?${params}`,
    {
      headers: {
        'Authorization': twilioAuth(account.account_sid, account.auth_token),
      },
    },
  );

  if (!resp.ok) {
    const data = await resp.json() as any;
    throw new Error(data.message || `Twilio API error (${resp.status})`);
  }

  const data = await resp.json() as { messages: any[] };

  return (data.messages || []).map((m: any) => ({
    sid: m.sid,
    from: m.from,
    to: m.to,
    body: m.body,
    date_sent: m.date_sent || m.date_created,
    direction: m.direction,
    status: m.status,
  }));
}

/**
 * Test Twilio credentials by fetching account info.
 */
export async function testConnection(accountId: string): Promise<{ success: boolean; error?: string }> {
  const account = getSmsAccount(accountId);
  if (!account) return { success: false, error: 'SMS account not found' };

  try {
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${account.account_sid}.json`,
      {
        headers: {
          'Authorization': twilioAuth(account.account_sid, account.auth_token),
        },
      },
    );

    if (!resp.ok) {
      const data = await resp.json() as any;
      return { success: false, error: data.message || `Authentication failed (${resp.status})` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Test Twilio credentials directly (before account is saved).
 */
export async function testCredentials(
  accountSid: string,
  authToken: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
      {
        headers: {
          'Authorization': twilioAuth(accountSid, authToken),
        },
      },
    );

    if (!resp.ok) {
      const data = await resp.json() as any;
      return { success: false, error: data.message || `Authentication failed (${resp.status})` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}
