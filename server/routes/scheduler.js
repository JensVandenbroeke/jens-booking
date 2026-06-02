const express = require('express');
const { google } = require('googleapis');
const { askAI, askClaudeVision, askClaudePdf } = require('../lib/ai');
const { getUserTimezone, saveUserTimezone, saveTimezoneCheckedDate, getLearnedAirport, saveLearnedAirport } = require('../db');

const router = express.Router();
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// In-memory state
const conversationHistory = new Map();        // chatId -> [{role, content}]
const pendingTimezoneInput = new Map();       // chatId -> true when waiting for typed country
const pendingBookings = new Map();              // chatId -> booking proposal object
const pendingTitleEdit = new Map();             // chatId -> true when waiting for new title text
const pendingDescriptionEdit = new Map();       // chatId -> true when waiting for new description text
const pendingBookingTimezoneReset = new Set();  // chatIds that re-show booking proposal after tz change
const pendingBookingAwaitingCalendar = new Set(); // chatIds that go to calendar picker after tz change
const pendingCalendarOptions = new Map();       // chatId -> [{id, name}] for current calendar picker
const pendingAirportTimezone = new Map();       // chatId -> { airportCode, cityName, awaitingInput, proposal, depCode, arrCode, depCityHint, arrCityHint, resolvedDep, resolvedArr }

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
- For flights: set "is_flight" to true. Extract "departure_airport_code" (IATA code if visible, e.g. "LIS"), "arrival_airport_code" (e.g. "BER"), "departure_airport_city" (city name), "arrival_airport_city" (city name), "departure_time" (exact HH:MM from document), "arrival_time" (exact HH:MM from document). Set "date" to the full departure datetime (YYYY-MM-DDTHH:MM:00) and "end_date" to the full arrival datetime.

