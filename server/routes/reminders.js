const express = require('express');
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');

const router = express.Router();
const DATA_FILE = path.join(__dirname, '../data/bookings.json');
const OWNER_EMAIL = 'jens.vandenbroeke1@gmail.com';
const FROM_ADDRESS = 'onboarding@resend.dev';
const APP_URL = 'https://book-a-call.jensvandenbroeke.com';
const API_URL = 'https://jens-booking-production.up.railway.app';

function readBookings() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeBookings(bookings) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(bookings, null, 2), 'utf-8');
}

function formatEmailTime(isoString, language) {
  const date = new Date(isoString);
  const locale = language?.includes('Nederlands') ? 'nl-BE' : 'en-GB';
  return date.toLocaleString(locale, {
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Lisbon',
  }) + ' (Lisbon time)';
}

function reminderHtml(booking, hoursUntil) {
  const isNL = booking.language?.includes('Nederlands');
  const cancelUrl = `${API_URL}/api/cancel/${booking.id}`;
  const rescheduleUrl = `${APP_URL}?name=${encodeURIComponent(booking.name)}&email=${encodeURIComponent(booking.email)}&phone=${encodeURIComponent(booking.whatsapp || '')}&language=${encodeURIComponent(booking.language)}`;
  const formattedTime = formatEmailTime(booking.timeslot, booking.language);
  const timeLabel = hoursUntil <= 1 ? (isNL ? 'over 1 uur' : 'in 1 hour') : (isNL ? 'morgen' : 'tomorrow');

  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">⏰ ${isNL ? `Herinnering: je call is ${timeLabel}` : `Reminder: your call is ${timeLabel}`}</h2>
      <p style="color: #555; margin-top: 0;">${isNL ? 'Vergeet je call niet!' : "Don't forget your upcoming call!"}</p>

      <div style="background: #f5f5f5; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
          <tr><td style="padding: 6px 0; color: #888; width: 140px;">${isNL ? 'Sessie' : 'Session'}</td><td style="padding: 6px 0; font-weight: 600;">${booking.type}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">${isNL ? 'Tijd' : 'Time'}</td><td style="padding: 6px 0; font-weight: 600;">${formattedTime}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">${isNL ? 'Boeking' : 'Booking'}</td><td style="padding: 6px 0; color: #888;">#${booking.bookingNumber}</td></tr>
        </table>
      </div>

      ${booking.meetLink ? `
      <div style="text-align: center; margin: 24px 0;">
        <a href="${booking.meetLink}" style="background: #4285f4; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 15px;">
          🎥 ${isNL ? 'Deelnemen aan Google Meet' : 'Join Google Meet'}
        </a>
        <p style="font-size: 12px; color: #888; margin-top: 8px;">${booking.meetLink}</p>
      </div>` : ''}

      <div style="margin: 24px 0; display: flex; gap: 12px;">
        <a href="${cancelUrl}" style="background: #f5f5f5; color: #333; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; border: 1px solid #ddd;">
          ${isNL ? '❌ Annuleren' : '❌ Cancel'}
        </a>
        <a href="${rescheduleUrl}" style="background: #f5f5f5; color: #333; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; border: 1px solid #ddd;">
          ${isNL ? '🔄 Verplaatsen' : '🔄 Reschedule'}
        </a>
      </div>

      <p style="margin-top: 32px; font-size: 14px;">${isNL ? 'Tot snel,' : 'Talk soon,'}<br><strong>Jens</strong></p>
    </div>
  `;
}

router.get('/send-reminders', async (req, res) => {
  try {
    const bookings = readBookings();
    const now = new Date();
    const resend = new Resend(process.env.RESEND_API_KEY);
    let sent = 0;

    for (const booking of bookings) {
      if (booking.status === 'cancelled') continue;
      if (!booking.timeslot) continue;

      const callTime = new Date(booking.timeslot);
      const msUntilCall = callTime - now;
      const hoursUntil = msUntilCall / (1000 * 60 * 60);

      const already24h = booking.reminder24hSent;
      const already1h = booking.reminder1hSent;

      // 24h reminder: between 24h and 23h before call
      if (!already24h && hoursUntil <= 24 && hoursUntil > 23) {
        try {
          await resend.emails.send({
            from: FROM_ADDRESS,
            to: booking.email,
            subject: booking.language?.includes('Nederlands')
              ? `Herinnering: je call is morgen ⏰`
              : `Reminder: your call is tomorrow ⏰`,
            html: reminderHtml(booking, 24),
          });
          booking.reminder24hSent = true;
          sent++;
        } catch (err) {
          console.error(`24h reminder failed for booking ${booking.id}:`, err.message);
        }
      }

      // 1h reminder: between 1h and 50min before call
      if (!already1h && hoursUntil <= 1 && hoursUntil > 0.83) {
        try {
          await resend.emails.send({
            from: FROM_ADDRESS,
            to: booking.email,
            subject: booking.language?.includes('Nederlands')
              ? `Je call begint over 1 uur ⏰`
              : `Your call starts in 1 hour ⏰`,
            html: reminderHtml(booking, 1),
          });
          booking.reminder1hSent = true;
          sent++;
        } catch (err) {
          console.error(`1h reminder failed for booking ${booking.id}:`, err.message);
        }
      }
    }

    writeBookings(bookings);
    res.json({ success: true, remindersSent: sent });
  } catch (err) {
    console.error('Reminder error:', err.message);
    res.status(500).json({ error: 'Failed to process reminders' });
  }
});

module.exports = router;
