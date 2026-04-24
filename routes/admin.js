const express = require('express');
const router = express.Router();
const User = require('../models/User');

// GET users with search/filter
router.get('/users', async (req, res) => {
  try {
    const { role, search } = req.query;
    let query = {};
    if (role) query.role = role;
    if (search) query.$or = [
      { name: new RegExp(search, 'i') },
      { email: new RegExp(search, 'i') }
    ];
    res.json(await User.find(query).sort({ createdAt: -1 }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST - create user
router.post('/users', async (req, res) => {
  try {
    const doc = new User(req.body);
    await doc.save();
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PUT - update role or status
router.put('/users/:id', async (req, res) => {
  try {
    const doc = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE
router.delete('/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;