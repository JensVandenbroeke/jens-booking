const express = require('express');
const { google } = require('googleapis');
const { askAI } = require('../lib/ai');
const { getUserTimezone, saveUserTimezone } = require('../db');

const router = express.Router();
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

// In-memory conversation history: chatId -> [{role, content}]
const conversationHistory = new Map();
// chatIds that have had a timezone check prompt sent this process lifetime
const timezoneChecked = new Set();
// chatIds waiting for a typed country name
const pendingTimezoneInput = new Map();

// Countries with multiple timezones — show a second keyboard for zone selection
const MULTI_TZ_COUNTRIES = {
  'United States': [
    { label: '🗽 Eastern',  tz: 'America/New_York' },
    { label: '🏙️ Central',  tz: 'America/Chicago' },
    { label: '🏔️ Mountain', tz: 'America/Denver' },
    { label: '🌊 Pacific',  tz: 'America/Los_Angeles' },
  ],
  'Canada': [
    { label: '🏙️ Eastern',  tz: 'America/Toronto' },
    { label: '🌊 Pacific',  tz: 'America/Vancouver' },
    { label: '🏔️ Mountain', tz: 'America/Edmonton' },
    { label: '🌅 Atlantic', tz: 'America/Halifax' },
  ],
  'Australia': [
    { label: '🌅 Eastern',  tz: 'Australia/Sydney' },
    { label: '🏜️ Central',  tz: 'Australia/Adelaide' },
    { label: '🌊 Western',  tz: 'Australia/Perth' },
  ],
  'Russia': [
    { label: '🏙️ Moscow',       tz: 'Europe/Moscow' },
    { label: '⛰️ Yekaterinburg', tz: 'Asia/Yekaterinburg' },
    { label: '🌲 Novosibirsk',   tz: 'Asia/Novosibirsk' },
    { label: '🌏 Vladivostok',   tz: 'Asia/Vladivostok' },
  ],
  'Brazil': [
    { label: '🏙️ Brasília', tz: 'America/Sao_Paulo' },
    { label: '🌿 Manaus',   tz: 'America/Manaus' },
    { label: '🌅 Fortaleza', tz: 'America/Fortaleza' },
  ],
  'Mexico': [
    { label: '🏙️ Mexico City', tz: 'America/Mexico_City' },
    { label: '🌊 Pacific',     tz: 'America/Mazatlan' },
    { label: '🌵 Mountain',    tz: 'America/Chihuahua' },
  ],
  'Indonesia': [
    { label: '🏙️ Jakarta (WIB)', tz: 'Asia/Jakarta' },
    { label: '🌴 Bali (WITA)',    tz: 'Asia/Makassar' },
    { label: '🌏 Jayapura (WIT)', tz: 'Asia/Jayapura' },
  ],
  'Kazakhstan': [
    { label: '🏙️ Almaty', tz: 'Asia/Almaty' },
    { label: '🌅 Aktau',  tz: 'Asia/Aqtau' },
  ],
};

// Aliases that map to a MULTI_TZ_COUNTRIES key
const MULTI_TZ_ALIASES = {
  'usa': 'United States',
  'us': 'United States',
  'america': 'United States',
  'verenigde staten': 'United States',
  'rusland': 'Russia',
  'brazilië': 'Brazil',
  'brasil': 'Brazil',
  'australië': 'Australia',
  'indonesië': 'Indonesia',
  'kazachstan': 'Kazakhstan',
};