Return ONLY a valid JSON object with no other text:
{
  "is_booking": true or false,
  "is_flight": true or false,
  "event_type": "bus" or "flight" or "train" or "hotel" or "meeting" or "invitation" or "other",
  "suggested_title": "emoji + concise title, e.g. ✈️ Brussels → Tokyo",
  "suggested_description": "relevant details such as ticket number, flight number, seat, operator",
  "date": "ISO 8601 datetime string or null",
  "end_date": "ISO 8601 datetime string or null",
  "timezone_hint": "timezone identifier found in the document or null",
  "departure_airport_code": "IATA code or null",
  "arrival_airport_code": "IATA code or null",
  "departure_airport_city": "city name or null",
  "arrival_airport_city": "city name or null",
  "departure_time": "HH:MM as written in document or null",
  "arrival_time": "HH:MM as written in document or null",
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

// IATA airport code -> { tz, city }
const AIRPORT_TIMEZONES = {
  // Europa
  LIS: { tz: 'Europe/Lisbon',      city: 'Lissabon' },
  OPO: { tz: 'Europe/Lisbon',      city: 'Porto' },
  FAO: { tz: 'Europe/Lisbon',      city: 'Faro' },
  BRU: { tz: 'Europe/Brussels',    city: 'Brussel' },
  ANR: { tz: 'Europe/Brussels',    city: 'Antwerpen' },
  AMS: { tz: 'Europe/Amsterdam',   city: 'Amsterdam' },
  LHR: { tz: 'Europe/London',      city: 'Londen' },
  LGW: { tz: 'Europe/London',      city: 'Londen' },
  STN: { tz: 'Europe/London',      city: 'Londen' },
  LTN: { tz: 'Europe/London',      city: 'Londen' },
  EDI: { tz: 'Europe/London',      city: 'Edinburgh' },
  MAN: { tz: 'Europe/London',      city: 'Manchester' },
  BHX: { tz: 'Europe/London',      city: 'Birmingham' },
  CDG: { tz: 'Europe/Paris',       city: 'Parijs' },
  ORY: { tz: 'Europe/Paris',       city: 'Parijs' },
  NCE: { tz: 'Europe/Paris',       city: 'Nice' },
  MRS: { tz: 'Europe/Paris',       city: 'Marseille' },
  TLS: { tz: 'Europe/Paris',       city: 'Toulouse' },
  SXB: { tz: 'Europe/Paris',       city: 'Straatsburg' },
  BER: { tz: 'Europe/Berlin',      city: 'Berlijn' },
  TXL: { tz: 'Europe/Berlin',      city: 'Berlijn' },
  SXF: { tz: 'Europe/Berlin',      city: 'Berlijn' },
  MUC: { tz: 'Europe/Berlin',      city: 'München' },
  FRA: { tz: 'Europe/Berlin',      city: 'Frankfurt' },
  DUS: { tz: 'Europe/Berlin',      city: 'Düsseldorf' },
  HAM: { tz: 'Europe/Berlin',      city: 'Hamburg' },
  STR: { tz: 'Europe/Berlin',      city: 'Stuttgart' },
  CGN: { tz: 'Europe/Berlin',      city: 'Keulen' },
  HAJ: { tz: 'Europe/Berlin',      city: 'Hannover' },
  NUE: { tz: 'Europe/Berlin',      city: 'Neurenberg' },
  FCO: { tz: 'Europe/Rome',        city: 'Rome' },
  MXP: { tz: 'Europe/Rome',        city: 'Milaan' },
  LIN: { tz: 'Europe/Rome',        city: 'Milaan' },
  VCE: { tz: 'Europe/Rome',        city: 'Venetië' },
  NAP: { tz: 'Europe/Rome',        city: 'Napels' },
  CTA: { tz: 'Europe/Rome',        city: 'Catania' },
  MAD: { tz: 'Europe/Madrid',      city: 'Madrid' },
  BCN: { tz: 'Europe/Madrid',      city: 'Barcelona' },
  AGP: { tz: 'Europe/Madrid',      city: 'Málaga' },
  PMI: { tz: 'Europe/Madrid',      city: 'Palma' },
  SVQ: { tz: 'Europe/Madrid',      city: 'Sevilla' },
  VIE: { tz: 'Europe/Vienna',      city: 'Wenen' },
  ZRH: { tz: 'Europe/Zurich',      city: 'Zürich' },
  GVA: { tz: 'Europe/Zurich',      city: 'Genève' },
  BSL: { tz: 'Europe/Zurich',      city: 'Basel' },
  CPH: { tz: 'Europe/Copenhagen',  city: 'Kopenhagen' },
  ARN: { tz: 'Europe/Stockholm',   city: 'Stockholm' },
  OSL: { tz: 'Europe/Oslo',        city: 'Oslo' },
  HEL: { tz: 'Europe/Helsinki',    city: 'Helsinki' },
  ATH: { tz: 'Europe/Athens',      city: 'Athene' },
  SKG: { tz: 'Europe/Athens',      city: 'Thessaloniki' },
  IST: { tz: 'Europe/Istanbul',    city: 'Istanbul' },
  SAW: { tz: 'Europe/Istanbul',    city: 'Istanbul' },
  WAW: { tz: 'Europe/Warsaw',      city: 'Warschau' },
  PRG: { tz: 'Europe/Prague',      city: 'Praag' },
  BUD: { tz: 'Europe/Budapest',    city: 'Boedapest' },
  DUB: { tz: 'Europe/Dublin',      city: 'Dublin' },
  OTP: { tz: 'Europe/Bucharest',   city: 'Boekarest' },
  CLJ: { tz: 'Europe/Bucharest',   city: 'Cluj-Napoca' },
  SOF: { tz: 'Europe/Sofia',       city: 'Sofia' },
  BEG: { tz: 'Europe/Belgrade',    city: 'Belgrado' },
  INI: { tz: 'Europe/Belgrade',    city: 'Niš' },
  ZAG: { tz: 'Europe/Zagreb',      city: 'Zagreb' },
  DBV: { tz: 'Europe/Zagreb',      city: 'Dubrovnik' },
  SPU: { tz: 'Europe/Zagreb',      city: 'Split' },
  RJK: { tz: 'Europe/Zagreb',      city: 'Rijeka' },
  LJU: { tz: 'Europe/Ljubljana',   city: 'Ljubljana' },
  SKP: { tz: 'Europe/Skopje',      city: 'Skopje' },
  OHD: { tz: 'Europe/Skopje',      city: 'Ohrid' },
  TIA: { tz: 'Europe/Tirane',      city: 'Tirana' },
  KIV: { tz: 'Europe/Chisinau',    city: 'Chisinau' },
  RIX: { tz: 'Europe/Riga',        city: 'Riga' },
  TLL: { tz: 'Europe/Tallinn',     city: 'Tallinn' },
  VNO: { tz: 'Europe/Vilnius',     city: 'Vilnius' },
  GYD: { tz: 'Asia/Baku',          city: 'Bakoe' },
  TBS: { tz: 'Asia/Tbilisi',       city: 'Tbilisi' },
  EVN: { tz: 'Asia/Yerevan',       city: 'Jerevan' },
  // Amerika
  JFK: { tz: 'America/New_York',               city: 'New York' },
  LGA: { tz: 'America/New_York',               city: 'New York' },
  EWR: { tz: 'America/New_York',               city: 'Newark' },
  BOS: { tz: 'America/New_York',               city: 'Boston' },
  MIA: { tz: 'America/New_York',               city: 'Miami' },
  ATL: { tz: 'America/New_York',               city: 'Atlanta' },
  DTW: { tz: 'America/New_York',               city: 'Detroit' },
  TPA: { tz: 'America/New_York',               city: 'Tampa' },
  CLT: { tz: 'America/New_York',               city: 'Charlotte' },
  LAX: { tz: 'America/Los_Angeles',            city: 'Los Angeles' },
  SFO: { tz: 'America/Los_Angeles',            city: 'San Francisco' },
  SEA: { tz: 'America/Los_Angeles',            city: 'Seattle' },
  LAS: { tz: 'America/Los_Angeles',            city: 'Las Vegas' },
  PDX: { tz: 'America/Los_Angeles',            city: 'Portland' },
  SAN: { tz: 'America/Los_Angeles',            city: 'San Diego' },
  ORD: { tz: 'America/Chicago',                city: 'Chicago' },
  DFW: { tz: 'America/Chicago',                city: 'Dallas' },
  HOU: { tz: 'America/Chicago',                city: 'Houston' },
  MSP: { tz: 'America/Chicago',                city: 'Minneapolis' },
  DEN: { tz: 'America/Denver',                 city: 'Denver' },
  PHX: { tz: 'America/Phoenix',                city: 'Phoenix' },
  YYZ: { tz: 'America/Toronto',                city: 'Toronto' },
  YUL: { tz: 'America/Toronto',                city: 'Montreal' },
  YVR: { tz: 'America/Vancouver',              city: 'Vancouver' },
  YEG: { tz: 'America/Edmonton',               city: 'Edmonton' },
  YWG: { tz: 'America/Winnipeg',               city: 'Winnipeg' },
  YHZ: { tz: 'America/Halifax',                city: 'Halifax' },
  GRU: { tz: 'America/Sao_Paulo',              city: 'São Paulo' },
  GIG: { tz: 'America/Sao_Paulo',              city: 'Rio de Janeiro' },
  BSB: { tz: 'America/Sao_Paulo',              city: 'Brasília' },
  FOR: { tz: 'America/Fortaleza',              city: 'Fortaleza' },
  REC: { tz: 'America/Recife',                 city: 'Recife' },
  EZE: { tz: 'America/Argentina/Buenos_Aires', city: 'Buenos Aires' },
  BOG: { tz: 'America/Bogota',                 city: 'Bogotá' },
  LIM: { tz: 'America/Lima',                   city: 'Lima' },
  MEX: { tz: 'America/Mexico_City',            city: 'Mexico-Stad' },
  CUN: { tz: 'America/Cancun',                 city: 'Cancún' },
  HAV: { tz: 'America/Havana',                 city: 'Havana' },
  SDQ: { tz: 'America/Santo_Domingo',          city: 'Santo Domingo' },
  SJU: { tz: 'America/Puerto_Rico',            city: 'San Juan' },
  MBJ: { tz: 'America/Jamaica',                city: 'Montego Bay' },
  KIN: { tz: 'America/Jamaica',                city: 'Kingston' },
  POS: { tz: 'America/Port_of_Spain',          city: 'Port of Spain' },
  // Azië / Midden-Oosten
  NRT: { tz: 'Asia/Tokyo',          city: 'Tokio' },
  HND: { tz: 'Asia/Tokyo',          city: 'Tokio' },
  KIX: { tz: 'Asia/Tokyo',          city: 'Osaka' },
  OKA: { tz: 'Asia/Tokyo',          city: 'Okinawa' },
  SIN: { tz: 'Asia/Singapore',      city: 'Singapore' },
  HKG: { tz: 'Asia/Hong_Kong',      city: 'Hongkong' },
  TPE: { tz: 'Asia/Taipei',         city: 'Taipei' },
  PEK: { tz: 'Asia/Shanghai',       city: 'Peking' },
  PKX: { tz: 'Asia/Shanghai',       city: 'Peking' },
  PVG: { tz: 'Asia/Shanghai',       city: 'Shanghai' },
  CAN: { tz: 'Asia/Shanghai',       city: 'Guangzhou' },
  CTU: { tz: 'Asia/Shanghai',       city: 'Chengdu' },
  XIY: { tz: 'Asia/Shanghai',       city: "Xi'an" },
  ICN: { tz: 'Asia/Seoul',          city: 'Seoul' },
  GMP: { tz: 'Asia/Seoul',          city: 'Seoul' },
  BKK: { tz: 'Asia/Bangkok',        city: 'Bangkok' },
  CNX: { tz: 'Asia/Bangkok',        city: 'Chiang Mai' },
  HKT: { tz: 'Asia/Bangkok',        city: 'Phuket' },
  HAN: { tz: 'Asia/Bangkok',        city: 'Hanoi' },
  DAD: { tz: 'Asia/Bangkok',        city: 'Da Nang' },
  REP: { tz: 'Asia/Bangkok',        city: 'Siem Reap' },
  SGN: { tz: 'Asia/Ho_Chi_Minh',    city: 'Ho Chi Minh City' },
  KUL: { tz: 'Asia/Kuala_Lumpur',   city: 'Kuala Lumpur' },
  CGK: { tz: 'Asia/Jakarta',        city: 'Jakarta' },
  DPS: { tz: 'Asia/Makassar',       city: 'Bali' },
  DEL: { tz: 'Asia/Kolkata',        city: 'Delhi' },
  BOM: { tz: 'Asia/Kolkata',        city: 'Mumbai' },
  CCU: { tz: 'Asia/Kolkata',        city: 'Calcutta' },
  MAA: { tz: 'Asia/Kolkata',        city: 'Chennai' },
  BLR: { tz: 'Asia/Kolkata',        city: 'Bangalore' },
  CMB: { tz: 'Asia/Colombo',        city: 'Colombo' },
  RGN: { tz: 'Asia/Rangoon',        city: 'Yangon' },
  DXB: { tz: 'Asia/Dubai',          city: 'Dubai' },
  AUH: { tz: 'Asia/Dubai',          city: 'Abu Dhabi' },
  DOH: { tz: 'Asia/Qatar',          city: 'Doha' },
  BAH: { tz: 'Asia/Bahrain',        city: 'Bahrein' },
  MCT: { tz: 'Asia/Muscat',         city: 'Muscat' },
  KWI: { tz: 'Asia/Kuwait',         city: 'Koeweit' },
  AMM: { tz: 'Asia/Amman',          city: 'Amman' },
  BEY: { tz: 'Asia/Beirut',         city: 'Beiroet' },
  TLV: { tz: 'Asia/Jerusalem',      city: 'Tel Aviv' },
  ALA: { tz: 'Asia/Almaty',         city: 'Almaty' },
  NQZ: { tz: 'Asia/Almaty',         city: 'Astana' },
  TSE: { tz: 'Asia/Almaty',         city: 'Astana' },
  FRU: { tz: 'Asia/Bishkek',        city: 'Bishkek' },
  TAS: { tz: 'Asia/Tashkent',       city: 'Tasjkent' },
  // Afrika / Oceanië
  JNB: { tz: 'Africa/Johannesburg', city: 'Johannesburg' },
  CPT: { tz: 'Africa/Johannesburg', city: 'Kaapstad' },
  NBO: { tz: 'Africa/Nairobi',      city: 'Nairobi' },
  ADD: { tz: 'Africa/Addis_Ababa',  city: 'Addis Abeba' },
  DAR: { tz: 'Africa/Dar_es_Salaam', city: 'Dar es Salaam' },
  MPM: { tz: 'Africa/Maputo',       city: 'Maputo' },
  CAI: { tz: 'Africa/Cairo',        city: 'Caïro' },
  CMN: { tz: 'Africa/Casablanca',   city: 'Casablanca' },
  ACC: { tz: 'Africa/Accra',        city: 'Accra' },
  LOS: { tz: 'Africa/Lagos',        city: 'Lagos' },
  SYD: { tz: 'Australia/Sydney',    city: 'Sydney' },
  MEL: { tz: 'Australia/Melbourne', city: 'Melbourne' },
  BNE: { tz: 'Australia/Brisbane',  city: 'Brisbane' },
  PER: { tz: 'Australia/Perth',     city: 'Perth' },
  ADL: { tz: 'Australia/Adelaide',  city: 'Adelaide' },
  AKL: { tz: 'Pacific/Auckland',    city: 'Auckland' },
  CHC: { tz: 'Pacific/Auckland',    city: 'Christchurch' },
  NAN: { tz: 'Pacific/Fiji',        city: 'Nadi' },
};

function lookupAirport(code) {
  if (!code) return null;
  return AIRPORT_TIMEZONES[code.trim().toUpperCase()] || null;
}

// Checks static map first, then learned_airports table
async function resolveAirport(code, cityHint) {
  if (!code) return null;
  const known = lookupAirport(code);
  if (known) return known;
  const learnedTz = await getLearnedAirport(code).catch(() => null);
  if (learnedTz) return { tz: learnedTz, city: cityHint || code.toUpperCase() };
  return null;
}

async function askAboutUnknownAirport(chatId, state) {
  const depCity = state.resolvedDep?.city || state.depCityHint || state.depCode || '?';
  const arrCity = state.resolvedArr?.city || state.arrCityHint || state.arrCode || '?';
  const msg =
    `✈️ ${depCity} → ${arrCity} gevonden, maar ik ken de tijdzone van ${state.airportCode} niet.\n\n` +
    `In welke tijdzone ligt ${state.cityName}?`;
  await sendInlineKeyboard(msg, [[
    { text: '🕐 Zelfde als mijn tijdzone', callback_data: 'airport_tz_same'   },
    { text: '✏️ Ik typ het zelf',          callback_data: 'airport_tz_manual' },
  ]]);
}

async function continueFlightAfterAirportResolved(chatId, airportCode, tz, state) {
  await saveLearnedAirport(airportCode, tz, chatId);

  const resolved = { tz, city: state.cityName };
  if (state.depCode?.toUpperCase() === airportCode.toUpperCase()) state.resolvedDep = resolved;
  if (state.arrCode?.toUpperCase() === airportCode.toUpperCase()) state.resolvedArr = resolved;

  // If there is still an unknown airport, ask about it next
  if (!state.resolvedDep) {
    state.airportCode = state.depCode;
    state.cityName    = state.depCityHint || state.depCode;
    state.awaitingInput = false;
    cappedSet(pendingAirportTimezone, chatId, state);
    await askAboutUnknownAirport(chatId, state);
    return;
  }
  if (!state.resolvedArr) {
    state.airportCode = state.arrCode;
    state.cityName    = state.arrCityHint || state.arrCode;
    state.awaitingInput = false;
    cappedSet(pendingAirportTimezone, chatId, state);
    await askAboutUnknownAirport(chatId, state);
    return;
  }

  // Both airports resolved — build and show the flight proposal
  pendingAirportTimezone.delete(chatId);

  const dep = state.resolvedDep;
  const arr = state.resolvedArr;
  const depCity = dep.city;
  const arrCity = arr.city;
  const proposal = state.proposal;

  proposal.isFlight      = true;
  proposal.departureTz   = dep.tz;
  proposal.arrivalTz     = arr.tz;
  proposal.departureCity = depCity;
  proposal.arrivalCity   = arrCity;
  proposal.title         = `✈️ ${depCity} → ${arrCity}`;

  cappedSet(pendingBookings, chatId, proposal);

  if (dep.tz !== arr.tz) {
    await showFlightProposal(chatId, proposal);
  } else {
    const tzPref = await getUserTimezone(chatId).catch(() => null);
    await showBookingProposal(chatId, proposal, tzPref?.timezone || 'UTC');
  }
}

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

async function createCalendarEvent(summary, startTime, endTime, description = '', calendarId = CALENDAR_ID, timezone = null, endTimezone = null) {
  const calendar = getCalendarClient();
  const startObj = timezone              ? { dateTime: startTime, timeZone: timezone }              : { dateTime: startTime };
  const endObj   = (endTimezone || timezone) ? { dateTime: endTime, timeZone: endTimezone || timezone } : { dateTime: endTime };
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

// --- Voice transcription ---

async function transcribeVoice(fileId) {
  const { base64 } = await downloadTelegramFile(fileId);
  const buffer = Buffer.from(base64, 'base64');
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: 'audio/ogg' }), 'audio.ogg');
  formData.append('model', 'whisper-1');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Whisper API error');
  return data.text;
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

