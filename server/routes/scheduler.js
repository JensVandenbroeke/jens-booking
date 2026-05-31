const express = require('express');
const { google } = require('googleapis');
const { askAI } = require('../lib/ai');

const router = express.Router();
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

// In-memory conversation history: chatId -> array of {role, content}
const conversationHistory = new Map();

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

async function getAllCalendars() {
  const calendar = getCalendarClient();
  const res = await calendar.calendarList.list();
  return (res.data.items || []).map(c => ({ id: c.id, name: c.summary }));
}

async function getUpcomingEvents() {
  const calendar = getCalendarClient();
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const params = {
    timeMin: now.toISOString(),
    timeMax: weekAhead.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  };

  const calendarIds = ['primary'];
  if (CALENDAR_ID && CALENDAR_ID !== 'primary') calendarIds.push(CALENDAR_ID);

  const results = await Promise.all(
    calendarIds.map(id => calendar.events.list({ calendarId: id, ...params }))
  );

  const seen = new Set();
  const merged = [];
  for (const res of results) {
    for (const event of (res.data.items || [])) {
      if (!seen.has(event.id)) {
        seen.add(event.id);
        merged.push(event);
      }
    }
  }
  merged.sort((a, b) => {
    const ta = a.start.dateTime || a.start.date;
    const tb = b.start.dateTime || b.start.date;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  return merged;
}

async function createCalendarEvent(summary, startTime, endTime, description = '', calendarId = CALENDAR_ID) {
  const calendar = getCalendarClient();
  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary,
      description,
      start: { dateTime: startTime },
      end: { dateTime: endTime },
    },
  });
}

function getHistory(chatId) {
  return conversationHistory.get(chatId) || [];
}

function saveHistory(chatId, userMessage, botResponse) {
  const history = getHistory(chatId);
  history.push({ role: 'user', content: userMessage });
  history.push({ role: 'assistant', content: botResponse });
  // Keep only last 10 messages (5 exchanges)
  if (history.length > 10) history.splice(0, history.length - 10);
  conversationHistory.set(chatId, history);
}

async function processMessage(userMessage, history = []) {
  const [events, calendars] = await Promise.all([getUpcomingEvents(), getAllCalendars()]);

  const eventsText = events.map(e => {
    const start = e.start.dateTime || e.start.date;
    return `- ${e.summary} op ${start}`;
  }).join('\n');

  const calendarsText = calendars.map(c => `- id: "${c.id}", naam: "${c.name}"`).join('\n');

  const historyText = history.length
    ? '\nGespreksgeschiedenis:\n' + history.map(m => `${m.role === 'user' ? 'Jens' : 'Assistent'}: ${m.content}`).join('\n')
    : '';

  const now = new Date().toISOString();

  const prompt = `Je bent een persoonlijke planning assistent voor Jens Vandenbroeke.
Huidige tijd: ${now}

Beschikbare agenda's:
${calendarsText || 'Geen agenda\'s gevonden'}

Jens zijn agenda voor de komende week:
${eventsText || 'Geen afspraken gevonden'}
${historyText}

Bericht van Jens: "${userMessage}"

Je taken:
1. Als Jens iets wil inplannen, geef dan een JSON response met:
   {"action": "create_event", "summary": "naam", "start": "ISO datetime", "end": "ISO datetime", "description": "optionele beschrijving", "calendar_id": "id van de juiste agenda", "message": "bevestiging voor Jens"}
2. Als Jens zijn agenda wil zien, geef dan:
   {"action": "show_agenda", "message": "overzicht van de agenda"}
3. Voor andere vragen:
   {"action": "reply", "message": "jouw antwoord"}

Regels:
- Reageer ALTIJD in het Nederlands.
- Reageer ALLEEN met valid JSON, geen extra tekst.
- Vraag NOOIT om informatie die al in de gespreksgeschiedenis of het huidige bericht staat.
- Kies ALTIJD de meest passende agenda uit de beschikbare lijst op basis van de context.
- Haal alle beschikbare info uit het bericht voordat je een follow-up vraag stelt.`;

  const text = await askAI(prompt);
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

    const history = getHistory(chatId);
    const response = await processMessage(text, history);

    let botReply;
    if (response.action === 'create_event') {
      const calendarId = response.calendar_id || CALENDAR_ID;
      await createCalendarEvent(response.summary, response.start, response.end, response.description, calendarId);
      botReply = `✅ ${response.message}`;
    } else {
      botReply = response.message;
    }

    await sendTelegram(botReply);
    saveHistory(chatId, text, botReply);

  } catch (err) {
    console.error('Scheduler error:', err.stack || err.message);
    await sendTelegram(`❌ Fout: ${err.message}`);
  }
});

router.get('/set-webhook', async (req, res) => {
  const webhookUrl = `https://jens-booking-production.up.railway.app/api/scheduler/webhook`;
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${webhookUrl}`);
  const data = await response.json();
  res.json(data);
});

module.exports = router;
