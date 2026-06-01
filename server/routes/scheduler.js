const express = require('express');
const { google } = require('googleapis');
const { askAI, askClaudeVision, askClaudePdf } = require('../lib/ai');
const { getUserTimezone, saveUserTimezone } = require('../db');

const router = express.Router();
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

// In-memory state
const conversationHistory = new Map();        // chatId -> [{role, content}]
const timezoneChecked = new Set();            // chatIds with tz check sent this session
const pendingTimezoneInput = new Map();       // chatId -> true when waiting for typed country
const pendingBookings = new Map();              // chatId -> booking proposal object
const pendingTitleEdit = new Map();             // chatId -> true when waiting for new title text
const pendingDescriptionEdit = new Map();       // chatId -> true when waiting for new description text
const pendingBookingTimezoneReset = new Set();  // chatIds that re-show booking proposal after tz change
const pendingBookingAwaitingCalendar = new Set(); // chatIds that go to calendar picker after tz change
const pendingCalendarOptions = new Map();       // chatId -> [{id, name}] for current calendar picker

const MAX_MAP_SIZE = 100;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Evict the oldest entry when a Map/Set reaches MAX_MAP_SIZE to prevent unbounded growth
function cappedSet(map, key, value) {
  if (!map.has(key) && map.size >= MAX_MAP_SIZE) {
    map.delete(map.keys().next().value);
  }
  map.set(key, value);
}

function cappedAdd(set, value) {
  if (!set.has(value) && set.size >= MAX_MAP_SIZE) {
    set.delete(set.values().next().value);
  }
  set.add(value);
}

// Prompt that instructs Claude to detect booking/event info and return structured JSON
const BOOKING_DETECTION_PROMPT = `Analyze this content. Does it contain booking, travel, event or appointment information?

CRITICAL: Extract times EXACTLY as written in the document. Do NOT convert or adjust times. If the document says 13:15, output 13:15. Never add or subtract hours. The timezone field should reflect what timezone the document appears to be in, but the time value must remain unchanged from the source document.

Rules:
- IMPORTANT: Copy times EXACTLY as they appear in the document. If you see 13:15, output 13:15. Never modify times.

Return ONLY a valid JSON object with no other text:
{
  "is_booking": true or false,
  "event_type": "bus" or "flight" or "train" or "hotel" or "meeting" or "invitation" or "other",
  "suggested_title": "emoji + concise title, e.g. 🚌 Bus Peniche → Nazaré",
  "suggested_description": "relevant details such as ticket number, platform, operator, seat",
  "date": "ISO 8601 datetime string or null",
  "end_date": "ISO 8601 datetime string or null",
  "timezone_hint": "timezone identifier found in the document or null",
  "summary": "brief human-readable summary of what this content is"
}`;

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
    { label: '🏙️ Brasília',  tz: 'America/Sao_Paulo' },
    { label: '🌿 Manaus',    tz: 'America/Manaus' },
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
    if (country.toLowerCase() === normalized) return { type: 'multi', country, zones: MULTI_TZ_COUNTRIES[country] };
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

async function createCalendarEvent(summary, startTime, endTime, description = '', calendarId = CALENDAR_ID, timezone = null) {
  const calendar = getCalendarClient();
  const startObj = timezone ? { dateTime: startTime, timeZone: timezone } : { dateTime: startTime };
  const endObj   = timezone ? { dateTime: endTime,   timeZone: timezone } : { dateTime: endTime };
  await calendar.events.insert({
    calendarId,
    requestBody: { summary, description, start: startObj, end: endObj },
  });
}

// Search calendar events around a date hint and return the first one with a file_id in its description
async function findFileInCalendar(dateHint) {
  const targetDate = new Date(dateHint);
  if (isNaN(targetDate)) return null;

  const calendar = getCalendarClient();
  const timeMin = new Date(targetDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(targetDate.getTime() + 48 * 60 * 60 * 1000).toISOString();

  let calendarIds;
  try {
    const allCalendars = await getAllCalendars();
    calendarIds = allCalendars.map(c => c.id);
  } catch {
    calendarIds = ['primary', CALENDAR_ID].filter(Boolean);
  }

  const results = await Promise.all(
    calendarIds.map(id => calendar.events.list({ calendarId: id, timeMin, timeMax, singleEvents: true }))
  );

  for (const res of results) {
    for (const event of (res.data.items || [])) {
      const match = event.description?.match(/📎 file_id: (\S+)/);
      if (match) return { fileId: match[1], event };
    }
  }
  return null;
}

// --- File download helper ---

// Downloads any Telegram file and returns { base64, fileId }
async function downloadTelegramFile(fileId) {
  const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  const fileSize = fileData.result?.file_size;
  if (fileSize && fileSize > MAX_FILE_SIZE) {
    throw new Error(`File too large (${Math.round(fileSize / 1024 / 1024)}MB). Maximum allowed size is 10MB.`);
  }
  const filePath = fileData.result.file_path;
  const fileDownload = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
  const arrayBuffer = await fileDownload.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
    throw new Error(`File too large (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB). Maximum allowed size is 10MB.`);
  }
  return { base64: Buffer.from(arrayBuffer).toString('base64'), fileId };
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

async function sendTelegramDocument(fileId) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, document: fileId }),
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
  await sendInlineKeyboard(`${country} has multiple timezones. What time is it where you are?`, rows);
}