async function showFlightProposal(chatId, booking) {
  const depLine = `Vertrek: ${booking.departureTime} (${booking.departureCity} tijd - ${booking.departureTz})`;
  const arrLine = `Aankomst: ${booking.arrivalTime} (${booking.arrivalCity} tijd - ${booking.arrivalTz})`;
  const message =
    `✈️ ${booking.departureCity} → ${booking.arrivalCity}\n\n` +
    `${depLine}\n${arrLine}\n\n` +
    `Tijden zijn correct per tijdzone van elk luchthaven.`;
  await sendInlineKeyboard(message, [[
    { text: '✅ Inplannen', callback_data: 'book_confirm' },
    { text: '✏️ Aanpassen', callback_data: 'book_edit_title' },
    { text: '❌ Annuleren', callback_data: 'book_cancel' },
  ]]);
}

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

  if (booking.is_flight) {
    const depCityHint = booking.departure_airport_city || booking.departure_airport_code || '?';
    const arrCityHint = booking.arrival_airport_city  || booking.arrival_airport_code  || '?';
    const dep = await resolveAirport(booking.departure_airport_code, depCityHint);
    const arr = await resolveAirport(booking.arrival_airport_code,   arrCityHint);

    if (dep && arr) {
      proposal.isFlight      = true;
      proposal.departureTz   = dep.tz;
      proposal.arrivalTz     = arr.tz;
      proposal.departureCity = dep.city;
      proposal.arrivalCity   = arr.city;
      proposal.departureTime = booking.departure_time || '';
      proposal.arrivalTime   = booking.arrival_time || '';
      proposal.title         = `✈️ ${dep.city} → ${arr.city}`;

      if (dep.tz !== arr.tz) {
        cappedSet(pendingBookings, chatId, proposal);
        await showFlightProposal(chatId, proposal);
        return;
      }
      // Same timezone — fall through to normal proposal below
    } else {
      // One or both airports unknown — start interactive timezone resolution
      const firstUnknownCode = !dep ? booking.departure_airport_code : booking.arrival_airport_code;
      const firstUnknownCity = !dep ? depCityHint : arrCityHint;
      const state = {
        airportCode:    firstUnknownCode,
        cityName:       firstUnknownCity,
        awaitingInput:  false,
        proposal,
        depCode:        booking.departure_airport_code,
        arrCode:        booking.arrival_airport_code,
        depCityHint,
        arrCityHint,
        resolvedDep:    dep,
        resolvedArr:    arr,
      };
      cappedSet(pendingAirportTimezone, chatId, state);
      await askAboutUnknownAirport(chatId, state);
      return;
    }
  }

  cappedSet(pendingBookings, chatId, proposal);
  await showBookingProposal(chatId, proposal, timezone);
}