// Single-timezone country lookup (lowercase key -> {tz, country})
const COUNTRY_SINGLE_TZ = {
  'belgium': { tz: 'Europe/Brussels', country: 'Belgium' },
  'belgië': { tz: 'Europe/Brussels', country: 'Belgium' },
  'portugal': { tz: 'Europe/Lisbon', country: 'Portugal' },
  'netherlands': { tz: 'Europe/Amsterdam', country: 'Netherlands' },
  'holland': { tz: 'Europe/Amsterdam', country: 'Netherlands' },
  'nederland': { tz: 'Europe/Amsterdam', country: 'Netherlands' },
  'france': { tz: 'Europe/Paris', country: 'France' },
  'frankrijk': { tz: 'Europe/Paris', country: 'France' },
  'germany': { tz: 'Europe/Berlin', country: 'Germany' },
  'duitsland': { tz: 'Europe/Berlin', country: 'Germany' },
  'spain': { tz: 'Europe/Madrid', country: 'Spain' },
  'spanje': { tz: 'Europe/Madrid', country: 'Spain' },
  'italy': { tz: 'Europe/Rome', country: 'Italy' },
  'italië': { tz: 'Europe/Rome', country: 'Italy' },
  'uk': { tz: 'Europe/London', country: 'UK' },
  'united kingdom': { tz: 'Europe/London', country: 'UK' },
  'england': { tz: 'Europe/London', country: 'UK' },
  'great britain': { tz: 'Europe/London', country: 'UK' },
  'britain': { tz: 'Europe/London', country: 'UK' },
  'ireland': { tz: 'Europe/Dublin', country: 'Ireland' },
  'ierland': { tz: 'Europe/Dublin', country: 'Ireland' },
  'switzerland': { tz: 'Europe/Zurich', country: 'Switzerland' },
  'zwitserland': { tz: 'Europe/Zurich', country: 'Switzerland' },
  'austria': { tz: 'Europe/Vienna', country: 'Austria' },
  'oostenrijk': { tz: 'Europe/Vienna', country: 'Austria' },
  'poland': { tz: 'Europe/Warsaw', country: 'Poland' },
  'sweden': { tz: 'Europe/Stockholm', country: 'Sweden' },
  'norway': { tz: 'Europe/Oslo', country: 'Norway' },
  'denmark': { tz: 'Europe/Copenhagen', country: 'Denmark' },
  'finland': { tz: 'Europe/Helsinki', country: 'Finland' },
  'greece': { tz: 'Europe/Athens', country: 'Greece' },
  'turkey': { tz: 'Europe/Istanbul', country: 'Turkey' },
  'israel': { tz: 'Asia/Jerusalem', country: 'Israel' },
  'india': { tz: 'Asia/Kolkata', country: 'India' },
  'china': { tz: 'Asia/Shanghai', country: 'China' },
  'japan': { tz: 'Asia/Tokyo', country: 'Japan' },
  'south korea': { tz: 'Asia/Seoul', country: 'South Korea' },
  'korea': { tz: 'Asia/Seoul', country: 'South Korea' },
  'singapore': { tz: 'Asia/Singapore', country: 'Singapore' },
  'thailand': { tz: 'Asia/Bangkok', country: 'Thailand' },
  'vietnam': { tz: 'Asia/Ho_Chi_Minh', country: 'Vietnam' },
  'uae': { tz: 'Asia/Dubai', country: 'UAE' },
  'united arab emirates': { tz: 'Asia/Dubai', country: 'UAE' },
  'dubai': { tz: 'Asia/Dubai', country: 'UAE' },
  'south africa': { tz: 'Africa/Johannesburg', country: 'South Africa' },
  'egypt': { tz: 'Africa/Cairo', country: 'Egypt' },
  'nigeria': { tz: 'Africa/Lagos', country: 'Nigeria' },
  'kenya': { tz: 'Africa/Nairobi', country: 'Kenya' },
  'new zealand': { tz: 'Pacific/Auckland', country: 'New Zealand' },
  'argentina': { tz: 'America/Argentina/Buenos_Aires', country: 'Argentina' },
  'chile': { tz: 'America/Santiago', country: 'Chile' },
  'colombia': { tz: 'America/Bogota', country: 'Colombia' },
  'peru': { tz: 'America/Lima', country: 'Peru' },
};

// --- Timezone helpers ---

function formatTimeInZone(isoString, timezone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

function getCurrentTimeStr(timezone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
  } catch {
    return '??:??';
  }
}

// Returns {type:'single', tz, country} | {type:'multi', country, zones} | null
function lookupCountry(input) {
  const normalized = input.trim().toLowerCase();

  const multiAlias = MULTI_TZ_ALIASES[normalized];
  if (multiAlias) return { type: 'multi', country: multiAlias, zones: MULTI_TZ_COUNTRIES[multiAlias] };

  for (const country of Object.keys(MULTI_TZ_COUNTRIES)) {
    if (country.toLowerCase() === normalized) {
      return { type: 'multi', country, zones: MULTI_TZ_COUNTRIES[country] };
    }
  }

  const single = COUNTRY_SINGLE_TZ[normalized];
  if (single) return { type: 'single', ...single };

  return null;
}

