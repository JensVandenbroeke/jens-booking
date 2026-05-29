const express = require('express');
const db = require('../db');
const { createCalendarEvent, deleteCalendarEvent, parsePrimaryTimeslot } = require('../lib/calendar');
const { sendEmail, OWNER_EMAIL } = require('../lib/email');

const router = express.Router();
const APP_URL = 'https://book-a-call.jensvandenbroeke.com';
const API_URL = process.env.API_URL || 'https://jens-booking-production.up.railway.app';

function formatEmailTime(isoString, language) {
  const primary = parsePrimaryTimeslot(isoString);
  if (!primary) return isoString;
  const locale = language?.includes('Nederlands') ? 'nl-BE' : 'en-GB';
  return primary.toLocaleString(locale, {
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon',
  }) + ' (Lisbon time)';
}

function confirmationEmailHtml(booking, meetLink, language) {
  const isNL = language?.includes('Nederlands');
  const cancelUrl = `${API_URL}/api/cancel/${booking.id}`;
  const rescheduleUrl = `${APP_URL}?name=${encodeURIComponent(booking.name)}&email=${encodeURIComponent(booking.email)}&phone=${encodeURIComponent(booking.whatsapp || '')}&language=${encodeURIComponent(booking.language)}`;
  const formattedTime = formatEmailTime(booking.timeslot, language);
  return `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
    <h2>${isNL ? 'Hey' : 'Hey'} ${booking.name} 👋</h2>
    <p style="color:#555;">${isNL ? 'Je boeking is bevestigd.' : 'Your booking is confirmed.'}</p>
    <div style="background:#f5f5f5;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <table style="width:100%;font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#888;width:140px;">${isNL ? 'Sessie' : 'Session'}</td><td style="padding:6px 0;font-weight:600;">${booking.type}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">${isNL ? 'Tijd' : 'Time'}</td><td style="padding:6px 0;font-weight:600;">${formattedTime}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">${isNL ? 'Taal' : 'Language'}</td><td style="padding:6px 0;">${booking.language}</td></tr>
        ${booking.topic ? `<tr><td style="padding:6px 0;color:#888;">Topic</td><td style="padding:6px 0;">${booking.topic}</td></tr>` : ''}
        <tr><td style="padding:6px 0;color:#888;">${isNL ? 'Boeking' : 'Booking'}</td><td style="padding:6px 0;color:#888;">#${booking.bookingNumber}</td></tr>
      </table>
    </div>
    ${meetLink ? `<div style="text-align:center;margin:24px 0;"><a href="${meetLink}" style="background:#4285f4;color:white;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;">🎥 Join Google Meet</a><p style="font-size:12px;color:#888;margin-top:8px;">${meetLink}</p></div>` : '<p style="font-size:13px;color:#888;">A Google Meet link will be shared before your call if not shown here.</p>'}
    <p style="font-size:14px;color:#555;">${isNL ? 'We respecteren ieders tijd — annuleer zo vroeg mogelijk als je niet kan.' : "We respect everyone's time — please cancel as early as possible if needed."}</p>
    <div style="margin:24px 0;">
      <a href="${cancelUrl}" style="background:#f5f5f5;color:#333;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;border:1px solid #ddd;margin-right:8px;">${isNL ? '❌ Annuleren' : '❌ Cancel'}</a>
      <a href="${rescheduleUrl}" style="background:#f5f5f5;color:#333;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;border:1px solid #ddd;">${isNL ? '🔄 Verplaatsen' : '🔄 Reschedule'}</a>
    </div>
    <p style="margin-top:32px;font-size:14px;">${isNL ? 'Tot snel,' : 'Talk soon,'}<br><strong>Jens</strong></p>
  </div>`;
}

function ownerNotificationHtml({ bookingNumber, name, email, whatsapp, language, type, timeslot, topic, goals, meetLink }) {
  return `<div style="font-family:sans-serif;max-width:520px;">
  <h2>New Booking #${bookingNumber}</h2>
  <table style="width:100%;font-size:14px;border-collapse:collapse;">
    <tr><td style="padding:6px 0;color:#888;width:120px;">Name</td><td style="padding:6px 0;"><strong>${name}</strong></td></tr>
    <tr><td style="padding:6px 0;color:#888;">Email</td><td style="padding:6px 0;">${email}</td></tr>
    <tr><td style="padding:6px 0;color:#888;">WhatsApp</td><td style="padding:6px 0;">${whatsapp || '—'}</td></tr>
    <tr><td style="padding:6px 0;color:#888;">Language</td><td style="padding:6px 0;">${language || '—'}</td></tr>
    <tr><td style="padding:6px 0;color:#888;">Type</td><td style="padding:6px 0;">${type || '—'}</td></tr>
    <tr><td style="padding:6px 0;color:#888;">Time</td><td style="padding:6px 0;">${formatEmailTime(timeslot, 'en-GB')}</td></tr>
    <tr><td style="padding:6px 0;color:#888;">Topic</td><td style="padding:6px 0;">${topic || '—'}</td></tr>
    <tr><td style="padding:6px 0;color:#888;">Goals</td><td style="padding:6px 0;">${goals || '—'}</td></tr>
    ${meetLink ? `<tr><td style="padding:6px 0;color:#888;">Meet</td><td style="padding:6px 0;"><a href="${meetLink}">${meetLink}</a></td></tr>` : '<tr><td style="padding:6px 0;color:#888;">Meet</td><td style="padding:6px 0;color:#c00;">Not created — check Google Calendar credentials in Railway</td></tr>'}
  </table>
</div>`;
}

