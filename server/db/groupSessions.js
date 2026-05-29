const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initGroupTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_sessions (
      id BIGINT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      title TEXT,
      session_type TEXT DEFAULT '3way',
      expected_participants INTEGER DEFAULT 3,
      status TEXT DEFAULT 'collecting',
      final_timeslot TIMESTAMPTZ,
      meet_link TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_participants (
      id SERIAL PRIMARY KEY,
      session_id BIGINT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      whatsapp TEXT,
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(session_id, email)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_preferences (
      id SERIAL PRIMARY KEY,
      session_id BIGINT NOT NULL,
      participant_email TEXT NOT NULL,
      slot_start TIMESTAMPTZ NOT NULL,
      rank INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_group_prefs_session ON group_preferences(session_id)
  `);
}

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

function mapSession(r) {
  return {
    id: String(r.id),
    token: r.token,
    title: r.title,
    sessionType: r.session_type,
    expectedParticipants: r.expected_participants,
    status: r.status,
    finalTimeslot: r.final_timeslot,
    meetLink: r.meet_link,
    notes: r.notes,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
  };
}

/** expectedParticipants = number of guests (excl. Jens). 3-way → 2 guests. */
async function createSession({ title, sessionType, expectedParticipants, notes }) {
  const id = Date.now();
  const token = newToken();
  const type = sessionType === '4way' ? '4way' : '3way';
  const expected = expectedParticipants ?? (type === '4way' ? 3 : 2);
  const label = type === '4way' ? '4-way' : '3-way';
  await pool.query(
    `INSERT INTO group_sessions (id, token, title, session_type, expected_participants, notes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, token, title || `${label} call`, type, expected, notes || null]
  );
  return findSessionByToken(token);
}

async function findSessionByToken(token) {
  const res = await pool.query('SELECT * FROM group_sessions WHERE token = $1', [token]);
  return res.rows[0] ? mapSession(res.rows[0]) : null;
}

async function findSessionById(id) {
  const res = await pool.query('SELECT * FROM group_sessions WHERE id = $1', [id]);
  return res.rows[0] ? mapSession(res.rows[0]) : null;
}

async function listSessions() {
  const res = await pool.query('SELECT * FROM group_sessions ORDER BY created_at DESC');
  return res.rows.map(mapSession);
}

async function getParticipants(sessionId) {
  const res = await pool.query(
    'SELECT * FROM group_participants WHERE session_id = $1 ORDER BY submitted_at ASC',
    [sessionId]
  );
  return res.rows.map((r) => ({
    id: r.id,
    sessionId: String(r.session_id),
    name: r.name,
    email: r.email,
    whatsapp: r.whatsapp,
    submittedAt: r.submitted_at,
  }));
}

async function getPreferences(sessionId) {
  const res = await pool.query(
    'SELECT * FROM group_preferences WHERE session_id = $1 ORDER BY participant_email, rank',
    [sessionId]
  );
  return res.rows.map((r) => ({
    id: r.id,
    sessionId: String(r.session_id),
    participantEmail: r.participant_email,
    slotStart: r.slot_start,
    rank: r.rank,
  }));
}

async function getMySubmission(sessionId, email) {
  const normalized = email?.toLowerCase().trim();
  if (!normalized) return null;
  const parts = await getParticipants(sessionId);
  const me = parts.find((p) => p.email.toLowerCase() === normalized);
  if (!me) return null;
  const prefs = await getPreferences(sessionId);
  const slots = prefs
    .filter((p) => p.participantEmail.toLowerCase() === normalized)
    .sort((a, b) => a.rank - b.rank)
    .map((p) => new Date(p.slotStart).toISOString());
  return { name: me.name, email: me.email, whatsapp: me.whatsapp, slots };
}

async function submitPreferences(sessionId, { name, email, whatsapp, slots }) {
  const normalizedEmail = email.toLowerCase().trim();
  await pool.query(
    `INSERT INTO group_participants (session_id, name, email, whatsapp, submitted_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (session_id, email) DO UPDATE SET
       name = EXCLUDED.name,
       whatsapp = EXCLUDED.whatsapp`,
    [sessionId, name.trim(), normalizedEmail, whatsapp || null]
  );
  await pool.query('DELETE FROM group_preferences WHERE session_id = $1 AND participant_email = $2', [
    sessionId,
    normalizedEmail,
  ]);
  for (let i = 0; i < slots.length; i++) {
    await pool.query(
      `INSERT INTO group_preferences (session_id, participant_email, slot_start, rank)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, normalizedEmail, new Date(slots[i]).toISOString(), i + 1]
    );
  }
}

async function confirmSession(sessionId, { finalTimeslot, meetLink }) {
  await pool.query(
    `UPDATE group_sessions SET status = 'confirmed', final_timeslot = $1, meet_link = $2, confirmed_at = NOW()
     WHERE id = $3`,
    [new Date(finalTimeslot).toISOString(), meetLink || null, sessionId]
  );
}

async function cancelSession(sessionId) {
  await pool.query(`UPDATE group_sessions SET status = 'cancelled' WHERE id = $1`, [sessionId]);
}

function slotKey(iso) {
  return new Date(iso).toISOString();
}

function computeOverlaps(participants, preferences, expectedParticipants) {
  if (!participants.length || !preferences.length) {
    return { full: [], partial: [], submittedCount: participants.length };
  }

  const byEmail = {};
  for (const p of preferences) {
    const email = p.participantEmail.toLowerCase();
    if (!byEmail[email]) byEmail[email] = new Set();
    byEmail[email].add(slotKey(p.slotStart));
  }

  const submittedEmails = Object.keys(byEmail);
  const slotCounts = {};

  for (const email of submittedEmails) {
    for (const slot of byEmail[email]) {
      slotCounts[slot] = slotCounts[slot] || { count: 0, emails: [] };
      if (!slotCounts[slot].emails.includes(email)) {
        slotCounts[slot].count++;
        slotCounts[slot].emails.push(email);
      }
    }
  }

  const all = Object.entries(slotCounts)
    .map(([slot, { count, emails }]) => ({
      slot,
      matchCount: count,
      emails,
      fullMatch: count >= expectedParticipants,
    }))
    .sort((a, b) => b.matchCount - a.matchCount || new Date(a.slot) - new Date(b.slot));

  return {
    full: all.filter((o) => o.fullMatch),
    partial: all.filter((o) => !o.fullMatch && o.matchCount > 1),
    submittedCount: submittedEmails.length,
    expectedParticipants,
  };
}

async function getSessionDetail(sessionId) {
  const session = await findSessionById(sessionId);
  if (!session) return null;
  const participants = await getParticipants(sessionId);
  const preferences = await getPreferences(sessionId);
  const overlaps = computeOverlaps(participants, preferences, session.expectedParticipants);

  const prefsByEmail = {};
  for (const p of preferences) {
    const email = p.participantEmail;
    if (!prefsByEmail[email]) prefsByEmail[email] = [];
    prefsByEmail[email].push({ slotStart: p.slotStart, rank: p.rank });
  }

  const participantsWithSlots = participants.map((p) => ({
    ...p,
    slots: (prefsByEmail[p.email.toLowerCase()] || []).sort((a, b) => a.rank - b.rank),
  }));

  return { session, participants: participantsWithSlots, preferences, overlaps };
}

module.exports = {
  initGroupTables,
  createSession,
  findSessionByToken,
  findSessionById,
  listSessions,
  getParticipants,
  getPreferences,
  submitPreferences,
  confirmSession,
  cancelSession,
  getSessionDetail,
  getMySubmission,
  computeOverlaps,
};
