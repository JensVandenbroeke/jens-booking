const { google } = require('googleapis');

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const API_URL = process.env.API_URL || 'https://jens-booking-production.up.railway.app';

function getOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${API_URL}/auth/callback`
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

function getServiceAccountAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !privateKey) return null;

  return new google.auth.JWT({
    email,
    key: privateKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
}

function getCalendarClient() {
  const oauth = getOAuthClient();
  if (oauth) {
    return google.calendar({ version: 'v3', auth: oauth });
  }
  const jwt = getServiceAccountAuth();
  if (jwt) {
    return google.calendar({ version: 'v3', auth: jwt });
  }
  throw new Error('No Google Calendar credentials configured (OAuth or service account)');
}

/** First ISO datetime when timeslot is "date1 / date2 / date3" (coaching). */
function parsePrimaryTimeslot(timeslot) {
  if (!timeslot) return null;
  const first = String(timeslot).split(' / ')[0].trim();
  const d = new Date(first);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractMeetLink(eventData) {
  return eventData.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || null;
}

async function createCalendarEvent(booking) {
  if (!CALENDAR_ID) {
    console.error('Calendar: GOOGLE_CALENDAR_ID is not set');
    return null;
  }

  const startDate = parsePrimaryTimeslot(booking.timeslot);
  if (!startDate) {
    console.error('Calendar: invalid timeslot:', booking.timeslot);
    return null;
  }

  try {
    const calendar = getCalendarClient();
    const durationMinutes = booking.type === 'Open Connection Call' ? 15 : 60;
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
    const timeZone = 'Europe/Lisbon';

    const insertRes = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      conferenceDataVersion: 1,
      sendUpdates: 'none',
      requestBody: {
        summary: `${booking.type} - ${booking.name} & Jens`,
        description: `Booking #${booking.bookingNumber}\nName: ${booking.name}\nEmail: ${booking.email}\nWhatsApp: ${booking.whatsapp || '-'}\nLanguage: ${booking.language}\nTimeslot: ${booking.timeslot}\nTopic: ${booking.topic || '-'}\nGoals: ${booking.goals || '-'}`,
        start: { dateTime: startDate.toISOString(), timeZone },
        end: { dateTime: endDate.toISOString(), timeZone },
        colorId: booking.type === 'Open Connection Call' ? '1' : '2',
        conferenceData: {
          createRequest: {
            requestId: `booking-${booking.id}-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
        extendedProperties: {
          private: { booking: 'true', bookingId: String(booking.id) },
        },
      },
    });

    let meetLink = extractMeetLink(insertRes.data);
    if (!meetLink && insertRes.data.id) {
      const fetched = await calendar.events.get({
        calendarId: CALENDAR_ID,
        eventId: insertRes.data.id,
      });
      meetLink = extractMeetLink(fetched.data);
    }

    if (!meetLink) {
      console.error('Calendar: event created but no Meet link returned', insertRes.data.id);
    }
    return meetLink;
  } catch (err) {
    console.error('Calendar event creation failed:', err.message);
    if (err.response?.data) console.error(JSON.stringify(err.response.data));
    return null;
  }
}

async function deleteCalendarEvent(bookingId) {
  if (!CALENDAR_ID) return;
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

module.exports = {
  getCalendarClient,
  parsePrimaryTimeslot,
  createCalendarEvent,
  deleteCalendarEvent,
};
