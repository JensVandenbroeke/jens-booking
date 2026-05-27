require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bookingsRouter = require('./routes/bookings');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [
    'https://book-a-call.jensvandenbroeke.com',
    'https://jens-booking.vercel.app',
    'http://localhost:5173',
  ],
}));
app.use(express.json());

app.use('/api', bookingsRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
