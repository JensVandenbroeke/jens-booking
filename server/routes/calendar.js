const express = require('express');
const { getAvailableSlots } = require('../lib/availability');

const router = express.Router();

router.get('/available-slots', async (req, res) => {
  try {
    const slots = await getAvailableSlots();
    res.json({ slots });
  } catch (err) {
    console.error('Calendar error:', err.message);
    res.status(500).json({ error: 'Failed to fetch available slots.' });
  }
});

module.exports = router;
