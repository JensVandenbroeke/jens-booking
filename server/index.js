require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bookingsRouter = require('./routes/bookings');
const calendarRouter = require('./routes/calendar');
const { google } = require('googleapis');
const remindersRouter = require('./routes/reminders');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure data directory and bookings file exist before handling requests
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'bookings.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf-8');

app.use(cors({
  origin: [
    'https://book-a-call.jensvandenbroeke.com',
    'https://jens-booking.vercel.app',
    'http://localhost:5173',
  ],
}));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', bookingsRouter);
app.use('/api', calendarRouter);
app.use('/api', remindersRouter);
app.use('/api/admin', adminRouter);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_OAUTH_CLIENT_ID,
  process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  'https://jens-booking-production.up.railway.app/auth/callback'
);

app.get('/auth/login', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent',
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  res.send(`
    <h2>Success! Copy this refresh token to Railway:</h2>
    <textarea rows="4" cols="80" onclick="this.select()">${tokens.refresh_token}</textarea>
    <p>Add as Railway variable: GOOGLE_OAUTH_REFRESH_TOKEN</p>
  `);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
