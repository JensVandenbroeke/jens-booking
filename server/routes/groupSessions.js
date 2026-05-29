const express = require('express');
const groupDb = require('../db/groupSessions');
const { getAvailableSlots } = require('../lib/availability');

const router = express.Router();
const APP_URL = process.env.APP_URL || 'https://book-a-call.jensvandenbroeke.com';

const MIN_SLOTS = 3;
const MAX_SLOTS = 5;

function slotTimeKey(iso) {
  return new Date(iso).getTime();
}

function buildOtherParticipants(participants, preferences, excludeEmail) {
  const exclude = excludeEmail?.toLowerCase().trim();
  const prefsByEmail = {};

  for (const p of preferences) {
    const email = p.participantEmail.toLowerCase();
    if (!prefsByEmail[email]) prefsByEmail[email] = [];
    prefsByEmail[email].push(new Date(p.slotStart).toISOString());
  }

  return participants
    .filter((p) => p.email.toLowerCase() !== exclude)
    .map((p, index) => ({
      order: index + 1,
      name: p.name,
      slots: (prefsByEmail[p.email.toLowerCase()] || []).map((start) => ({ start })),
    }))
    .filter((p) => p.slots.length > 0);
}

function buildOthersBySlot(otherParticipants) {
  const map = {};
  for (const person of otherParticipants) {
    for (const slot of person.slots) {
      const key = String(slotTimeKey(slot.start));
      if (!map[key]) map[key] = [];
      if (!map[key].includes(person.name)) map[key].push(person.name);
    }
  }
  return map;
}

function getParticipantOrder(participants, email) {
  if (!email) return null;
  const normalized = email.toLowerCase().trim();
  const idx = participants.findIndex((p) => p.email.toLowerCase() === normalized);
  if (idx === -1) return participants.length + 1;
  return idx + 1;
}

router.get('/group/:token', async (req, res) => {
  try {
    const session = await groupDb.findSessionByToken(req.params.token);
    if (!session) return res.status(404).json({ error: 'Scheduling link not found.' });

    const participants = await groupDb.getParticipants(session.id);
    const preferences = await groupDb.getPreferences(session.id);
    const excludeEmail = req.query.email;

    let jensSlots = [];
    try {
      jensSlots = await getAvailableSlots();
    } catch (err) {
      console.error('Group session: could not load Jens slots:', err.message);
    }

    const otherParticipants = buildOtherParticipants(participants, preferences, excludeEmail);
    const othersBySlot = buildOthersBySlot(otherParticipants);
    const mySubmission = excludeEmail
      ? await groupDb.getMySubmission(session.id, excludeEmail)
      : null;
    const yourOrder = getParticipantOrder(participants, excludeEmail);

    res.json({
      session: {
        title: session.title,
        sessionType: session.sessionType,
        expectedParticipants: session.expectedParticipants,
        status: session.status,
        finalTimeslot: session.finalTimeslot,
        meetLink: session.meetLink,
      },
      respondedCount: participants.length,
      shareUrl: `${APP_URL}/group/${session.token}`,
      jensSlots,
      otherParticipants,
      othersBySlot,
      mySubmission,
      yourOrder,
      minSlots: MIN_SLOTS,
      maxSlots: MAX_SLOTS,
    });
  } catch (err) {
    console.error('Group session fetch error:', err.message);
    res.status(500).json({ error: 'Failed to load session.' });
  }
});

router.post('/group/:token/submit', async (req, res) => {
  try {
    const session = await groupDb.findSessionByToken(req.params.token);
    if (!session) return res.status(404).json({ error: 'Scheduling link not found.' });
    if (session.status === 'confirmed') {
      return res.status(400).json({ error: 'This call is already scheduled.' });
    }
    if (session.status === 'cancelled') {
      return res.status(400).json({ error: 'This scheduling link is no longer active.' });
    }

    const { name, email, whatsapp, slots } = req.body;
    if (!name?.trim() || !email?.trim()) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }
    if (!Array.isArray(slots) || slots.length < MIN_SLOTS || slots.length > MAX_SLOTS) {
      return res.status(400).json({
        error: `Please select ${MIN_SLOTS} to ${MAX_SLOTS} time slots.`,
      });
    }

    const validSlots = slots.filter((s) => !Number.isNaN(new Date(s).getTime()));
    if (validSlots.length !== slots.length) {
      return res.status(400).json({ error: 'Invalid time slot.' });
    }

    let jensSlots = [];
    try {
      jensSlots = await getAvailableSlots();
    } catch (_) { /* allow if calendar down */ }

    if (jensSlots.length > 0) {
      const allowed = new Set(jensSlots.map((s) => slotTimeKey(s.start)));
      const invalid = validSlots.some((s) => !allowed.has(slotTimeKey(s)));
      if (invalid) {
        return res.status(400).json({ error: 'Please only choose from Jens\'s available time slots.' });
      }
    }

    await groupDb.submitPreferences(session.id, {
      name,
      email,
      whatsapp,
      slots: validSlots,
    });

    const participants = await groupDb.getParticipants(session.id);
    res.json({
      success: true,
      message: 'Your availability has been saved. You can return to this link anytime to update your slots.',
      respondedCount: participants.length,
      expectedParticipants: session.expectedParticipants,
    });
  } catch (err) {
    console.error('Group submit error:', err.message);
    res.status(500).json({ error: 'Failed to save your availability.' });
  }
});

module.exports = router;
