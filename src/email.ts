/**
 * Email integration module for Warden.
 * Provides IMAP (read) and SMTP (send) functionality.
 *
 * REQUIRES: npm install imapflow nodemailer @types/nodemailer
 */

import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

import { getEmailAccount, createEmailDraft } from './db.js';
import { logger } from './logger.js';
import { refreshTokenIfNeeded } from './oauth.js';
import { GoogleProvider } from './providers/google.js';
import { MicrosoftProvider } from './providers/microsoft.js';
import type { OAuthProvider } from './providers/types.js';

export interface EmailMessage {
  id?: string;
  from: string;
  to: string | string[];
  subject: string;
  date: string;
  body: string;
  folder?: string;
  isRead?: boolean;
  snippet?: string;
  attachments?: Array<{ filename: string; size: number; contentType: string }>;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Fetch recent emails from an IMAP mailbox.
 */
export async function fetchEmails(
  accountId: string,
  folder: string = 'INBOX',
  limit: number = 20,
  search?: string,
  previewOnly?: boolean,
): Promise<EmailMessage[]> {
  const account = getEmailAccount(accountId);
  if (!account) throw new Error('Email account not found');
  if (!account.enabled) throw new Error('Email account is disabled');

  // OAuth path: delegate to provider API if linked to an OAuth account
  if (account.oauth_account_id) {
    const { token, provider: providerName } = await refreshTokenIfNeeded(account.oauth_account_id);
    const provider: OAuthProvider = providerName === 'google'
      ? new GoogleProvider()
      : new MicrosoftProvider();
    const providerEmails = await provider.fetchEmails(token, folder, limit, search, previewOnly);
    return providerEmails.map((e) => ({
      from: e.from,
      to: Array.isArray(e.to) ? e.to.join(', ') : e.to,
      subject: e.subject,
      date: e.date,
      body: e.body,
      attachments: [],
    }));
  }

  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: !!account.use_tls,
    auth: {
      user: account.username,
      pass: account.password,
    },
    logger: false,
  });

  const emails: EmailMessage[] = [];

  try {
    await client.connect();

    const lock = await client.getMailboxLock(folder);
    try {
      // Fetch the most recent N messages
      const mailbox = client.mailbox;
      if (!mailbox || !mailbox.exists || mailbox.exists === 0) {
        return [];
      }

      const startSeq = Math.max(1, mailbox.exists - limit + 1);
      const range = `${startSeq}:*`;

      for await (const message of client.fetch(range, {
        envelope: true,
        source: true,
      })) {
        const envelope = message.envelope!;
        const fromAddr =
          envelope.from && envelope.from.length > 0
            ? envelope.from
                .map(
                  (a: { name?: string; address?: string }) =>
                    a.name ? `${a.name} <${a.address}>` : a.address || '',
                )
                .join(', ')
            : '';
        const toAddr =
          envelope.to && envelope.to.length > 0
            ? envelope.to
                .map(
                  (a: { name?: string; address?: string }) =>
                    a.name ? `${a.name} <${a.address}>` : a.address || '',
                )
                .join(', ')
            : '';

        // Extract text body from source
        let body = '';
        if (message.source) {
          const sourceStr = message.source.toString('utf-8');
          // Simple text extraction: find text after headers
          const headerEnd = sourceStr.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            body = sourceStr.substring(headerEnd + 4);
          }
          // Truncate very long bodies
          if (body.length > 10000) {
            body = body.substring(0, 10000) + '\n... [truncated]';
          }
        }

        emails.push({
          from: fromAddr,
          to: toAddr,
          subject: envelope.subject || '(no subject)',
          date: envelope.date
            ? new Date(envelope.date).toISOString()
            : new Date().toISOString(),
          body,
          attachments: [], // Basic implementation - attachment listing requires BODYSTRUCTURE parsing
        });
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err: any) {
    logger.error({ err, accountId, folder }, 'IMAP fetch error');
    throw new Error(`Failed to fetch emails: ${err.message}`);
  }

  // Return in reverse chronological order (most recent first)
  return emails.reverse();
}

/**
 * Fetch a single email by ID with full content.
 */
export async function getEmailById(
  accountId: string,
  emailId: string,
): Promise<EmailMessage | null> {
  const account = getEmailAccount(accountId);
  if (!account) throw new Error('Email account not found');
  if (!account.enabled) throw new Error('Email account is disabled');

  // OAuth path
  if (account.oauth_account_id) {
    const { token, provider: providerName } = await refreshTokenIfNeeded(account.oauth_account_id);
    const provider: OAuthProvider = providerName === 'google'
      ? new GoogleProvider()
      : new MicrosoftProvider();
    return await provider.getEmailById?.(token, emailId) ?? null;
  }

  // IMAP path - not implemented for single fetch
  throw new Error('getEmailById requires OAuth (Gmail/Microsoft)');
}

