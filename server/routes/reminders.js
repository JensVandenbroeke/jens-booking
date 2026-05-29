const express = require('express');
const { Resend } = require('resend');
const db = require('../db');

const router = express.Router();
const FROM_ADDRESS = 'onboarding@resend.dev';
const APP_URL = 'https://book-a-call.jensvandenbroeke.com';
const API_URL = 'https://jens-booking-production.up.railway.app';

function formatEmailTime(isoString, language) {
  const date = new Date(isoString);
  const locale = language?.includes('Nederlands') ? 'nl-BE' : 'en-GB';
  return date.toLocaleString(locale, { weekday:'long',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Lisbon' }) + ' (Lisbon time)';
}

function reminderHtml(booking, hoursUntil) {
  const isNL = booking.language?.includes('Nederlands');
  const cancelUrl = `${API_URL}/api/cancel/${booking.id}`;
  const rescheduleUrl = `${APP_URL}?name=${encodeURIComponent(booking.name)}&email=${encodeURIComponent(booking.email)}`;
  const timeLabel = hoursUntil <= 1 ? (isNL ? 'over 1 uur' : 'in 1 hour') : (isNL ? 'morgen' : 'tomorrow');
  return `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
    <h2>⏰ ${isNL ? `Herinnering: je call is ${timeLabel}` : `Reminder: your call is ${timeLabel}`}</h2>
    <div style="background:#f5f5f5;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <table style="width:100%;font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#888;width:140px;">${isNL ? 'Sessie' : 'Session'}</td><td style="padding:6px 0;font-weight:600;">${booking.type}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">${isNL ? 'Tijd' : 'Time'}</td><td style="padding:6px 0;font-weight:600;">${formatEmailTime(booking.timeslot, booking.language)}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">${isNL ? 'Boeking' : 'Booking'}</td><td style="padding:6px 0;color:#888;">#${booking.bookingNumber}</td></tr>
      </table>
    </div>
    ${booking.meetLink ? `<div style="text-align:center;margin:24px 0;"><a href="${booking.meetLink}" style="background:#4285f4;color:white;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;">🎥 Join Google Meet</a></div>` : ''}
    <div style="margin:24px 0;">
      <a href="${cancelUrl}" style="background:#f5f5f5;color:#333;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;border:1px solid #ddd;margin-right:8px;">${isNL ? '❌ Annuleren' : '❌ Cancel'}</a>
      <a href="${rescheduleUrl}" style="background:#f5f5f5;color:#333;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;border:1px solid #ddd;">${isNL ? '🔄 Verplaatsen' : '🔄 Reschedule'}</a>
    </div>
    <p style="margin-top:32px;font-size:14px;">${isNL ? 'Tot snel,' : 'Talk soon,'}<br><strong>Jens</strong></p>
  </div>`;
}

router.get('/send-reminders', async (req, res) => {
  try {
    const bookings = await db.getBookingsForReminders();
    const now = new Date();
    const resend = new Resend(process.env.RESEND_API_KEY);
    let sent = 0;
    for (const booking of bookings) {
      const callTime = new Date(booking.timeslot);
      const hoursUntil = (callTime - now) / (1000 * 60 * 60);
      if (!booking.reminder24hSent && hoursUntil <= 24 && hoursUntil > 23) {
        await resend.emails.send({ from: FROM_ADDRESS, to: booking.email, subject: booking.language?.includes('Nederlands') ? 'Je call is morgen ⏰' : 'Your call is tomorrow ⏰', html: reminderHtml(booking, 24) });
        await db.markReminderSent(booking.id, '24h');
        sent++;
      }
      if (!booking.reminder1hSent && hoursUntil <= 1 && hoursUntil > 0.83) {
        await resend.emails.send({ from: FROM_ADDRESS, to: booking.email, subject: booking.language?.includes('Nederlands') ? 'Je call begint over 1 uur ⏰' : 'Your call starts in 1 hour ⏰', html: reminderHtml(booking, 1) });
        await db.markReminderSent(booking.id, '1h');
        sent++;
      }
    }
    res.json({ success: true, remindersSent: sent });
  } catch (err) { console.error('Reminder error:', err.message); res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
