const express  = require('express');
const bcrypt   = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireAdmin);

function toTitleCase(str) {
  return str.trim().replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// GET /api/agents/unverified — agents found in calls but not registered in DB
router.get('/unverified', async (req, res) => {
  const db = await getDb();

  const [registered, callAgents] = await Promise.all([
    db.collection('agents').find({}, { projection: { agent_number: 1 } }).toArray(),
    db.collection('calls').aggregate([
      { $match: { agent_number: { $exists: true, $ne: null, $nin: ['', null] } } },
      { $group: { _id: '$agent_number', name: { $first: '$agent_name' }, calls: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const registeredSet = new Set(registered.map(a => a.agent_number));
  const unverified = callAgents
    .filter(a => !registeredSet.has(a._id))
    .map(a => ({ agent_number: a._id, name: a.name || '', calls: a.calls }))
    .sort((a, b) => b.calls - a.calls);

  res.json({ unverified });
});

// GET /api/agents
router.get('/', async (req, res) => {
  const db = await getDb();
  const docs = await db.collection('agents')
    .find({}, { projection: { password_hash: 0 } })
    .sort({ created_at: -1 })
    .toArray();
  const agents = docs.map(({ _id, ...doc }) => ({ id: _id.toString(), ...doc }));
  res.json({ agents });
});

// GET /api/agents/metrics — per-agent call stats + AI analysis metrics
router.get('/metrics', async (req, res) => {
  const db = await getDb();

  // Call stats from calls collection
  const callRows = await db.collection('calls').aggregate([
    { $match: { agent_number: { $exists: true, $ne: '' }, agent_answer_time: { $exists: true, $ne: '' } } },
    { $group: {
      _id:         '$agent_number',
      received:    { $sum: 1 },
      avgDuration: { $avg: '$duration' },
    }},
  ]).toArray();

  // AI metrics from call_analysis — join to calls to get agent_number
  const analysisRows = await db.collection('call_analysis').aggregate([
    { $match: { status: 'completed' } },
    { $lookup: { from: 'calls', localField: 'call_id', foreignField: 'call_id', as: 'call' } },
    { $unwind: '$call' },
    { $match: { 'call.agent_number': { $exists: true, $ne: '' } } },
    { $group: {
      _id:           '$call.agent_number',
      scoredCalls:   { $sum: { $cond: [{ $ne: ['$agent_score', null] }, 1, 0] } },
      scoreSum:      { $sum: { $ifNull: ['$agent_score', 0] } },
      totalAnalyzed: { $sum: 1 },
      resolved:      { $sum: { $cond: [{ $eq: ['$call_resolved', 'Yes'] }, 1, 0] } },
    }},
  ]).toArray();

  const metrics = {};
  for (const r of callRows) {
    metrics[r._id] = { received: r.received, avgDuration: Math.round(r.avgDuration) };
  }
  for (const r of analysisRows) {
    if (!metrics[r._id]) metrics[r._id] = {};
    metrics[r._id].avgScore     = r.scoredCalls > 0 ? Math.round((r.scoreSum / r.scoredCalls) * 10) / 10 : null;
    metrics[r._id].resolvedPct  = r.totalAnalyzed > 0 ? Math.round((r.resolved / r.totalAnalyzed) * 100) : null;
  }

  res.json({ metrics });
});

// POST /api/agents/bulk — create multiple agents from XLSX upload
router.post('/bulk', async (req, res) => {
  const { agents: rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0)
    return res.status(400).json({ error: 'agents array is required' });

  const db  = await getDb();
  const col = db.collection('agents');
  const results = { added: [], skipped: [], errors: [] };

  for (const row of rows) {
    const name         = toTitleCase(String(row.name || ''));
    const agent_number = String(row.agent_number || '').trim();

    if (!name || !agent_number) {
      results.errors.push({ row, reason: 'Missing name or agent_number' });
      continue;
    }

    const existing = await col.findOne({ agent_number });
    if (existing) { results.skipped.push(agent_number); continue; }

    const password_hash = await bcrypt.hash(agent_number, 10);
    await col.insertOne({ name, agent_number, password_hash, must_change_password: true, created_at: new Date() });
    results.added.push(agent_number);
  }

  res.status(201).json(results);
});

// POST /api/agents — default password is agent_number
router.post('/', async (req, res) => {
  const { name: rawName, agent_number } = req.body;
  if (!rawName || !agent_number)
    return res.status(400).json({ error: 'name and agent_number are required' });

  const name = toTitleCase(rawName);
  const db = await getDb();
  const existing = await db.collection('agents').findOne({ agent_number });
  if (existing) return res.status(409).json({ error: 'Agent number already registered' });

  const password_hash = await bcrypt.hash(agent_number, 10);
  const result = await db.collection('agents').insertOne({
    name, agent_number, password_hash,
    must_change_password: true,
    created_at: new Date(),
  });

  res.status(201).json({ id: result.insertedId.toString(), name, agent_number });
});

// PUT /api/agents/:id
router.put('/:id', async (req, res) => {
  const { name, agent_number } = req.body;
  const db = await getDb();

  const updates = {};
  if (name)         updates.name         = toTitleCase(name);
  if (agent_number) updates.agent_number = agent_number;

  if (Object.keys(updates).length === 0)
    return res.status(400).json({ error: 'No fields to update' });

  if (agent_number) {
    const conflict = await db.collection('agents').findOne({
      agent_number, _id: { $ne: new ObjectId(req.params.id) },
    });
    if (conflict) return res.status(409).json({ error: 'Agent number already in use' });
  }

  const result = await db.collection('agents').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: updates }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// POST /api/agents/:id/reset-password — admin resets password back to agent_number
router.post('/:id/reset-password', async (req, res) => {
  const db = await getDb();
  const agent = await db.collection('agents').findOne({ _id: new ObjectId(req.params.id) });
  if (!agent) return res.status(404).json({ error: 'Not found' });

  const password_hash = await bcrypt.hash(agent.agent_number, 10);
  await db.collection('agents').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { password_hash, must_change_password: true } }
  );
  res.json({ success: true });
});

// DELETE /api/agents/:id
router.delete('/:id', async (req, res) => {
  const db = await getDb();
  const result = await db.collection('agents').deleteOne({ _id: new ObjectId(req.params.id) });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

module.exports = router;
