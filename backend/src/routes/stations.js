const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Lookup — any authenticated user (for Call Report)
router.get('/lookup', requireAuth, async (req, res) => {
  const db = await getDb();
  const docs = await db.collection('stations').find({}).toArray();
  const map = {};
  for (const d of docs) {
    map[d.station_number] = { station_name: d.station_name, agents: d.agents || [] };
  }
  res.json({ stations: map });
});

// All routes below require admin
router.use(requireAuth, requireAdmin);

// GET /api/stations — list all
router.get('/', async (req, res) => {
  const db = await getDb();
  const docs = await db.collection('stations').find({}).sort({ station_name: 1 }).toArray();
  const stations = docs.map(({ _id, ...d }) => ({ id: _id.toString(), ...d }));
  res.json({ stations });
});

// POST /api/stations — create
router.post('/', async (req, res) => {
  const { station_name, station_number } = req.body;
  if (!station_name || !station_number) return res.status(400).json({ error: 'station_name and station_number required' });

  const db = await getDb();
  const exists = await db.collection('stations').findOne({ station_number });
  if (exists) return res.status(409).json({ error: 'Station number already exists' });

  const doc = { station_name: station_name.trim(), station_number: station_number.trim(), agents: [], created_at: new Date(), updated_at: new Date() };
  await db.collection('stations').insertOne(doc);
  res.status(201).json({ id: doc._id.toString(), ...doc });
});

// PUT /api/stations/:id — edit
router.put('/:id', async (req, res) => {
  const { station_name, station_number } = req.body;
  if (!station_name || !station_number) return res.status(400).json({ error: 'station_name and station_number required' });

  const db = await getDb();
  const id = new ObjectId(req.params.id);
  const conflict = await db.collection('stations').findOne({ station_number, _id: { $ne: id } });
  if (conflict) return res.status(409).json({ error: 'Station number already in use' });

  await db.collection('stations').updateOne({ _id: id }, { $set: { station_name: station_name.trim(), station_number: station_number.trim(), updated_at: new Date() } });
  res.json({ ok: true });
});

// DELETE /api/stations/:id
router.delete('/:id', async (req, res) => {
  const db = await getDb();
  await db.collection('stations').deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ ok: true });
});

// POST /api/stations/:id/assign — add agent to station
router.post('/:id/assign', async (req, res) => {
  const { name, mobile } = req.body;
  if (!name || !mobile) return res.status(400).json({ error: 'name and mobile required' });

  const db = await getDb();
  await db.collection('stations').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $push: { agents: { name: name.trim(), mobile: mobile.trim() } }, $set: { updated_at: new Date() } }
  );
  res.json({ ok: true });
});

// POST /api/stations/:id/unassign — remove agent by mobile
router.post('/:id/unassign', async (req, res) => {
  const { mobile } = req.body;
  if (!mobile) return res.status(400).json({ error: 'mobile required' });

  const db = await getDb();
  await db.collection('stations').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $pull: { agents: { mobile } }, $set: { updated_at: new Date() } }
  );
  res.json({ ok: true });
});

// POST /api/stations/clear-agents — daily reset
router.post('/clear-agents', async (req, res) => {
  const db = await getDb();
  const result = await db.collection('stations').updateMany({}, { $set: { agents: [], updated_at: new Date() } });
  res.json({ ok: true, modified: result.modifiedCount });
});

module.exports = router;
