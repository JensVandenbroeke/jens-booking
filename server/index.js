require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bookingsRouter = require('./routes/bookings');

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