// --- Calendar helpers ---

function getCalendarClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    'https://jens-booking-production.up.railway.app/auth/callback'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth: oauth2Client });
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

  let calendarIds;
  try {
    const allCalendars = await getAllCalendars();
    calendarIds = allCalendars.map(c => c.id);
  } catch (err) {
    console.error('getAllCalendars() failed, falling back to defaults:', err.message);
    calendarIds = ['primary', CALENDAR_ID].filter(Boolean);
  }

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

// --- Telegram helpers ---

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
  });
}

async function sendInlineKeyboard(text, keyboard) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      reply_markup: { inline_keyboard: keyboard },
    }),
  });
}

async function answerCallbackQuery(callbackQueryId) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

async function sendMultiTzKeyboard(country, zones) {
  const rows = [];
  for (let i = 0; i < zones.length; i += 2) {
    rows.push(
      zones.slice(i, i + 2).map(z => ({
        text: `${z.label} — now ${getCurrentTimeStr(z.tz)}`,
        callback_data: `tz_zone|${z.tz}|${country}`,
      }))
    );
  }
  await sendInlineKeyboard(
    `${country} has multiple timezones. What time is it where you are?`,
    rows
  );
}

// --- Timezone check flow ---

async function triggerTimezoneCheck(chatId, pref) {
  timezoneChecked.add(chatId);
  try {
    if (pref?.timezone) {
      const currentTime = getCurrentTimeStr(pref.timezone);
      await sendInlineKeyboard(
        `Are you still in ${pref.timezone_country}? (${pref.timezone} — it's now ${currentTime})`,
        [[
          { text: '✅ Yes, keep it', callback_data: 'tz_confirm' },
          { text: '🌍 No, I moved',  callback_data: 'tz_reset' },
        ]]
      );
    } else {
      await sendInlineKeyboard(
        "Where are you located? I'll use this to show times correctly.",
        [[
          { text: '🇧🇪 Belgium',       callback_data: 'tz_pick|Belgium' },
          { text: '🇵🇹 Portugal',      callback_data: 'tz_pick|Portugal' },
          { text: '✏️ Other country', callback_data: 'tz_pick|other' },
        ]]
      );
    }
  } catch (err) {
    console.error('triggerTimezoneCheck error:', err.message);
  }
}

async function handleCallbackQuery(update) {
  const query = update.callback_query;
  const chatId = String(query.message.chat.id);
  const data = query.data;

  await answerCallbackQuery(query.id);

  if (data === 'tz_confirm') {
    // User confirmed — nothing to change
    return;
  }

  if (data === 'tz_reset') {
    await sendInlineKeyboard('Where are you now?', [[
      { text: '🇧🇪 Belgium',       callback_data: 'tz_pick|Belgium' },
      { text: '🇵🇹 Portugal',      callback_data: 'tz_pick|Portugal' },
      { text: '✏️ Other country', callback_data: 'tz_pick|other' },
    ]]);
    return;
  }

  if (data.startsWith('tz_pick|')) {
    const choice = data.slice(8);
    if (choice === 'other') {
      pendingTimezoneInput.set(chatId, true);
      await sendTelegram('Type your country name (in English or Dutch):');
      return;
    }
    const result = lookupCountry(choice.toLowerCase());
    if (result && result.type === 'single') {
      await saveUserTimezone(chatId, result.tz, result.country);
      const currentTime = getCurrentTimeStr(result.tz);
      await sendTelegram(`✅ Timezone set to ${result.tz}. All times will now show in ${result.country} time. (It's currently ${currentTime})`);
    }
    return;
  }

  if (data.startsWith('tz_zone|')) {
    // format: tz_zone|America/New_York|United States
    const parts = data.slice(8).split('|');
    const tz = parts[0];
    const country = parts[1];
    await saveUserTimezone(chatId, tz, country);
    const currentTime = getCurrentTimeStr(tz);
    await sendTelegram(`✅ Timezone set to ${tz}. All times will now show in ${country} time. (It's currently ${currentTime})`);
  }
}

// --- Conversation helpers ---

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

// --- AI ---

