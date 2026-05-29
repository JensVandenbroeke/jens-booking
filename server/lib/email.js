const { Resend } = require('resend');
const nodemailer = require('nodemailer');

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'jens.vandenbroeke1@gmail.com';

function getFromAddress() {
  return (
    process.env.RESEND_FROM ||
    process.env.FROM_EMAIL ||
    (process.env.EMAIL_USER ? `"Jens Booking" <${process.env.EMAIL_USER}>` : null) ||
    'onboarding@resend.dev'
  );
}

function getSmtpTransport() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function sendViaResend({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not set' };
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: getFromAddress(),
    to,
    subject,
    html,
  });
  if (error) return { ok: false, error: error.message || String(error) };
  return { ok: true, id: data?.id };
}

async function sendViaSmtp({ to, subject, html }) {
  const transport = getSmtpTransport();
  if (!transport) return { ok: false, error: 'SMTP not configured' };
  const info = await transport.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    html,
  });
  return { ok: true, id: info.messageId };
}

/**
 * Sends email via Resend, then SMTP if Resend fails.
 * Resend test sender only delivers to the account owner — SMTP reaches bookers.
 */
async function sendEmail({ to, subject, html }) {
  const resendResult = await sendViaResend({ to, subject, html });
  if (resendResult.ok) return resendResult;

  console.error(`Resend to ${to} failed:`, resendResult.error);

  const smtpResult = await sendViaSmtp({ to, subject, html });
  if (smtpResult.ok) {
    console.log(`Email to ${to} sent via SMTP`);
    return smtpResult;
  }

  console.error(`SMTP to ${to} failed:`, smtpResult.error);
  return { ok: false, error: smtpResult.error || resendResult.error };
}

module.exports = { sendEmail, getFromAddress, OWNER_EMAIL };
