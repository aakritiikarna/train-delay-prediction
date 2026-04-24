const express = require('express');
const router = express.Router();
const Schedule = require('../models/Schedule');

// GET with search/filter
router.get('/', async (req, res) => {
  try {
    const { line, status, search } = req.query;
    let query = {};
    if (line) query.line = line;
    if (status) query.status = status;
    if (search) query.$or = [
      { trainId: new RegExp(search, 'i') },
      { destination: new RegExp(search, 'i') },
      { driver: new RegExp(search, 'i') }
    ];
    const data = await Schedule.find(query).sort({ scheduledTime: 1 });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST
router.post('/', async (req, res) => {
  try {
    const doc = new Schedule(req.body);
    await doc.save();
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PUT
router.put('/:id', async (req, res) => {
  try {
    const doc = await Schedule.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ error: 'Schedule not found' });

    // Emit real-time update to all connected clients
    req.app.get('io').emit('scheduleUpdated', doc);

    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await Schedule.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;