// --- Timezone check flow ---

async function triggerTimezoneCheck(chatId, pref) {
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
    await saveTimezoneCheckedDate(chatId);
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
    if (!pendingBookingTimezoneReset.has(chatId)) {
      await sendTelegram(`✅ Got it! I'm using ${country} time. How can I help you?`);
    }
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
      if (!pendingBookingTimezoneReset.has(chatId)) {
        await sendTelegram(`✅ Got it! I'm using ${result.country} time. How can I help you?`);
      }
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
    if (!pendingBookingTimezoneReset.has(chatId)) {
      await sendTelegram(`✅ Got it! I'm using ${country} time. How can I help you?`);
    }
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
    const startTz = booking.isFlight ? booking.departureTz : timezone;
    const endTz   = booking.isFlight ? booking.arrivalTz   : timezone;
    await createCalendarEvent(booking.title, startIso, endIso, description, calendarId, startTz, endTz);
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
    pendingAirportTimezone.delete(chatId);
    await sendTelegram('❌ Cancelled.');
    return;
  }

  // --- Airport timezone resolution callbacks ---

  if (data === 'airport_tz_same') {
    const state = pendingAirportTimezone.get(chatId);
    if (!state) { await sendTelegram('❌ Geen vlucht in behandeling.'); return; }
    const tzPref = await getUserTimezone(chatId).catch(() => null);
    const tz = tzPref?.timezone || 'UTC';
    await sendTelegram(`✅ Onthouden! ${state.airportCode} = ${tz}. Dit gebruik ik voortaan.`);
    await continueFlightAfterAirportResolved(chatId, state.airportCode, tz, state);
    return;
  }

  if (data === 'airport_tz_manual') {
    const state = pendingAirportTimezone.get(chatId);
    if (!state) { await sendTelegram('❌ Geen vlucht in behandeling.'); return; }
    state.awaitingInput = true;
    cappedSet(pendingAirportTimezone, chatId, state);
    await sendTelegram(`Typ de tijdzone voor ${state.airportCode} (bijv. Asia/Tokyo, America/New_York):`);
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

function findCalendarInText(text, calendars) {
  const lower = text.toLowerCase();
  for (const cal of calendars) {
    const name = cal.name.toLowerCase();
    const stem = name.replace(/\s*agenda\s*$/, '').trim();
    for (const candidate of [name, stem]) {
      if (candidate.length < 3) continue;
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(lower)) return cal;
    }
  }
  return null;
}

