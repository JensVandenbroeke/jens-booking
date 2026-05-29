const express = require('express');
const db = require('../db');

const router = express.Router();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Quinta2026!';

function auth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.get('/bookings', auth, async (req, res) => {
  try {
    const { status, type, search } = req.query;
    const bookings = await db.getBookings({ status, type, search });
    res.json({ bookings, total: bookings.length });
  } catch (err) { res.status(500).json({ error: 'Failed to read bookings' }); }
});

router.get('/bookings/export', auth, async (req, res) => {
  try {
    const bookings = await db.getBookings({});
    const headers = ['ID','Booking#','Name','Email','WhatsApp','Language','Type','Timeslot','Topic','Goals','Status','Meet Link','Created At'];
    const rows = bookings.map(b => [b.id,b.bookingNumber,b.name,b.email,b.whatsapp,b.language,b.type,b.timeslot,b.topic,b.goals,b.status,b.meetLink||'',b.createdAt].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bookings.csv"');
    res.send(csv);
  } catch (err) { res.status(500).json({ error: 'Failed to export' }); }
});

router.post('/change-password', auth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Min 8 characters' });
  process.env.ADMIN_PASSWORD = newPassword;
  res.json({ success: true, message: 'Add ADMIN_PASSWORD to Railway Variables to make permanent.' });
});

module.exports = router;
