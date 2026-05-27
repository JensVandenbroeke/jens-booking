const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const router = express.Router();
const DATA_FILE = path.join(__dirname, '../data/bookings.json');
const OWNER_EMAIL = 'jens.vandenbroeke1@gmail.com';

function readBookings() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeBookings(bookings) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(bookings, null, 2), 'utf-8');
}

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

router.post('/book', async (req, res) => {
  const { name, email, whatsapp, language, type, timeslot, topic, goals } = req.body;

  if (!name || !email || !timeslot) {
    return res.status(400).json({ error: 'name, email, and timeslot are required.' });
  }

  const booking = {
    id: Date.now(),
    name,
    email,
    whatsapp: whatsapp || '',
    language: language || '',
    type: type || '',
    timeslot,
    topic: topic || '',
    goals: goals || '',
    createdAt: new Date().toISOString(),
  };

  // Save to JSON file
  const bookings = readBookings();
  bookings.push(booking);
  writeBookings(bookings);

  const transporter = createTransporter();

  // Confirmation email to the booker
  const confirmationMail = {
    from: `"Jens Booking" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Booking Confirmation',
    html: `
      <h2>Hi ${name}, your booking is confirmed!</h2>
      <p>Here are your booking details:</p>
      <ul>
        <li><strong>Time slot:</strong> ${timeslot}</li>
        <li><strong>Session type:</strong> ${type || '—'}</li>
        <li><strong>Language:</strong> ${language || '—'}</li>
        <li><strong>Topic:</strong> ${topic || '—'}</li>
        <li><strong>Goals:</strong> ${goals || '—'}</li>
        <li><strong>WhatsApp:</strong> ${whatsapp || '—'}</li>
      </ul>
      <p>I'll be in touch shortly. Talk soon!</p>
      <p>— Jens</p>
    `,
  };

  // Notification email to owner
  const notificationMail = {
    from: `"Jens Booking" <${process.env.EMAIL_USER}>`,
    to: OWNER_EMAIL,
    subject: `New Booking from ${name}`,
    html: `
      <h2>New booking received</h2>
      <ul>
        <li><strong>Name:</strong> ${name}</li>
        <li><strong>Email:</strong> ${email}</li>
        <li><strong>WhatsApp:</strong> ${whatsapp || '—'}</li>
        <li><strong>Language:</strong> ${language || '—'}</li>
        <li><strong>Session type:</strong> ${type || '—'}</li>
        <li><strong>Time slot:</strong> ${timeslot}</li>
        <li><strong>Topic:</strong> ${topic || '—'}</li>
        <li><strong>Goals:</strong> ${goals || '—'}</li>
        <li><strong>Booked at:</strong> ${booking.createdAt}</li>
      </ul>
    `,
  };

  try {
    await transporter.sendMail(confirmationMail);
    await transporter.sendMail(notificationMail);
  } catch (err) {
    console.error('Email error:', err.message);
    // Booking was saved — return success but warn about email
    return res.status(200).json({
      success: true,
      warning: 'Booking saved but email delivery failed. Check EMAIL_USER/EMAIL_PASS in .env.',
      booking,
    });
  }

  res.status(201).json({ success: true, booking });
});

module.exports = router;