/**
 * Send an email via SMTP.
 * CRITICAL: This function enforces read-only mode at the lowest level.
 * When read_only=1 (Read Only), sending is blocked completely.
 * When read_only=0 (Read Write), emails are actually sent.
 * No caller can bypass this check.
 */
export async function sendEmail(
  accountId: string,
  to: string,
  subject: string,
  body: string,
): Promise<SendEmailResult> {
  const account = getEmailAccount(accountId);
  if (!account) {
    const msg = 'Email account not found';
    logger.warn({ accountId, to, subject: subject.substring(0, 50) }, `Email send blocked: ${msg}`);
    return { success: false, error: msg };
  }

  // *** READ ONLY MODE: read_only=1 blocks sending ***
  if (account.read_only) {
    logger.warn(
      {
        accountId,
        email: account.email,
        to,
        subject: subject.substring(0, 50),
        timestamp: new Date().toISOString(),
      },
      'Email send blocked: account is read-only',
    );
    return {
      success: false,
      error: 'Read Only Mode: This account cannot send emails. Enable Read Write mode to send.',
    };
  }

  if (!account.enabled) {
    const msg = 'Email account is disabled';
    logger.warn({ accountId, to }, `Email send blocked: ${msg}`);
    return { success: false, error: msg };
  }

  // OAuth path: delegate to provider API if linked to an OAuth account
  if (account.oauth_account_id) {
    try {
      const { token, provider: providerName } = await refreshTokenIfNeeded(account.oauth_account_id);
      const provider: OAuthProvider = providerName === 'google'
        ? new GoogleProvider()
        : new MicrosoftProvider();
      logger.info(
        {
          accountId,
          email: account.email,
          to,
          subject: subject.substring(0, 100),
          provider: providerName,
          timestamp: new Date().toISOString(),
        },
        'OAuth email send attempt',
      );
      await provider.sendEmail(token, to, subject, body);
      return { success: true };
    } catch (err: any) {
      logger.error(
        {
          accountId,
          email: account.email,
          to,
          subject: subject.substring(0, 100),
          err,
          timestamp: new Date().toISOString(),
        },
        'OAuth email send failed',
      );
      return { success: false, error: `OAuth send error: ${err.message}` };
    }
  }

  // Log every send attempt
  logger.info(
    {
      accountId,
      email: account.email,
      to,
      subject: subject.substring(0, 100),
      timestamp: new Date().toISOString(),
    },
    'Email send attempt',
  );

  try {
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: {
        user: account.username,
        pass: account.password,
      },
      tls: {
        rejectUnauthorized: !!account.use_tls,
      },
    });

    const isHtml = body.trim().startsWith('<');
    const info = await transporter.sendMail({
      from: `${account.name} <${account.email}>`,
      to,
      subject,
      ...(isHtml ? { html: body } : { text: body }),
    });

    logger.info(
      {
        accountId,
        email: account.email,
        to,
        subject: subject.substring(0, 100),
        messageId: info.messageId,
        timestamp: new Date().toISOString(),
      },
      'Email sent successfully',
    );

    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    logger.error(
      {
        accountId,
        email: account.email,
        to,
        subject: subject.substring(0, 100),
        err,
        timestamp: new Date().toISOString(),
      },
      'Email send failed',
    );
    return { success: false, error: `SMTP error: ${err.message}` };
  }
}

/**
 * Test IMAP and SMTP connections for an account.
 */
export async function testConnection(accountId: string): Promise<{
  imap: { ok: boolean; error?: string };
  smtp: { ok: boolean; error?: string };
}> {
  const account = getEmailAccount(accountId);
  if (!account) {
    return {
      imap: { ok: false, error: 'Account not found' },
      smtp: { ok: false, error: 'Account not found' },
    };
  }

  // Test IMAP
  let imapResult: { ok: boolean; error?: string };
  try {
    const client = new ImapFlow({
      host: account.imap_host,
      port: account.imap_port,
      secure: !!account.use_tls,
      auth: {
        user: account.username,
        pass: account.password,
      },
      logger: false,
    });
    await client.connect();
    await client.logout();
    imapResult = { ok: true };
  } catch (err: any) {
    imapResult = { ok: false, error: `IMAP: ${err.message}` };
  }

  // Test SMTP
  let smtpResult: { ok: boolean; error?: string };
  try {
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: {
        user: account.username,
        pass: account.password,
      },
      tls: {
        rejectUnauthorized: !!account.use_tls,
      },
    });
    await transporter.verify();
    smtpResult = { ok: true };
  } catch (err: any) {
    smtpResult = { ok: false, error: `SMTP: ${err.message}` };
  }

  return { imap: imapResult, smtp: smtpResult };
}