router.post('/book', async (req, res) => {
  const { name, email, whatsapp, language, type, timeslot, topic, goals } = req.body;
  if (!name || !email || !timeslot) {
    return res.status(400).json({ error: 'name, email, and timeslot are required.' });
  }
  if (!parsePrimaryTimeslot(timeslot)) {
    return res.status(400).json({ error: 'Invalid time slot format.' });
  }

  const existing = await db.getBookings({ status: 'confirmed' });
  const duplicate = existing.find((b) => b.timeslot === timeslot);
  if (duplicate) {
    return res.status(409).json({ error: 'This time slot was just booked. Please choose another time.' });
  }

  const bookingNumber = await db.getNextBookingNumber();
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

  await db.saveBooking(booking);

  const meetLink = await createCalendarEvent(booking);
  if (meetLink) {
    await db.updateBookingMeetLink(booking.id, meetLink);
    booking.meetLink = meetLink;
  }

  const isNL = language?.includes('Nederlands');
  const emailWarnings = [];

  const guestResult = await sendEmail({
    to: email,
    subject: isNL ? `Je ${type} is bevestigd ✓` : `Your ${type} is confirmed ✓`,
    html: confirmationEmailHtml(booking, meetLink, language),
  });
  if (!guestResult.ok) emailWarnings.push(`Guest email failed: ${guestResult.error}`);

  const ownerResult = await sendEmail({
    to: OWNER_EMAIL,
    subject: `New Booking #${bookingNumber} from ${name}`,
    html: ownerNotificationHtml({ bookingNumber, name, email, whatsapp, language, type, timeslot, topic, goals, meetLink }),
  });
  if (!ownerResult.ok) emailWarnings.push(`Owner email failed: ${ownerResult.error}`);

  res.status(201).json({
    success: true,
    booking,
    meetLinkCreated: !!meetLink,
    emailWarnings: emailWarnings.length ? emailWarnings : undefined,
  });
});

router.get('/cancel/:bookingId', async (req, res) => {
  const bookingId = parseInt(req.params.bookingId);
  try {
    const booking = await db.findBookingById(bookingId);
    if (!booking) {
      return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0a;color:white;"><h2>Booking not found</h2><a href="${APP_URL}" style="color:#6366f1;">Book a new call</a></body></html>`);
    }
    if (booking.status === 'cancelled') {
      return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0a;color:white;"><h2>Already cancelled</h2><a href="${APP_URL}" style="display:inline-block;margin-top:20px;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">Book a new call</a></body></html>`);
    }
    await db.cancelBooking(bookingId);
    await deleteCalendarEvent(String(bookingId));
    await sendEmail({
      to: OWNER_EMAIL,
      subject: `Booking #${booking.bookingNumber} cancelled by ${booking.name}`,
      html: `<p><strong>${booking.name}</strong> cancelled booking #${booking.bookingNumber} for ${formatEmailTime(booking.timeslot, 'en-GB')}.</p>`,
    });
    const isNL = booking.language?.includes('Nederlands');
    const rescheduleUrl = `${APP_URL}?name=${encodeURIComponent(booking.name)}&email=${encodeURIComponent(booking.email)}&phone=${encodeURIComponent(booking.whatsapp || '')}&language=${encodeURIComponent(booking.language)}`;
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0a;color:white;"><div style="max-width:480px;margin:0 auto;"><div style="font-size:48px;margin-bottom:16px;">✓</div><h2>${isNL ? 'Boeking geannuleerd' : 'Booking cancelled'}</h2><p style="color:#999;">#${booking.bookingNumber}</p><p style="color:#ccc;margin:24px 0;">${isNL ? 'Wil je een nieuwe tijd kiezen?' : 'Would you like to book a new time?'}</p><a href="${rescheduleUrl}" style="display:inline-block;background:#6366f1;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;">${isNL ? 'Nieuwe boeking' : 'Book a new call'}</a></div></body></html>`);
  } catch (err) {
    console.error('Cancel error:', err.message);
    res.status(500).send('Something went wrong.');
  }
});

module.exports = router;
