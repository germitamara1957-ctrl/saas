import { logger } from "./logger";

/**
 * Escape special HTML characters in user-supplied strings before
 * embedding them in HTML email templates to prevent HTML injection.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/**
 * Load SMTP config: DB first, then env vars fallback.
 */
async function loadSmtpConfig(): Promise<SmtpConfig | null> {
  try {
    const { getSettingValue } = await import("../routes/admin/settings");
    const [dbHost, dbUser, dbPass, dbFrom, dbPort] = await Promise.all([
      getSettingValue("smtp_host"),
      getSettingValue("smtp_user"),
      getSettingValue("smtp_pass"),
      getSettingValue("smtp_from"),
      getSettingValue("smtp_port"),
    ]);

    const host = dbHost?.trim() || process.env.SMTP_HOST?.trim();
    const user = dbUser || process.env.SMTP_USER;
    const pass = dbPass || process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
    const from = dbFrom?.trim() || process.env.SMTP_FROM?.trim() || "noreply@ai-gateway.local";
    const port = parseInt(dbPort ?? process.env.SMTP_PORT ?? "587", 10);

    if (host && user && pass) {
      return { host, port, user, pass, from };
    }
    return null;
  } catch {
    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
    const from = (process.env.SMTP_FROM ?? "noreply@ai-gateway.local").trim();
    const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
    if (host && user && pass) return { host, port, user, pass, from };
    return null;
  }
}

/**
 * Send an email. If SMTP is configured (DB or env), uses nodemailer.
 * Otherwise logs the email content (development fallback).
 */
export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const smtp = await loadSmtpConfig();

  if (smtp) {
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: { user: smtp.user, pass: smtp.pass },
      });
      await transporter.sendMail({
        from: smtp.from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      logger.info({ to: opts.to, subject: opts.subject }, "Email sent");
    } catch (err) {
      logger.error({ err, to: opts.to }, "Failed to send email via SMTP");
      throw err;
    }
  } else {
    logger.info(
      { to: opts.to, subject: opts.subject, text: opts.text },
      "[DEV] Email not sent (SMTP not configured) — content logged above",
    );
  }
}

export function buildVerificationEmail(name: string, token: string, baseUrl: string) {
  const link = `${baseUrl}/api/portal/auth/verify-email?token=${token}`;
  const safeName = escapeHtml(name);
  return {
    subject: "Verify your email — AI Gateway",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#1a1a1a">Verify your email</h2>
        <p>Hi ${safeName}, thanks for signing up!</p>
        <p>Click the button below to verify your email address. This link expires in 24 hours.</p>
        <a href="${link}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;margin:16px 0">
          Verify Email
        </a>
        <p style="color:#666;font-size:14px">Or copy this link:<br/><code>${link}</code></p>
        <p style="color:#999;font-size:12px">If you didn't create an account, ignore this email.</p>
      </div>
    `,
    text: `Hi ${name},\n\nVerify your email by visiting:\n${link}\n\nThis link expires in 24 hours.\n\nIf you didn't create an account, ignore this email.`,
  };
}

export function buildPasswordResetEmail(name: string, token: string, baseUrl: string) {
  const link = `${baseUrl}/reset-password?token=${token}`;
  const safeName = escapeHtml(name);
  return {
    subject: "Reset your password — AI Gateway",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#1a1a1a">Reset your password</h2>
        <p>Hi ${safeName},</p>
        <p>We received a request to reset the password for your AI Gateway account. Click the button below to choose a new password. This link expires in 1 hour.</p>
        <a href="${link}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;margin:16px 0">
          Reset Password
        </a>
        <p style="color:#666;font-size:14px">Or copy this link:<br/><code>${link}</code></p>
        <p style="color:#999;font-size:12px">If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.</p>
      </div>
    `,
    text: `Hi ${name},\n\nReset your password by visiting:\n${link}\n\nThis link expires in 1 hour.\n\nIf you didn't request a password reset, ignore this email.`,
  };
}

export function buildLowCreditEmail(name: string, balance: number, planCredits: number) {
  const pct = planCredits > 0 ? ((balance / planCredits) * 100).toFixed(1) : "0.0";
  const safeName = escapeHtml(name);
  return {
    subject: "Low credit balance warning — AI Gateway",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#dc2626">⚠ Low Credit Balance</h2>
        <p>Hi ${safeName},</p>
        <p>Your AI Gateway credit balance has dropped to <strong>$${balance.toFixed(4)}</strong> — only <strong>${pct}%</strong> of your plan's monthly credits remaining.</p>
        <p>To avoid service interruption, please contact your administrator to top up your account.</p>
        <p style="color:#999;font-size:12px">You will receive this notification at most once per day.</p>
      </div>
    `,
    text: `Hi ${name},\n\nYour AI Gateway credit balance is low: $${balance.toFixed(4)} (${pct}% remaining).\n\nPlease contact your administrator to top up your account.\n\nYou will receive this notification at most once per day.`,
  };
}