async function processMessage(userMessage, history = [], timezone = 'UTC') {
  const [events, calendars] = await Promise.all([getUpcomingEvents(), getAllCalendars()]);

  const detectedCalendar = findCalendarInText(userMessage, calendars);
  const calendarHint = detectedCalendar
    ? `\nGebruiker heeft agenda "${detectedCalendar.name}" (id: "${detectedCalendar.id}") vermeld — gebruik deze calendar_id direct, vraag niet welke agenda.\n`
    : '';

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
${calendarHint}
Bericht van Jens: "${userMessage}"

Je taken:
1. Als Jens iets wil inplannen, extraheer dan EERST alle beschikbare info uit het bericht én de gespreksgeschiedenis:
   - titel (verplicht)
   - datum (verplicht)
   - tijd (verplicht)
   - duur (optioneel — standaard 1 uur als niet vermeld, nooit vragen)
   - tijdzone: gebruik altijd ${timezone}
   - agenda (optioneel — vraag welke agenda als niet duidelijk)
   - beschrijving (optioneel — weglaten als niet vermeld, nooit vragen)
   - locatie (optioneel — weglaten als niet vermeld, nooit vragen)

   Als titel, datum EN tijd allemaal beschikbaar zijn:
   → Maak het event onmiddellijk aan:
   {"action": "create_event", "summary": "titel", "start": "ISO datetime", "end": "ISO datetime", "calendar_id": "id", "message": "bevestiging"}

   Als de agenda niet vermeld is maar de rest wel:
   → Vraag alleen welke agenda:
   {"action": "reply", "message": "korte vraag over agenda"}

   Als één of meer verplichte velden ontbreken (titel, datum of tijd):
   → Vraag ALLEEN naar het/de ontbrekende veld(en), één vraag tegelijk:
   {"action": "reply", "message": "korte gerichte vraag"}

2. Als Jens zijn agenda wil zien:
   {"action": "show_agenda", "message": "overzicht van de agenda"}

3. Als Jens een document, ticket of bestand wil terugvinden aan de hand van een datum:
   {"action": "retrieve_file", "date_hint": "YYYY-MM-DD", "message": "zoeken..."}

4. Voor andere vragen:
   {"action": "reply", "message": "jouw antwoord"}

Regels:
- Detect the language Jens uses and always respond in that same language.
- Reageer ALLEEN met valid JSON, geen extra tekst.
- Vraag NOOIT naar iets wat al in het bericht of de gespreksgeschiedenis staat.
- Vraag NOOIT naar duur, beschrijving of locatie — gebruik standaardwaarden of laat weg.
- Kies de meest passende agenda op basis van context als die duidelijk is.
- Stel maximaal één vraag per antwoord.`;

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
    const voice = update.message.voice || update.message.audio;
    const isPdf = doc?.mime_type === 'application/pdf';

    if (!text && !photos && !isPdf && !voice) {
      await sendTelegram('Ik begrijp momenteel tekstberichten, afbeeldingen, PDF-bestanden en voiceberichten.');
      return;
    }

    // Fetch timezone early — needed for all message types
    const tzPref = await getUserTimezone(chatId).catch(() => null);
    const timezone = tzPref?.timezone || 'UTC';

    // Handle voice messages — transcribe via Whisper then process as text
    if (voice) {
      await sendTelegram('🎙️ Even luisteren...');
      let transcription;
      try {
        transcription = await transcribeVoice(voice.file_id);
      } catch (err) {
        console.error('transcribeVoice error:', err.message);
        await sendTelegram('❌ Kon het audiobericht niet verstaan. Probeer opnieuw of stuur een tekstbericht.');
        return;
      }
      await sendTelegram(`📝 Ik hoorde: "${transcription}"`);

      const voiceToday = new Date().toISOString().slice(0, 10);
      if (tzPref?.timezone_checked_date !== voiceToday) {
        await triggerTimezoneCheck(chatId, tzPref);
      }

      await sendTelegram('⏳ Even nadenken...');
      const voiceHistory = getHistory(chatId);
      const voiceResponse = await processMessage(transcription, voiceHistory, timezone);
      let voiceReply;
      if (voiceResponse.action === 'create_event') {
        const calendarId = voiceResponse.calendar_id || CALENDAR_ID;
        await createCalendarEvent(voiceResponse.summary, voiceResponse.start, voiceResponse.end, voiceResponse.description, calendarId);
        voiceReply = `✅ ${voiceResponse.message}`;
      } else if (voiceResponse.action === 'retrieve_file') {
        const found = await findFileInCalendar(voiceResponse.date_hint);
        if (found) {
          await sendTelegram(`📎 Found: ${found.event.summary}`);
          await sendTelegramDocument(found.fileId);
          voiceReply = `📎 ${found.event.summary} sent!`;
        } else {
          voiceReply = `❓ No document found around ${voiceResponse.date_hint}.`;
        }
      } else {
        voiceReply = voiceResponse.message;
      }
      await sendTelegram(voiceReply);
      saveHistory(chatId, transcription, voiceReply);
      return;
    }

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

    // Handle pending airport timezone input
    const airportTzState = pendingAirportTimezone.get(chatId);
    if (text && airportTzState?.awaitingInput) {
      const tz = text.trim();
      let valid = false;
      try { Intl.DateTimeFormat(undefined, { timeZone: tz }); valid = true; } catch {}
      if (!valid) {
        await sendTelegram(`❌ "${tz}" is geen geldige tijdzone. Probeer bijv. Asia/Tokyo of America/New_York:`);
        return;
      }
      await sendTelegram(`✅ Onthouden! ${airportTzState.airportCode} = ${tz}. Dit gebruik ik voortaan.`);
      await continueFlightAfterAirportResolved(chatId, airportTzState.airportCode, tz, airportTzState);
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
        if (!pendingBookingTimezoneReset.has(chatId)) {
          await sendTelegram(`✅ Got it! I'm using ${result.country} time. How can I help you?`);
        }
        await maybeReshowBookingAfterTzChange(chatId);
      } else {
        await sendMultiTzKeyboard(result.country, result.zones);
      }
      return;
    }

    // Once per day: send timezone check
    const today = new Date().toISOString().slice(0, 10);
    if (tzPref?.timezone_checked_date !== today) {
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