async function processMessage(userMessage, history = [], timezone = 'UTC') {
  const [events, calendars] = await Promise.all([getUpcomingEvents(), getAllCalendars()]);

  const eventsText = events.map(e => {
    const displayTime = e.start.dateTime
      ? formatTimeInZone(e.start.dateTime, timezone)
      : e.start.date;
    return `- ${e.summary} op ${displayTime}`;
  }).join('\n');

  const calendarsText = calendars.map(c => `- id: "${c.id}", naam: "${c.name}"`).join('\n');

  const historyText = history.length
    ? '\nGespreksgeschiedenis:\n' + history.map(m => `${m.role === 'user' ? 'Jens' : 'Assistent'}: ${m.content}`).join('\n')
    : '';

  const nowDisplay = formatTimeInZone(new Date().toISOString(), timezone);

  const prompt = `Je bent een persoonlijke planning assistent voor Jens Vandenbroeke.
Huidige tijd: ${nowDisplay} (${timezone})

Beschikbare agenda's:
${calendarsText || 'Geen agenda\'s gevonden'}

Jens zijn agenda voor de komende week (tijden in ${timezone}):
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
- Detect the language Jens uses in his message and always respond in that same language. If he writes in Dutch, respond in Dutch. If he writes in English, respond in English.
- Reageer ALLEEN met valid JSON, geen extra tekst.
- Vraag NOOIT om informatie die al in de gespreksgeschiedenis of het huidige bericht staat.
- Kies ALTIJD de meest passende agenda uit de beschikbare lijst op basis van de context.
- Haal alle beschikbare info uit het bericht voordat je een follow-up vraag stelt.`;

  const text = await askAI(prompt);
  console.log('[processMessage] raw AI response:', text);
  const clean = text.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch (firstErr) {
    console.error('[processMessage] JSON parse failed, retrying with short prompt. Raw was:', clean);
    const retryPrompt = `The user said: "${userMessage}". Respond with ONLY a JSON object, maximum 500 characters, no extra text:\n{"action":"reply","message":"your response here"}`;
    const retryText = await askAI(retryPrompt);
    console.log('[processMessage] retry raw AI response:', retryText);
    const retryClean = retryText.replace(/```json|```/g, '').trim();
    return JSON.parse(retryClean);
  }
}

// --- Routes ---

router.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const update = req.body;

    // Handle inline keyboard button presses
    if (update.callback_query) {
      await handleCallbackQuery(update);
      return;
    }

    if (!update.message) return;

    const chatId = String(update.message.chat.id);
    if (chatId !== TELEGRAM_CHAT_ID) return;

    const text = update.message.text;
    if (!text) {
      await sendTelegram('Ik begrijp momenteel alleen tekstberichten. Voiceberichten komen binnenkort!');
      return;
    }

    // Handle pending country name input (from "Other country" button)
    if (pendingTimezoneInput.get(chatId)) {
      pendingTimezoneInput.delete(chatId);
      const result = lookupCountry(text);
      if (!result) {
        await sendTelegram(`❓ Couldn't find "${text}". Please type the country name in English or Dutch (e.g. "Germany", "Duitsland"):`);
        pendingTimezoneInput.set(chatId, true);
        return;
      }
      if (result.type === 'single') {
        await saveUserTimezone(chatId, result.tz, result.country);
        const currentTime = getCurrentTimeStr(result.tz);
        await sendTelegram(`✅ Timezone set to ${result.tz}. All times will now show in ${result.country} time. (It's currently ${currentTime})`);
      } else {
        await sendMultiTzKeyboard(result.country, result.zones);
      }
      return;
    }

    // Fetch timezone preference (single DB call, reused for both tz check and processMessage)
    const tzPref = await getUserTimezone(chatId).catch(() => null);
    const timezone = tzPref?.timezone || 'UTC';

    // First message of session: send timezone check
    if (!timezoneChecked.has(chatId)) {
      await triggerTimezoneCheck(chatId, tzPref);
    }

    await sendTelegram('⏳ Even nadenken...');

    const history = getHistory(chatId);
    const response = await processMessage(text, history, timezone);

    // Also prompt for timezone when showing agenda and none is set yet
    if (response.action === 'show_agenda' && !tzPref?.timezone && timezoneChecked.has(chatId)) {
      await triggerTimezoneCheck(chatId, null);
    }

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
