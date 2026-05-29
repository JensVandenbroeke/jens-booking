const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');

const router = express.Router();
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function getCalendarClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    'https://jens-booking-production.up.railway.app/auth/callback'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
  });
}

async function getUpcomingEvents() {
  const calendar = getCalendarClient();
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: now.toISOString(),
    timeMax: weekAhead.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  });
  return res.data.items || [];
}

async function createCalendarEvent(summary, startTime, endTime, description = '') {
  const calendar = getCalendarClient();
  await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary,
      description,
      start: { dateTime: startTime },
      end: { dateTime: endTime },
    },
  });
}

async function processMessage(userMessage) {
  const events = await getUpcomingEvents();
  const eventsText = events.map(e => {
    const start = e.start.dateTime || e.start.date;
    return `- ${e.summary} op ${start}`;
  }).join('\n');

  const now = new Date().toISOString();
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `Je bent een persoonlijke planning assistent voor Jens Vandenbroeke.
Huidige tijd: ${now}
Jens zijn agenda voor de komende week:
${eventsText || 'Geen afspraken gevonden'}

Bericht van Jens: "${userMessage}"

Je taken:
1. Als Jens iets wil inplannen, geef dan een JSON response met:
   {"action": "create_event", "summary": "naam", "start": "ISO datetime", "end": "ISO datetime", "description": "optionele beschrijving", "message": "bevestiging voor Jens"}
2. Als Jens zijn agenda wil zien, geef dan:
   {"action": "show_agenda", "message": "overzicht van de agenda"}
3. Voor andere vragen:
   {"action": "reply", "message": "jouw antwoord"}

Reageer ALTIJD in het Nederlands. Reageer ALLEEN met valid JSON, geen extra tekst.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

router.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const update = req.body;
    if (!update.message) return;

    const chatId = String(update.message.chat.id);
    if (chatId !== TELEGRAM_CHAT_ID) return;

    const text = update.message.text;
    if (!text) {
      await sendTelegram('Ik begrijp momenteel alleen tekstberichten. Voiceberichten komen binnenkort!');
      return;
    }

    await sendTelegram('⏳ Even nadenken...');

    const response = await processMessage(text);

    if (response.action === 'create_event') {
      await createCalendarEvent(response.summary, response.start, response.end, response.description);
      await sendTelegram(`✅ ${response.message}`);
    } else {
      await sendTelegram(response.message);
    }

  } catch (err) {
    console.error('Scheduler error:', err.message);
    await sendTelegram('❌ Er ging iets mis. Probeer opnieuw.');
  }
});

router.get('/set-webhook', async (req, res) => {
  const webhookUrl = `https://jens-booking-production.up.railway.app/api/scheduler/webhook`;
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${webhookUrl}`);
  const data = await response.json();
  res.json(data);
});

module.exports = router;