// Strips any timezone suffix from a booking datetime and returns a clean naive ISO string.
// Google Calendar interprets it in the timeZone field — no new Date() to avoid UTC shift.
function toLocalBookingIso(dateStr) {
  const clean = dateStr.replace(/Z$/, '').replace(/[+-]\d{2}:\d{2}$/, '').substring(0, 16);
  return clean + ':00';
}

// --- Calendar picker for booking confirmation ---

async function showCalendarKeyboard(chatId) {
  let calendars;
  try {
    calendars = await getAllCalendars();
  } catch (err) {
    await sendTelegram('❌ Could not load calendars: ' + err.message);
    return;
  }
  cappedSet(pendingCalendarOptions, chatId, calendars);
  // Use index-based callback to stay well under Telegram's 64-byte callback_data limit
  const rows = calendars.map((cal, i) => [{ text: cal.name, callback_data: `book_calendar|${i}` }]);
  await sendInlineKeyboard('Which calendar should I add this to?', rows);
}

// --- Booking proposal ---

async function showBookingProposal(chatId, booking, timezone) {
  const dateDisplay = booking.date ? formatTimeInZone(booking.date, timezone) : 'Date unknown';
  const endDisplay = booking.end_date ? ` → ${formatTimeInZone(booking.end_date, timezone)}` : '';
  const message =
    `📄 I found the following in your document:\n\n` +
    `${booking.title}\n` +
    `📅 ${dateDisplay}${endDisplay}\n` +
    `📝 ${booking.description}\n\n` +
    `Shall I add this to your calendar?`;

  await sendInlineKeyboard(message, [
    [
      { text: '✅ Plan it',          callback_data: 'book_confirm' },
      { text: '✏️ Edit title',       callback_data: 'book_edit_title' },
    ],
    [
      { text: '📝 Edit description', callback_data: 'book_edit_desc' },
      { text: '🕐 Wrong timezone',   callback_data: 'book_timezone' },
    ],
    [
      { text: '❌ Cancel',           callback_data: 'book_cancel' },
    ],
  ]);
}

// Parses the raw Claude response from a file analysis and either shows a booking proposal or sends the summary as text
async function handleFileAnalysis(chatId, rawResult, fileId, timezone) {
  let booking;
  try {
    const clean = rawResult.replace(/```json|```/g, '').trim();
    booking = JSON.parse(clean);
  } catch {
    await sendTelegram(rawResult);
    return;
  }

  if (!booking.is_booking) {
    await sendTelegram(booking.summary || rawResult);
    return;
  }

  const proposal = {
    title: booking.suggested_title,
    description: booking.suggested_description,
    date: booking.date,
    end_date: booking.end_date,
    event_type: booking.event_type,
    summary: booking.summary,
    fileId,
  };
  cappedSet(pendingBookings, chatId, proposal);
  await showBookingProposal(chatId, proposal, timezone);
}

// --- Timezone check flow ---

