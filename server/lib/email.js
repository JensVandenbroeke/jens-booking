const { Resend } = require('resend');
const nodemailer = require('nodemailer');

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'jens.vandenbroeke1@gmail.com').toLowerCase();

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function isOwnerEmail(to) {
  return normalizeEmail(to) === OWNER_EMAIL;
}

/** Resend test sender only delivers to the account owner until a domain is verified. */
function isResendSandbox() {
  if (process.env.RESEND_VERIFIED === 'true') return false;
  const from = (
    process.env.RESEND_FROM ||
    process.env.FROM_EMAIL ||
    'onboarding@resend.dev'
  ).toLowerCase();
  return from.includes('resend.dev');
}

function getResendFromAddress() {
  return process.env.RESEND_FROM || process.env.FROM_EMAIL || 'onboarding@resend.dev';
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
    from: getResendFromAddress(),
    to,
    subject,
    html,
  });
  if (error) return { ok: false, error: error.message || String(error) };
  return { ok: true, id: data?.id, provider: 'resend' };
}

async function sendViaSmtp({ to, subject, html }) {
  const transport = getSmtpTransport();
  if (!transport) {
    return {
      ok: false,
      error: 'SMTP not configured — set EMAIL_USER and EMAIL_PASS in Railway (Gmail app password).',
    };
  }
  try {
    const info = await transport.sendMail({
      from: `"Jens" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
    return { ok: true, id: info.messageId, provider: 'smtp' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Confirmation & reminders to the person who booked — must use SMTP while on Resend test domain. */
async function sendToGuest({ to, subject, html }) {
  if (isOwnerEmail(to)) {
    return sendToOwner({ to, subject, html });
  }

  const smtpResult = await sendViaSmtp({ to, subject, html });
  if (smtpResult.ok) {
    console.log(`Guest email to ${to} sent via SMTP`);
    return smtpResult;
  }

  if (!isResendSandbox()) {
    const resendResult = await sendViaResend({ to, subject, html });
    if (resendResult.ok) return resendResult;
    return { ok: false, error: resendResult.error || smtpResult.error };
  }

  console.error(`Guest email to ${to} failed (SMTP required):`, smtpResult.error);
  return smtpResult;
}

/** Notifications to you — Resend works on test domain for your own address. */
async function sendToOwner({ to, subject, html }) {
  const resendResult = await sendViaResend({ to, subject, html });
  if (resendResult.ok) return resendResult;

  console.error(`Resend to owner failed:`, resendResult.error);
  return sendViaSmtp({ to, subject, html });
}

/** @deprecated Use sendToGuest or sendToOwner */
async function sendEmail({ to, subject, html }) {
  return isOwnerEmail(to) ? sendToOwner({ to, subject, html }) : sendToGuest({ to, subject, html });
}

module.exports = {
  sendEmail,
  sendToGuest,
  sendToOwner,
  isResendSandbox,
  OWNER_EMAIL,
};
