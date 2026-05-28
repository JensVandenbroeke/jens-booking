const express = require('express');
const { google } = require('googleapis');

const router = express.Router();

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const MIN_HOURS_AHEAD = 8;
const MAX_DAYS_AHEAD = 4;
const OPEN_CALL_DURATION = 15;

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

router.get('/available-slots', async (req, res) => {
  try {
    const calendar = getCalendarClient();
    const now = new Date();
    const minStart = new Date(now.getTime() + MIN_HOURS_AHEAD * 60 * 60 * 1000);
    const maxStart = new Date(now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000);

    const eventsRes = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: maxStart.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = eventsRes.data.items || [];
    const availableSlots = [];

    for (const event of events) {
      if (event.extendedProperties?.private?.booking === 'true') continue;

      const blockStart = new Date(event.start.dateTime || event.start.date);
      const blockEnd = new Date(event.end.dateTime || event.end.date);

      const bookingsInBlock = events.filter(e =>
        e.extendedProperties?.private?.booking === 'true' &&
        new Date(e.start.dateTime) >= blockStart &&
        new Date(e.end.dateTime) <= blockEnd
      );

      let slotStart = new Date(blockStart);
      while (slotStart < blockEnd) {
        const slotEnd = new Date(slotStart.getTime() + OPEN_CALL_DURATION * 60 * 1000);
        if (slotEnd > blockEnd) break;

        if (slotStart >= minStart) {
          const isBooked = bookingsInBlock.some(b => {
            const bStart = new Date(b.start.dateTime);
            const bEnd = new Date(b.end.dateTime);
            return slotStart < bEnd && slotEnd > bStart;
          });

          if (!isBooked) {
            availableSlots.push({
              start: slotStart.toISOString(),
              end: slotEnd.toISOString(),
              blockId: event.id,
            });
          }
        }

        slotStart = new Date(slotStart.getTime() + OPEN_CALL_DURATION * 1000 * 60);
      }
    }

    res.json({ slots: availableSlots });
  } catch (err) {
    console.error('Calendar error:', err.message);
    res.status(500).json({ error: 'Failed to fetch available slots.' });
  }
});

module.exports = router;
