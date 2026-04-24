const express = require('express');
const router = express.Router();
const Disruption = require('../models/Disruption');

// GET with search/filter
router.get('/', async (req, res) => {
  try {
    const { line, status, search } = req.query;
    let query = {};
    if (line) query.line = line;
    if (status) query.status = status;
    if (search) query.$or = [
      { trainId: new RegExp(search, 'i') },
      { cause: new RegExp(search, 'i') },
      { line: new RegExp(search, 'i') }
    ];
    const data = await Disruption.find(query).sort({ createdAt: -1 });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST - log new disruption
router.post('/', async (req, res) => {
  try {
    const doc = new Disruption(req.body);
    await doc.save();
    req.io.emit('new-disruption', doc);   // real-time alert
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PUT - resolve
router.put('/:id/resolve', async (req, res) => {
  try {
    const doc = await Disruption.findByIdAndUpdate(req.params.id, { status: 'Resolved' }, { new: true });
    req.io.emit('disruption-resolved', doc);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await Disruption.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;