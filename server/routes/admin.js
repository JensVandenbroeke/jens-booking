const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const DATA_FILE = path.join(__dirname, '../data/bookings.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Quinta2026!';

function readBookings() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function auth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.get('/bookings', auth, (req, res) => {
  try {
    const bookings = readBookings();
    const { status, type, search } = req.query;
    let filtered = bookings;
    if (status) filtered = filtered.filter(b => b.status === status);
    if (type) filtered = filtered.filter(b => b.type === type);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(b =>
        b.name?.toLowerCase().includes(q) ||
        b.email?.toLowerCase().includes(q) ||
        b.whatsapp?.includes(q)
      );
    }
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ bookings: filtered, total: filtered.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read bookings' });
  }
});

router.get('/bookings/export', auth, (req, res) => {
  try {
    const bookings = readBookings();
    const headers = ['ID', 'Booking#', 'Name', 'Email', 'WhatsApp', 'Language', 'Type', 'Timeslot', 'Topic', 'Goals', 'Status', 'Meet Link', 'Created At'];
    const rows = bookings.map(b => [
      b.id, b.bookingNumber, b.name, b.email, b.whatsapp,
      b.language, b.type, b.timeslot, b.topic, b.goals,
      b.status, b.meetLink || '', b.createdAt
    ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bookings.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export' });
  }
});

router.post('/change-password', auth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  process.env.ADMIN_PASSWORD = newPassword;
  res.json({ success: true, message: 'Password updated for this session. Add ADMIN_PASSWORD to Railway to make it permanent.' });
});

module.exports = router;
