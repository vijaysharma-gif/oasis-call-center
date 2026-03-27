const express    = require('express');
const { ObjectId } = require('mongodb');
const { getDb }  = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ['General Inquiry', 'Technical Issue', 'Billing', 'Complaint', 'Service Request', 'Follow Up', 'Others'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const STATUSES   = ['Open', 'In Progress', 'Resolved', 'Closed'];

async function nextTicketNumber(db) {
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: 'ticket_counter' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return `TKT-${String(result.seq).padStart(4, '0')}`;
}

// POST /api/tickets — create a ticket
router.post('/', async (req, res) => {
  const { call_id, customer_name, customer_number, agent_number, agent_name, title, description, category, priority } = req.body;
  if (!customer_number || !title) return res.status(400).json({ error: 'customer_number and title are required' });

  const db  = await getDb();
  const now = new Date();
  const ticket_number = await nextTicketNumber(db);

  const ticket = {
    ticket_number,
    call_id:         call_id || null,
    customer_name:   customer_name || null,
    customer_number,
    agent_number:    agent_number  || req.user.agent_number || null,
    agent_name:      agent_name    || req.user.name         || null,
    title,
    description:     description   || '',
    category:        CATEGORIES.includes(category) ? category : 'General Inquiry',
    priority:        PRIORITIES.includes(priority) ? priority : 'Medium',
    status:          'Open',
    created_by_name: req.user.name,
    created_at:      now,
    updated_at:      now,
    timeline: [{
      type:      'created',
      note:      'Ticket created',
      by_name:   req.user.name,
      by_number: req.user.agent_number || null,
      at:        now,
    }],
  };

  const result = await db.collection('tickets').insertOne(ticket);
  res.status(201).json({ id: result.insertedId.toString(), ...ticket });
});

// GET /api/tickets — list
router.get('/', async (req, res) => {
  const db = await getDb();
  const { status, priority, category, agentNumber, customerNumber, search, limit = '25', offset = '0', dateFrom, dateTo } = req.query;

  const conditions = [];

  if (status)         conditions.push({ status });
  if (priority)       conditions.push({ priority });
  if (category)       conditions.push({ category });
  if (agentNumber)    conditions.push({ agent_number: agentNumber });
  if (customerNumber) conditions.push({ customer_number: customerNumber });
  if (search) {
    conditions.push({ $or: [
      { ticket_number:   { $regex: search, $options: 'i' } },
      { customer_name:   { $regex: search, $options: 'i' } },
      { customer_number: { $regex: search, $options: 'i' } },
      { title:           { $regex: search, $options: 'i' } },
      { agent_name:      { $regex: search, $options: 'i' } },
    ]});
  }

  if (dateFrom || dateTo) {
    const dc = {};
    if (dateFrom) dc.$gte = new Date(dateFrom);
    if (dateTo)   dc.$lte = new Date(dateTo);
    conditions.push({ created_at: dc });
  }

  const filter = conditions.length ? { $and: conditions } : {};

  const [docs, total] = await Promise.all([
    db.collection('tickets').find(filter, { projection: { timeline: 0 } })
      .sort({ created_at: -1 }).skip(Number(offset)).limit(Number(limit)).toArray(),
    db.collection('tickets').countDocuments(filter),
  ]);

  const tickets = docs.map(({ _id, ...doc }) => ({ id: _id.toString(), ...doc }));
  res.json({ tickets, total });
});

// GET /api/tickets/:id — single ticket with timeline
router.get('/:id', async (req, res) => {
  const db  = await getDb();
  const doc = await db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const { _id, ...rest } = doc;
  res.json({ id: _id.toString(), ...rest });
});

// PATCH /api/tickets/:id — update status / priority / fields
router.patch('/:id', async (req, res) => {
  const db  = await getDb();
  const doc = await db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const { status, priority, title, description, category } = req.body;
  const now      = new Date();
  const updates  = { updated_at: now };
  const entries  = [];

  if (status && status !== doc.status && STATUSES.includes(status)) {
    updates.status = status;
    entries.push({ type: 'status_changed', from: doc.status, to: status,
      note: `Status changed from "${doc.status}" to "${status}"`,
      by_name: req.user.name, by_number: req.user.agent_number || null, at: now });
  }
  if (priority && priority !== doc.priority && PRIORITIES.includes(priority)) {
    updates.priority = priority;
    entries.push({ type: 'priority_changed', from: doc.priority, to: priority,
      note: `Priority changed from "${doc.priority}" to "${priority}"`,
      by_name: req.user.name, by_number: req.user.agent_number || null, at: now });
  }
  if (title)                updates.title       = title;
  if (description !== undefined) updates.description = description;
  if (category && CATEGORIES.includes(category)) updates.category = category;

  const op = { $set: updates };
  if (entries.length) op.$push = { timeline: { $each: entries } };

  await db.collection('tickets').updateOne({ _id: new ObjectId(req.params.id) }, op);
  res.json({ success: true });
});

// POST /api/tickets/:id/note — add a timeline note
router.post('/:id/note', async (req, res) => {
  const db = await getDb();
  const { note } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: 'note is required' });

  const doc = await db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const now   = new Date();
  const entry = { type: 'note', note: note.trim(), by_name: req.user.name, by_number: req.user.agent_number || null, at: now };

  await db.collection('tickets').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $push: { timeline: entry }, $set: { updated_at: now } }
  );
  res.json({ success: true });
});

// DELETE /api/tickets/:id — any authenticated user can delete
router.delete('/:id', async (req, res) => {
  const db     = await getDb();
  const result = await db.collection('tickets').deleteOne({ _id: new ObjectId(req.params.id) });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

module.exports = router;
