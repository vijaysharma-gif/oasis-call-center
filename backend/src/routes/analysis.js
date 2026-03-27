const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

// GET /api/analysis/:call_id — fetch analysis for a specific call
router.get('/:call_id', async (req, res) => {
  const db  = await getDb();
  const doc = await db.collection('call_analysis').findOne(
    { call_id: req.params.call_id },
    { projection: { _id: 0 } }
  );

  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

// GET /api/analysis — paginated list with search/filter + joined call data
router.get('/', async (req, res) => {
  const db = await getDb();
  const { status, category, search, limit = '25', offset = '0', dateFrom, dateTo, sortBy, sortDir } = req.query;

  const conditions = [{ status: 'completed' }];
  if (category) conditions.push({ category });
  if (search)   conditions.push({ $or: [
    { call_id:     { $regex: search, $options: 'i' } },
    { category:    { $regex: search, $options: 'i' } },
    { sub_category:{ $regex: search, $options: 'i' } },
    { ai_insight:  { $regex: search, $options: 'i' } },
  ]});
  if (dateFrom || dateTo) {
    const dc = {};
    if (dateFrom) dc.$gte = new Date(dateFrom);
    if (dateTo)   dc.$lte = new Date(dateTo);
    conditions.push({ created_at: dc });
  }

  const filter = { $and: conditions };

  const SORT_FIELDS = { bugs: 'bugs', call_resolved: 'call_resolved', agent_score: 'agent_score', audio_quality: 'audio_quality.rating', created_at: 'created_at' };
  const sortField = SORT_FIELDS[sortBy] ?? 'created_at';
  const sortOrder = sortDir === 'asc' ? 1 : -1;

  const [docs, total] = await Promise.all([
    db.collection('call_analysis').find(filter, { projection: { _id: 0 } })
      .sort({ [sortField]: sortOrder }).skip(Number(offset)).limit(Number(limit)).toArray(),
    db.collection('call_analysis').countDocuments(filter),
  ]);

  // Join call data (caller, called, agent, duration, start time)
  const callIds  = docs.map(d => d.call_id);
  const callDocs = callIds.length
    ? await db.collection('calls').find({ call_id: { $in: callIds } },
        { projection: { call_id:1, caller_number:1, called_number:1, agent_name:1, agent_number:1, call_start_time:1, duration:1 } }
      ).toArray()
    : [];
  const callMap = Object.fromEntries(callDocs.map(c => [c.call_id, c]));

  const analyses = docs.map(d => ({ ...d, call: callMap[d.call_id] || null }));

  // Distinct categories for filter dropdown
  const categories = await db.collection('call_analysis')
    .distinct('category', { status: 'completed', category: { $exists: true, $ne: '' } });

  res.json({ analyses, total, categories: categories.sort() });
});

module.exports = router;
