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
    map[d.station_number] = { station_name: d.station_name, agents: (d.agents || []).filter(a => a.active === true) };
  }
  res.json({ stations: map });
});

// All routes below require admin
router.use(requireAuth, requireAdmin);

// GET /api/stations — list all with call stats
router.get('/', async (req, res) => {
  const db = await getDb();
  const docs = await db.collection('stations').find({}).sort({ station_name: 1 }).toArray();
  const stationNumbers = docs.map(d => d.station_number).filter(Boolean);

  // Get call stats per station number
  const callStats = {};
  if (stationNumbers.length > 0) {
    const rows = await db.collection('calls').aggregate([
      { $match: { agent_number: { $in: stationNumbers } } },
      { $group: {
        _id: '$agent_number',
        received: { $sum: { $cond: [{ $and: [{ $ne: ['$agent_answer_time', ''] }, { $ne: ['$agent_answer_time', null] }] }, 1, 0] } },
        missed: { $sum: { $cond: [{ $or: [{ $eq: ['$agent_answer_time', ''] }, { $eq: ['$agent_answer_time', null] }] }, 1, 0] } },
      }},
    ]).toArray();
    for (const r of rows) callStats[r._id] = { received: r.received, missed: r.missed };
  }

  // Get per-agent call stats (by agent mobile number across all calls)
  const allAgentMobiles = docs.flatMap(d => (d.agents || []).map(a => a.mobile)).filter(Boolean);
  const agentCallStats = {};
  if (allAgentMobiles.length > 0) {
    const agentRows = await db.collection('calls').aggregate([
      { $match: { $or: [{ agent_number: { $in: allAgentMobiles } }, { caller_number: { $in: allAgentMobiles } }] } },
      { $group: {
        _id: '$agent_number',
        received: { $sum: { $cond: [{ $and: [{ $ne: ['$agent_answer_time', ''] }, { $ne: ['$agent_answer_time', null] }] }, 1, 0] } },
        missed: { $sum: { $cond: [{ $or: [{ $eq: ['$agent_answer_time', ''] }, { $eq: ['$agent_answer_time', null] }] }, 1, 0] } },
      }},
    ]).toArray();
    for (const r of agentRows) agentCallStats[r._id] = { received: r.received, missed: r.missed };
  }

  const stations = docs.map(({ _id, ...d }) => ({
    id: _id.toString(),
    ...d,
    agents: (d.agents || []).map(a => ({
      ...a,
      received: agentCallStats[a.mobile]?.received || 0,
      missed: agentCallStats[a.mobile]?.missed || 0,
    })),
    received: callStats[d.station_number]?.received || 0,
    missed: callStats[d.station_number]?.missed || 0,
  }));
  res.json({ stations });
});

// POST /api/stations — create (optionally with an initial agent + date)
router.post('/', async (req, res) => {
  const { station_name, station_number, agent, date } = req.body;
  if (!station_name || !station_number) return res.status(400).json({ error: 'station_name and station_number required' });

  const db = await getDb();
  const exists = await db.collection('stations').findOne({ station_number });
  if (exists) return res.status(409).json({ error: 'Station number already exists' });

  const agents = [];
  if (agent && agent.name && agent.mobile) {
    agents.push({ name: agent.name.trim(), mobile: agent.mobile.trim(), active: true, assigned_at: new Date() });
  }

  const doc = { station_name: station_name.trim(), station_number: station_number.trim(), agents, date: date || new Date().toISOString().slice(0, 10), created_at: new Date(), updated_at: new Date() };
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

// POST /api/stations/:id/assign — add agent to station (deactivates current active agent)
router.post('/:id/assign', async (req, res) => {
  const { name, mobile, date } = req.body;
  if (!name || !mobile) return res.status(400).json({ error: 'name and mobile required' });

  const db = await getDb();
  const id = new ObjectId(req.params.id);
  // Deactivate current active agent
  await db.collection('stations').updateMany(
    { _id: id, 'agents.active': true },
    { $set: { 'agents.$[el].active': false, 'agents.$[el].removed_at': new Date() } },
    { arrayFilters: [{ 'el.active': true }] }
  );
  // Add new active agent
  await db.collection('stations').updateOne(
    { _id: id },
    { $push: { agents: { name: name.trim(), mobile: mobile.trim(), active: true, assigned_at: new Date() } }, $set: { date: date || new Date().toISOString().slice(0, 10), updated_at: new Date() } }
  );
  res.json({ ok: true });
});

// POST /api/stations/:id/unassign — deactivate agent (move to history)
router.post('/:id/unassign', async (req, res) => {
  const { mobile } = req.body;
  if (!mobile) return res.status(400).json({ error: 'mobile required' });

  const db = await getDb();
  await db.collection('stations').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { 'agents.$[el].active': false, 'agents.$[el].removed_at': new Date(), updated_at: new Date() } },
    { arrayFilters: [{ 'el.mobile': mobile, 'el.active': true }] }
  );
  res.json({ ok: true });
});

// POST /api/stations/clear-agents — daily reset
router.post('/clear-agents', async (req, res) => {
  const db = await getDb();
  const result = await db.collection('stations').updateMany({}, { $set: { agents: [], updated_at: new Date() } });
  res.json({ ok: true, modified: result.modifiedCount });
});

// POST /api/stations/bulk — bulk upload stations from parsed rows
router.post('/bulk', async (req, res) => {
  const { rows, date } = req.body;
  if (!rows || !Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });

  const db = await getDb();
  let created = 0, updated = 0, skipped = 0;

  for (const row of rows) {
    const station_name = (row.station_name || '').trim();
    const station_number = (row.station_number || '').trim();
    const agent_name = (row.agent_name || '').trim();
    const agent_mobile = (row.agent_mobile || '').trim();

    if (!station_name || !station_number) { skipped++; continue; }

    const existing = await db.collection('stations').findOne({ station_number });

    if (existing) {
      // If agent provided, assign to existing station
      if (agent_name && agent_mobile) {
        // Deactivate current active
        await db.collection('stations').updateMany(
          { _id: existing._id, 'agents.active': true },
          { $set: { 'agents.$[el].active': false, 'agents.$[el].removed_at': new Date() } },
          { arrayFilters: [{ 'el.active': true }] }
        );
        await db.collection('stations').updateOne(
          { _id: existing._id },
          { $push: { agents: { name: agent_name, mobile: agent_mobile, active: true, assigned_at: new Date() } }, $set: { station_name, date: date || new Date().toISOString().slice(0, 10), updated_at: new Date() } }
        );
      } else {
        await db.collection('stations').updateOne(
          { _id: existing._id },
          { $set: { station_name, date: date || new Date().toISOString().slice(0, 10), updated_at: new Date() } }
        );
      }
      updated++;
    } else {
      const agents = [];
      if (agent_name && agent_mobile) {
        agents.push({ name: agent_name, mobile: agent_mobile, active: true, assigned_at: new Date() });
      }
      await db.collection('stations').insertOne({
        station_name, station_number, agents,
        date: date || new Date().toISOString().slice(0, 10),
        created_at: new Date(), updated_at: new Date(),
      });
      created++;
    }
  }

  res.json({ ok: true, created, updated, skipped });
});

module.exports = router;
