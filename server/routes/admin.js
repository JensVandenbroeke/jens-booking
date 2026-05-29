const express = require('express');
const db = require('../db');
const groupDb = require('../db/groupSessions');
const { createCalendarEvent } = require('../lib/calendar');
const { sendToGuest, sendToOwner, OWNER_EMAIL } = require('../lib/email');

const router = express.Router();
const APP_URL = process.env.APP_URL || 'https://book-a-call.jensvandenbroeke.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Quinta2026!';

function auth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.get('/bookings', auth, async (req, res) => {
  try {
    const { status, type, search } = req.query;
    const bookings = await db.getBookings({ status, type, search });
    res.json({ bookings, total: bookings.length });
  } catch (err) { res.status(500).json({ error: 'Failed to read bookings' }); }
});

router.get('/bookings/export', auth, async (req, res) => {
  try {
    const bookings = await db.getBookings({});
    const headers = ['ID','Booking#','Name','Email','WhatsApp','Language','Type','Timeslot','Topic','Goals','Status','Meet Link','Created At'];
    const rows = bookings.map(b => [b.id,b.bookingNumber,b.name,b.email,b.whatsapp,b.language,b.type,b.timeslot,b.topic,b.goals,b.status,b.meetLink||'',b.createdAt].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bookings.csv"');
    res.send(csv);
  } catch (err) { res.status(500).json({ error: 'Failed to export' }); }
});

router.get('/group-sessions', auth, async (req, res) => {
  try {
    const sessions = await groupDb.listSessions();
    const enriched = await Promise.all(
      sessions.map(async (s) => {
        const participants = await groupDb.getParticipants(s.id);
        const detail = await groupDb.getSessionDetail(s.id);
        return {
          ...s,
          shareUrl: `${APP_URL}/group/${s.token}`,
          respondedCount: participants.length,
          overlapCount: detail.overlaps.full.length,
        };
      })
    );
    res.json({ sessions: enriched });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list group sessions' });
  }
});

router.post('/group-sessions', auth, async (req, res) => {
  try {
    const { title, sessionType, expectedParticipants, notes } = req.body;
    const session = await groupDb.createSession({
      title,
      sessionType,
      expectedParticipants,
      notes,
    });
    res.status(201).json({
      session: {
        ...session,
        shareUrl: `${APP_URL}/group/${session.token}`,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

router.get('/group-sessions/:id', auth, async (req, res) => {
  try {
    const detail = await groupDb.getSessionDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    res.json({
      ...detail,
      shareUrl: `${APP_URL}/group/${detail.session.token}`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load session' });
  }
});

router.post('/group-sessions/:id/confirm', auth, async (req, res) => {
  try {
    const { finalTimeslot } = req.body;
    if (!finalTimeslot) return res.status(400).json({ error: 'finalTimeslot required' });

    const detail = await groupDb.getSessionDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Not found' });

    const { session, participants } = detail;
    const booking = {
      id: Date.now(),
      bookingNumber: await db.getNextBookingNumber(),
      name: session.title,
      email: participants[0]?.email || OWNER_EMAIL,
      whatsapp: '',
      language: 'English',
      type: `Group ${session.sessionType}`,
      timeslot: new Date(finalTimeslot).toISOString(),
      topic: session.title,
      goals: participants.map((p) => p.name).join(', '),
      status: 'confirmed',
      meetLink: null,
      createdAt: new Date().toISOString(),
    };

    const guestEmails = participants.map((p) => p.email).filter(Boolean);
    const meetLink = await createCalendarEvent(booking, { attendeeEmails: guestEmails });
    await groupDb.confirmSession(session.id, { finalTimeslot, meetLink });

    const timeStr = new Date(finalTimeslot).toLocaleString('en-GB', {
      weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Lisbon',
    }) + ' (Lisbon)';

    const html = `<div style="font-family:sans-serif;max-width:520px;">
      <h2>Your group call is confirmed</h2>
      <p><strong>${session.title}</strong></p>
      <p><strong>When:</strong> ${timeStr}</p>
      ${meetLink ? `<p><a href="${meetLink}">Join Google Meet</a></p>` : ''}
    </div>`;

    for (const p of participants) {
      await sendToGuest({ to: p.email, subject: `Group call confirmed — ${session.title}`, html });
    }
    await sendToOwner({
      to: OWNER_EMAIL,
      subject: `Group call confirmed: ${session.title}`,
      html: `<p>Confirmed for ${timeStr}. Participants: ${participants.map((p) => p.name).join(', ')}${meetLink ? `<br>Meet: ${meetLink}` : ''}</p>`,
    });

    res.json({ success: true, meetLink });
  } catch (err) {
    console.error('Confirm group session:', err.message);
    res.status(500).json({ error: err.message || 'Failed to confirm' });
  }
});

router.post('/group-sessions/:id/cancel', auth, async (req, res) => {
  try {
    await groupDb.cancelSession(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel' });
  }
});

router.post('/change-password', auth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Min 8 characters' });
  process.env.ADMIN_PASSWORD = newPassword;
  res.json({ success: true, message: 'Add ADMIN_PASSWORD to Railway Variables to make permanent.' });
});

module.exports = router;
