const { Pool } = require('pg');
const groupSessions = require('./db/groupSessions');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id BIGINT PRIMARY KEY,
      booking_number INTEGER,
      name TEXT, email TEXT, whatsapp TEXT, language TEXT,
      type TEXT, timeslot TEXT, topic TEXT, goals TEXT,
      status TEXT DEFAULT 'confirmed', meet_link TEXT,
      reminder_24h_sent BOOLEAN DEFAULT FALSE,
      reminder_1h_sent BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      cancelled_at TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE SEQUENCE IF NOT EXISTS booking_number_seq START 1001`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      chat_id TEXT PRIMARY KEY,
      timezone TEXT,
      timezone_country TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS learned_airports (
      code TEXT PRIMARY KEY,
      timezone TEXT NOT NULL,
      added_by_chat_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await groupSessions.initGroupTables();
}
async function getNextBookingNumber() {
  const res = await pool.query("SELECT nextval('booking_number_seq') as num");
  return parseInt(res.rows[0].num);
}
async function saveBooking(b) {
  await pool.query(
    `INSERT INTO bookings (id,booking_number,name,email,whatsapp,language,type,timeslot,topic,goals,status,meet_link,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [b.id,b.bookingNumber,b.name,b.email,b.whatsapp,b.language,b.type,b.timeslot,b.topic,b.goals,b.status,b.meetLink,b.createdAt]
  );
}
async function updateBookingMeetLink(id, meetLink) {
  await pool.query('UPDATE bookings SET meet_link=$1 WHERE id=$2',[meetLink,id]);
}
async function cancelBooking(id) {
  await pool.query("UPDATE bookings SET status='cancelled',cancelled_at=NOW() WHERE id=$1",[id]);
}
async function getBookings(filters={}) {
  let q='SELECT * FROM bookings WHERE 1=1'; const p=[]; let i=1;
  if(filters.status){q+=` AND status=$${i++}`;p.push(filters.status);}
  if(filters.type){q+=` AND type=$${i++}`;p.push(filters.type);}
  if(filters.search){q+=` AND (name ILIKE $${i} OR email ILIKE $${i})`;p.push('%'+filters.search+'%');i++;}
  q+=' ORDER BY created_at DESC';
  const res=await pool.query(q,p);
  return res.rows.map(r=>({id:r.id,bookingNumber:r.booking_number,name:r.name,email:r.email,
    whatsapp:r.whatsapp,language:r.language,type:r.type,timeslot:r.timeslot,topic:r.topic,
    goals:r.goals,status:r.status,meetLink:r.meet_link,reminder24hSent:r.reminder_24h_sent,
    reminder1hSent:r.reminder_1h_sent,createdAt:r.created_at,cancelledAt:r.cancelled_at}));
}
async function findBookingById(id) {
  const res=await pool.query('SELECT * FROM bookings WHERE id=$1',[id]);
  if(!res.rows[0])return null; const r=res.rows[0];
  return {id:r.id,bookingNumber:r.booking_number,name:r.name,email:r.email,whatsapp:r.whatsapp,
    language:r.language,type:r.type,timeslot:r.timeslot,topic:r.topic,goals:r.goals,
    status:r.status,meetLink:r.meet_link,reminder24hSent:r.reminder_24h_sent,
    reminder1hSent:r.reminder_1h_sent,createdAt:r.created_at};
}
async function getBookingsForReminders() {
  const res=await pool.query("SELECT * FROM bookings WHERE status='confirmed' AND timeslot IS NOT NULL");
  return res.rows.map(r=>({id:r.id,bookingNumber:r.booking_number,name:r.name,email:r.email,
    whatsapp:r.whatsapp,language:r.language,type:r.type,timeslot:r.timeslot,
    meetLink:r.meet_link,reminder24hSent:r.reminder_24h_sent,reminder1hSent:r.reminder_1h_sent}));
}
async function markReminderSent(id,type) {
  const col=type==='24h'?'reminder_24h_sent':'reminder_1h_sent';
  await pool.query(`UPDATE bookings SET ${col}=TRUE WHERE id=$1`,[id]);
}
async function getUserTimezone(chatId) {
  const res = await pool.query(
    'SELECT timezone, timezone_country FROM user_preferences WHERE chat_id=$1',
    [chatId]
  );
  return res.rows[0] || null;
}
async function saveUserTimezone(chatId, timezone, country) {
  await pool.query(
    `INSERT INTO user_preferences (chat_id, timezone, timezone_country, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET timezone=$2, timezone_country=$3, updated_at=NOW()`,
    [chatId, timezone, country]
  );
}
async function getLearnedAirport(code) {
  const res = await pool.query(
    'SELECT timezone FROM learned_airports WHERE code=$1',
    [code.toUpperCase()]
  );
  return res.rows[0]?.timezone || null;
}
async function saveLearnedAirport(code, timezone, chatId) {
  await pool.query(
    `INSERT INTO learned_airports (code, timezone, added_by_chat_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET timezone=$2, added_by_chat_id=$3`,
    [code.toUpperCase(), timezone, chatId]
  );
}
module.exports={initDb,getNextBookingNumber,saveBooking,updateBookingMeetLink,
  cancelBooking,getBookings,findBookingById,getBookingsForReminders,markReminderSent,
  getUserTimezone,saveUserTimezone,getLearnedAirport,saveLearnedAirport};
