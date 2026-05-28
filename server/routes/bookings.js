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
const APP_URL = 'https://book-a-call.jensvandenbroeke.com';
const API_URL = 'https://jens-booking-production.up.railway.app';

function readBookings() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeBookings(bookings) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(bookings, null, 2), 'utf-8');
}

function generateBookingId() {
  const bookings = readBookings();
  const maxId = bookings.reduce((max, b) => Math.max(max, b.bookingNumber || 0), 1000);
  return maxId + 1;
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

    const event = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      conferenceDataVersion: 1,
      requestBody: {
        summary: `${booking.type} - ${booking.name} & Jens`,
        description: `📋 BOOKING #${booking.bookingNumber}\n\n👤 Name: ${booking.name}\n📧 Email: ${booking.email}\n📱 WhatsApp: ${booking.whatsapp || '—'}\n🌐 Language: ${booking.language}\n📝 Topic: ${booking.topic || '—'}\n🎯 Goals: ${booking.goals || '—'}\n\n📅 Booked on: ${new Date(booking.createdAt).toLocaleString('en-GB', { timeZone: 'Europe/Lisbon' })}`,
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() },
        colorId: booking.type === 'Open Connection Call' ? '1' : '2',
        conferenceData: {
          createRequest: {
            requestId: `booking-${booking.id}`,
            conferenceSolutionKey: { type: 'eventHangout' },
          },
        },
        extendedProperties: {
          private: { booking: 'true', bookingId: String(booking.id) },
        },
      },
    });

    const meetLink = event.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || null;
    return meetLink;
  } catch (err) {
    console.error('Calendar event creation failed:', err.message);
    return null;
  }
}

async function deleteCalendarEvent(bookingId) {
  try {
    const calendar = getCalendarClient();
    const eventsRes = await calendar.events.list({
      calendarId: CALENDAR_ID,
      privateExtendedProperty: `bookingId=${bookingId}`,
    });
    const event = eventsRes.data.items?.[0];
    if (event) {
      await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: event.id });
    }
  } catch (err) {
    console.error('Calendar event deletion failed:', err.message);
  }
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