async function triggerTimezoneCheck(chatId, pref) {
  cappedAdd(timezoneChecked, chatId);
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

// After a timezone is confirmed or set, either go to the calendar picker (book_confirm flow)
// or re-show the booking proposal with corrected times (book_timezone flow)
async function maybeReshowBookingAfterTzChange(chatId) {
  if (!pendingBookingTimezoneReset.has(chatId)) return;
  pendingBookingTimezoneReset.delete(chatId);

  if (pendingBookingAwaitingCalendar.has(chatId)) {
    pendingBookingAwaitingCalendar.delete(chatId);
    await showCalendarKeyboard(chatId);
  } else {
    const booking = pendingBookings.get(chatId);
    if (!booking) return;
    const tzPref = await getUserTimezone(chatId).catch(() => null);
    await showBookingProposal(chatId, booking, tzPref?.timezone || 'UTC');
  }
}

async function handleCallbackQuery(update) {
  const query = update.callback_query;
  const chatId = String(query.message.chat.id);
  const data = query.data;

  await answerCallbackQuery(query.id);

  // --- Timezone callbacks ---

  if (data === 'tz_confirm') {
    const pref = await getUserTimezone(chatId).catch(() => null);
    const country = pref?.timezone_country || 'your timezone';
    await sendTelegram(`✅ Got it! I'm using ${country} time. How can I help you?`);
    await maybeReshowBookingAfterTzChange(chatId);
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
      cappedSet(pendingTimezoneInput, chatId, true);
      await sendTelegram('Type your country name (in English or Dutch):');
      return;
    }
    const result = lookupCountry(choice.toLowerCase());
    if (result && result.type === 'single') {
      await saveUserTimezone(chatId, result.tz, result.country);
      await sendTelegram(`✅ Got it! I'm using ${result.country} time. How can I help you?`);
      await maybeReshowBookingAfterTzChange(chatId);
    }
    return;
  }

  if (data.startsWith('tz_zone|')) {
    // format: tz_zone|America/New_York|United States
    const parts = data.slice(8).split('|');
    const tz = parts[0];
    const country = parts[1];
    await saveUserTimezone(chatId, tz, country);
    await sendTelegram(`✅ Got it! I'm using ${country} time. How can I help you?`);
    await maybeReshowBookingAfterTzChange(chatId);
    return;
  }

  // --- Booking callbacks ---

  if (data === 'book_confirm') {
    const booking = pendingBookings.get(chatId);
    if (!booking) { await sendTelegram('❌ No pending booking found.'); return; }
    if (!booking.date) { await sendTelegram('❌ Cannot create event: no date was found in the document.'); return; }
    const tzPref = await getUserTimezone(chatId).catch(() => null);
    if (!tzPref?.timezone) {
      // No timezone yet — ask for it first, then proceed to calendar selection
      cappedAdd(pendingBookingTimezoneReset, chatId);
      cappedAdd(pendingBookingAwaitingCalendar, chatId);
      await triggerTimezoneCheck(chatId, null);
    } else {
      await showCalendarKeyboard(chatId);
    }
    return;
  }

  if (data.startsWith('book_calendar|')) {
    const index = parseInt(data.slice(14), 10);
    const options = pendingCalendarOptions.get(chatId);
    const booking = pendingBookings.get(chatId);
    if (!options || !options[index]) { await sendTelegram('❌ Calendar not found. Please try again.'); return; }
    if (!booking) { await sendTelegram('❌ No pending booking found.'); return; }
    const { id: calendarId, name: calendarName } = options[index];
    const tzPref = await getUserTimezone(chatId).catch(() => null);
    const timezone = tzPref?.timezone || 'UTC';
    const startIso = toLocalBookingIso(booking.date);
    const endIso = booking.end_date
      ? toLocalBookingIso(booking.end_date)
      : (() => {
          const [datePart, timePart] = startIso.split('T');
          const [h, m] = timePart.split(':').map(Number);
          const totalMins = h * 60 + m + 60;
          const nh = String(Math.floor(totalMins / 60) % 24).padStart(2, '0');
          const nm = String(totalMins % 60).padStart(2, '0');
          return `${datePart}T${nh}:${nm}:00`;
        })();
    const description = (booking.description || '') + `\n\n📎 file_id: ${booking.fileId}`;
    await createCalendarEvent(booking.title, startIso, endIso, description, calendarId, timezone);
    pendingBookings.delete(chatId);
    pendingCalendarOptions.delete(chatId);
    await sendTelegram(`✅ ${booking.title} added to ${calendarName}!`);
    return;
  }

  if (data === 'book_edit_title') {
    cappedSet(pendingTitleEdit, chatId, true);
    await sendTelegram('What should the title be?');
    return;
  }

  if (data === 'book_edit_desc') {
    cappedSet(pendingDescriptionEdit, chatId, true);
    await sendTelegram('What should the description be?');
    return;
  }

  if (data === 'book_timezone') {
    cappedAdd(pendingBookingTimezoneReset, chatId);
    await sendInlineKeyboard('Select your timezone:', [[
      { text: '🇧🇪 Belgium',       callback_data: 'tz_pick|Belgium' },
      { text: '🇵🇹 Portugal',      callback_data: 'tz_pick|Portugal' },
      { text: '✏️ Other country', callback_data: 'tz_pick|other' },
    ]]);
    return;
  }

  if (data === 'book_cancel') {
    pendingBookings.delete(chatId);
    await sendTelegram('❌ Cancelled.');
    return;
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
  cappedSet(conversationHistory, chatId, history);
}

// --- AI ---

async function processMessage(userMessage, history = [], timezone = 'UTC') {
  const [events, calendars] = await Promise.all([getUpcomingEvents(), getAllCalendars()]);

  const eventsText = events.map(e => {
    const displayTime = e.start.dateTime ? formatTimeInZone(e.start.dateTime, timezone) : e.start.date;
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
3. Als Jens een document, ticket of bestand wil terugvinden aan de hand van een datum:
   {"action": "retrieve_file", "date_hint": "YYYY-MM-DD", "message": "zoeken..."}
4. Voor andere vragen:
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
    const photos = update.message.photo;
    const doc = update.message.document;
    const isPdf = doc?.mime_type === 'application/pdf';

    if (!text && !photos && !isPdf) {
      await sendTelegram('Ik begrijp momenteel tekstberichten, afbeeldingen en PDF-bestanden. Voiceberichten komen binnenkort!');
      return;
    }

    // Fetch timezone early — needed for photo/PDF proposals and text processing
    const tzPref = await getUserTimezone(chatId).catch(() => null);
    const timezone = tzPref?.timezone || 'UTC';

    // Handle photo messages — booking detection via Claude vision (always uses ANTHROPIC_API_KEY directly)
    if (photos) {
      await sendTelegram('⏳ Analysing image...');
      const highestRes = photos[photos.length - 1];
      const { base64, fileId } = await downloadTelegramFile(highestRes.file_id);
      const caption = update.message.caption || '';
      const prompt = caption ? `${caption}\n\n${BOOKING_DETECTION_PROMPT}` : BOOKING_DETECTION_PROMPT;
      const rawResult = await askClaudeVision(base64, prompt);
      await handleFileAnalysis(chatId, rawResult, fileId, timezone);
      return;
    }

    // Handle PDF documents — booking detection via Claude (always uses ANTHROPIC_API_KEY directly)
    if (isPdf) {
      await sendTelegram('⏳ Reading document...');
      const { base64, fileId } = await downloadTelegramFile(doc.file_id);
      const caption = update.message.caption || '';
      const prompt = caption ? `${caption}\n\n${BOOKING_DETECTION_PROMPT}` : BOOKING_DETECTION_PROMPT;
      const rawResult = await askClaudePdf(base64, prompt);
      await handleFileAnalysis(chatId, rawResult, fileId, timezone);
      return;
    }

    // Handle pending title edit for booking proposal
    if (text && pendingTitleEdit.get(chatId)) {
      pendingTitleEdit.delete(chatId);
      const booking = pendingBookings.get(chatId);
      if (booking) {
        booking.title = text;
        await showBookingProposal(chatId, booking, timezone);
      }
      return;
    }

    // Handle pending description edit for booking proposal
    if (text && pendingDescriptionEdit.get(chatId)) {
      pendingDescriptionEdit.delete(chatId);
      const booking = pendingBookings.get(chatId);
      if (booking) {
        booking.description = text;
        await showBookingProposal(chatId, booking, timezone);
      }
      return;
    }

    // Handle pending country name input (from "Other country" button)
    if (text && pendingTimezoneInput.get(chatId)) {
      pendingTimezoneInput.delete(chatId);
      const result = lookupCountry(text);
      if (!result) {
        await sendTelegram(`❓ Couldn't find "${text}". Please type the country name in English or Dutch (e.g. "Germany", "Duitsland"):`);
        cappedSet(pendingTimezoneInput, chatId, true);
        return;
      }
      if (result.type === 'single') {
        await saveUserTimezone(chatId, result.tz, result.country);
        await sendTelegram(`✅ Got it! I'm using ${result.country} time. How can I help you?`);
        await maybeReshowBookingAfterTzChange(chatId);
      } else {
        await sendMultiTzKeyboard(result.country, result.zones);
      }
      return;
    }

    // First message of session: send timezone check
    if (!timezoneChecked.has(chatId)) {
      await triggerTimezoneCheck(chatId, tzPref);
    }

    await sendTelegram('⏳ Even nadenken...');

    const history = getHistory(chatId);
    const response = await processMessage(text, history, timezone);

    let botReply;
    if (response.action === 'create_event') {
      const calendarId = response.calendar_id || CALENDAR_ID;
      await createCalendarEvent(response.summary, response.start, response.end, response.description, calendarId);
      botReply = `✅ ${response.message}`;
    } else if (response.action === 'retrieve_file') {
      const found = await findFileInCalendar(response.date_hint);
      if (found) {
        await sendTelegram(`📎 Found: ${found.event.summary}`);
        await sendTelegramDocument(found.fileId);
        botReply = `📎 ${found.event.summary} sent!`;
      } else {
        botReply = `❓ No document found around ${response.date_hint}.`;
      }
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
