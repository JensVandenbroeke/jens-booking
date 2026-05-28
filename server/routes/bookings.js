const express = require('express');
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const { google } = require('googleapis');

const router = express.Router();
const DATA_FILE = path.join(__dirname, '../data/bookings.json');
const OWNER_EMAIL = 'jens.vandenbroeke1@gmail.com';
const FROM_ADDRESS = 'onboarding@resend.dev';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

function readBookings() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeBookings(bookings) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(bookings, null, 2), 'utf-8');
}

function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

async function createCalendarEvent(booking) {
  try {
    const calendar = getCalendarClient();
    const durationMinutes = booking.type === 'Open Connection Call' ? 15 : 60;
    const startDate = new Date(booking.timeslot);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

    await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: `📞 ${booking.type} — ${booking.name}`,
        description: `Name: ${booking.name}\nEmail: ${booking.email}\nWhatsApp: ${booking.whatsapp}\nLanguage: ${booking.language}\nTopic: ${booking.topic || '—'}\nGoals: ${booking.goals || '—'}`,
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() },
        extendedProperties: {
          private: { booking: 'true', bookingId: String(booking.id) },
        },
      },
    });
  } catch (err) {
    console.error('Calendar event creation failed:', err.message);
  }
}

router.post('/book', async (req, res) => {
  const { name, email, whatsapp, language, type, timeslot, topic, goals } = req.body;

  if (!name || !email || !timeslot) {
    return res.status(400).json({ error: 'name, email, and timeslot are required.' });
  }

  const booking = {
    id: Date.now(),
    name,
    email,
    whatsapp: whatsapp || '',
    language: language || '',
    type: type || '',
    timeslot,
    topic: topic || '',
    goals: goals || '',
    createdAt: new Date().toISOString(),
  };

  try {
    const bookings = readBookings();
bookings.push(booking);
    writeBookings(bookings);
  } catch (err) {
    console.error('File write error:', err.message);
    return res.status(500).json({ error: 'Failed to save booking.' });
  }

  await createCalendarEvent(booking);

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: email,
      subject: `Your ${type} is confirmed ✓`,
      html: `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">Hey ${name} 👋</h2>
      <p style="color: #555; margin-top: 0;">Your booking is confirmed. Here are the details:</p>
      <div style="background: #f5f5f5; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
          <tr><td style="padding: 6px 0; color: #888; width: 140px;">Session</td><td style="padding: 6px 0; font-weight: 600;">${type || '—'}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Time</td><td style="padding: 6px 0; font-weight: 600;">${new Date(booking.timeslot).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Lisbon' })} (Lisbon time)</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Language</td><td style="padding: 6px 0;">${language || '—'}</td></tr>
          ${topic ? `<tr><td style="padding: 6px 0; color: #888;">Topic</td><td style="padding: 6px 0;">${topic}</td></tr>` : ''}
          ${goals ? `<tr><td style="padding: 6px 0; color: #888;">Goals</td><td style="padding: 6px 0;">${goals}</td></tr>` : ''}
        </table>
      </div>
      <p style="font-size: 14px; color: #555;">I'll send you a link before the call. If you need to cancel or reschedule, reply to this email.</p>
      <p style="margin-top: 32px; font-size: 14px;">Talk soon,<br><strong>Jens</strong></p>
    </div>
  `,
    });

    await resend.emails.send({
      from: FROM_ADDRESS,
      to: OWNER_EMAIL,
      subject: `New Booking from ${name}`,
      html: `
        <h2>New booking received</h2>
        <ul>
          <li><strong>Name:</strong> ${name}</li>
          <li><strong>Email:</strong> ${email}</li>
          <li><strong>WhatsApp:</strong> ${whatsapp || '—'}</li>
          <li><strong>Language:</strong> ${language || '—'}</li>
          <li><strong>Session type:</strong> ${type || '—'}</li>
          <li><strong>Time slot:</strong> ${timeslot}</li>
          <li><strong>Topic:</strong> ${topic || '—'}</li>
          <li><strong>Goals:</strong> ${goals || '—'}</li>
          <li><strong>Booked at:</strong> ${booking.createdAt}</li>
        </ul>
      `,
    });
  } catch (err) {
    console.error('Email error:', err.message);
    return res.status(200).json({
      success: true,
      warning: 'Booking saved but email delivery failed.',
      booking,
    });
  }

  res.status(201).json({ success: true, booking });
});

module.exports = router;