function confirmationEmailHtml(booking, meetLink, language) {
  const isNL = language?.includes('Nederlands');
  const cancelUrl = `${API_URL}/api/cancel/${booking.id}`;
  const rescheduleUrl = `${APP_URL}?name=${encodeURIComponent(booking.name)}&email=${encodeURIComponent(booking.email)}&phone=${encodeURIComponent(booking.whatsapp || '')}&language=${encodeURIComponent(booking.language)}`;
  const formattedTime = formatEmailTime(booking.timeslot, language);

  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">${isNL ? 'Hey' : 'Hey'} ${booking.name} 👋</h2>
      <p style="color: #555; margin-top: 0;">${isNL ? 'Je boeking is bevestigd. Hier zijn de details:' : 'Your booking is confirmed. Here are the details:'}</p>

      <div style="background: #f5f5f5; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
          <tr><td style="padding: 6px 0; color: #888; width: 140px;">${isNL ? 'Sessie' : 'Session'}</td><td style="padding: 6px 0; font-weight: 600;">${booking.type}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">${isNL ? 'Tijd' : 'Time'}</td><td style="padding: 6px 0; font-weight: 600;">${formattedTime}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">${isNL ? 'Taal' : 'Language'}</td><td style="padding: 6px 0;">${booking.language}</td></tr>
          ${booking.topic ? `<tr><td style="padding: 6px 0; color: #888;">Topic</td><td style="padding: 6px 0;">${booking.topic}</td></tr>` : ''}
          ${booking.goals ? `<tr><td style="padding: 6px 0; color: #888;">Goals</td><td style="padding: 6px 0;">${booking.goals}</td></tr>` : ''}
          <tr><td style="padding: 6px 0; color: #888;">${isNL ? 'Boeking' : 'Booking'}</td><td style="padding: 6px 0; color: #888;">#${booking.bookingNumber}</td></tr>
        </table>
      </div>

      ${meetLink ? `
      <div style="text-align: center; margin: 24px 0;">
        <a href="${meetLink}" style="background: #4285f4; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 15px;">
          🎥 ${isNL ? 'Deelnemen aan Google Meet' : 'Join Google Meet'}
        </a>
        <p style="font-size: 12px; color: #888; margin-top: 8px;">${meetLink}</p>
      </div>` : ''}

      <p style="font-size: 14px; color: #555;">${isNL ? 'We respecteren ieders tijd — als je moet annuleren, doe dit dan zo vroeg mogelijk.' : 'We respect everyone\'s time — if you need to cancel, please do so as early as possible.'}</p>

      <div style="margin: 24px 0; display: flex; gap: 12px;">
        <a href="${cancelUrl}" style="background: #f5f5f5; color: #333; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; border: 1px solid #ddd;">
          ${isNL ? '❌ Annuleren' : '❌ Cancel booking'}
        </a>
        <a href="${rescheduleUrl}" style="background: #f5f5f5; color: #333; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; border: 1px solid #ddd;">
          ${isNL ? '🔄 Verplaatsen' : '🔄 Reschedule'}
        </a>
      </div>

      <p style="margin-top: 32px; font-size: 14px;">${isNL ? 'Tot snel,' : 'Talk soon,'}<br><strong>Jens</strong></p>
      <p style="font-size: 11px; color: #aaa; margin-top: 24px; border-top: 1px solid #eee; padding-top: 12px;">
        ${isNL ? 'Je ontvangt deze email omdat je een call hebt geboekt via' : 'You received this email because you booked a call via'} book-a-call.jensvandenbroeke.com
      </p>
    </div>
  `;
}

router.post('/book', async (req, res) => {
  const { name, email, whatsapp, language, type, timeslot, topic, goals } = req.body;

  if (!name || !email || !timeslot) {
    return res.status(400).json({ error: 'name, email, and timeslot are required.' });
  }

  // Double booking protection
  const existingBookings = readBookings();
  const duplicate = existingBookings.find(b => b.timeslot === timeslot && b.status !== 'cancelled');
  if (duplicate) {
    return res.status(409).json({ error: 'This time slot was just booked. Please choose another time.' });
  }

  const bookingNumber = generateBookingId();

  const booking = {
    id: Date.now(),
    bookingNumber,
    name,
    email,
    whatsapp: whatsapp || '',
    language: language || '',
    type: type || '',
    timeslot,
    topic: topic || '',
    goals: goals || '',
    status: 'confirmed',
    meetLink: null,
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

  const meetLink = await createCalendarEvent(booking);

  // Save meet link to booking
  if (meetLink) {
    try {
      const bookings = readBookings();
      const idx = bookings.findIndex(b => b.id === booking.id);
      if (idx !== -1) { bookings[idx].meetLink = meetLink; writeBookings(bookings); }
      booking.meetLink = meetLink;
    } catch (err) { console.error('Failed to save meet link:', err.message); }
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const isNL = language?.includes('Nederlands');

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: email,
      subject: isNL ? `Je ${type} is bevestigd ✓` : `Your ${type} is confirmed ✓`,
      html: confirmationEmailHtml(booking, meetLink, language),
    });

    await resend.emails.send({
      from: FROM_ADDRESS,
      to: OWNER_EMAIL,
      subject: `New Booking #${bookingNumber} from ${name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
          <h2>New booking #${bookingNumber}</h2>
          <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #888; width: 120px;">Name</td><td style="padding: 6px 0;"><strong>${name}</strong></td></tr>
            <tr><td style="padding: 6px 0; color: #888;">Email</td><td style="padding: 6px 0;">${email}</td></tr>
            <tr><td style="padding: 6px 0; color: #888;">WhatsApp</td><td style="padding: 6px 0;">${whatsapp || '—'}</td></tr>
            <tr><td style="padding: 6px 0; color: #888;">Language</td><td style="padding: 6px 0;">${language || '—'}</td></tr>
            <tr><td style="padding: 6px 0; color: #888;">Type</td><td style="padding: 6px 0;">${type || '—'}</td></tr>
            <tr><td style="padding: 6px 0; color: #888;">Time</td><td style="padding: 6px 0;">${formatEmailTime(timeslot, 'en-GB')}</td></tr>
            <tr><td style="padding: 6px 0; color: #888;">Topic</td><td style="padding: 6px 0;">${topic || '—'}</td></tr>
            <tr><td style="padding: 6px 0; color: #888;">Goals</td><td style="padding: 6px 0;">${goals || '—'}</td></tr>
            ${meetLink ? `<tr><td style="padding: 6px 0; color: #888;">Meet link</td><td style="padding: 6px 0;"><a href="${meetLink}">${meetLink}</a></td></tr>` : ''}
          </table>
        </div>
      `,
    });
  } catch (err) {
    console.error('Email error:', err.message);
    return res.status(200).json({ success: true, warning: 'Booking saved but email failed.', booking });
  }

  res.status(201).json({ success: true, booking });
});

router.get('/cancel/:bookingId', async (req, res) => {
  const bookingId = parseInt(req.params.bookingId);

  try {
    const bookings = readBookings();
    const idx = bookings.findIndex(b => b.id === bookingId);

    if (idx === -1) {
      return res.send(`
        <html><body style="font-family: sans-serif; text-align: center; padding: 60px; background: #0a0a0a; color: white;">
          <h2>Booking not found</h2>
          <a href="${APP_URL}" style="color: #6366f1;">Book a new call</a>
        </body></html>
      `);
    }

    const booking = bookings[idx];

    if (booking.status === 'cancelled') {
      return res.send(`
        <html><body style="font-family: sans-serif; text-align: center; padding: 60px; background: #0a0a0a; color: white;">
          <h2>This booking was already cancelled</h2>
          <a href="${APP_URL}" style="display: inline-block; margin-top: 20px; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Book a new call</a>
        </body></html>
      `);
    }

    bookings[idx].status = 'cancelled';
    bookings[idx].cancelledAt = new Date().toISOString();
    writeBookings(bookings);

    await deleteCalendarEvent(String(bookingId));

    const resend = new Resend(process.env.RESEND_API_KEY);
    const isNL = booking.language?.includes('Nederlands');

    await resend.emails.send({
      from: FROM_ADDRESS,
      to: OWNER_EMAIL,
      subject: `Booking #${booking.bookingNumber} cancelled by ${booking.name}`,
      html: `<p><strong>${booking.name}</strong> (${booking.email}) cancelled booking #${booking.bookingNumber} for ${formatEmailTime(booking.timeslot, 'en-GB')}.</p>`,
    });

    const rescheduleUrl = `${APP_URL}?name=${encodeURIComponent(booking.name)}&email=${encodeURIComponent(booking.email)}&phone=${encodeURIComponent(booking.whatsapp || '')}&language=${encodeURIComponent(booking.language)}`;

    res.send(`
      <html><body style="font-family: sans-serif; text-align: center; padding: 60px; background: #0a0a0a; color: white;">
        <div style="max-width: 480px; margin: 0 auto;">
          <div style="font-size: 48px; margin-bottom: 16px;">✓</div>
          <h2 style="margin-bottom: 8px;">${isNL ? 'Boeking geannuleerd' : 'Booking cancelled'}</h2>
          <p style="color: #999; margin-bottom: 32px;">${isNL ? 'Je boeking #' : 'Your booking #'}${booking.bookingNumber} ${isNL ? 'is geannuleerd.' : 'has been cancelled.'}</p>
          <p style="color: #ccc; margin-bottom: 32px;">${isNL ? 'Wil je een nieuwe tijd kiezen?' : 'Would you like to book a new time?'}</p>
          <a href="${rescheduleUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            ${isNL ? '📅 Nieuwe boeking plaatsen' : '📅 Book a new call'}
          </a>
        </div>
      </body></html>
    `);
  } catch (err) {
    console.error('Cancel error:', err.message);
    res.status(500).send('Something went wrong. Please try again.');
  }
});

module.exports = router;
