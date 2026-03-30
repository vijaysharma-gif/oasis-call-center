const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');
const logger = require('../logger');

const router = express.Router();

// All calls routes require authentication
router.use(requireAuth);

router.get('/', async (req, res) => {
  const db = await getDb();
  const { search, status, limit = '25', offset = '0', dateFrom, dateTo, agentNumber, sortBy, sortDir } = req.query;

  const conditions = [];

  // Agents see their own calls + missed calls (hide missed calls called back by another agent)
  if (req.user.role === 'agent') {
    conditions.push({
      $or: [
        { agent_number: req.user.agent_number },
        { caller_number: req.user.agent_number },
        { called_number: req.user.agent_number },
        {
          $and: [
            { $or: [{ agent_answer_time: { $exists: false } }, { agent_answer_time: '' }] },
            { $or: [{ called_back_by: { $exists: false } }, { called_back_by: req.user.agent_number }] },
          ],
        },
      ],
    });
  }

  if (search) {
    conditions.push({ $or: [
      { caller_number: { $regex: search, $options: 'i' } },
      { called_number: { $regex: search, $options: 'i' } },
      { agent_name:    { $regex: search, $options: 'i' } },
      { agent_number:  { $regex: search, $options: 'i' } },
    ]});
  }

  if (status === 'received') {
    conditions.push({ agent_answer_time: { $exists: true, $ne: '' } });
  } else if (status === 'missed') {
    conditions.push({ $or: [{ agent_answer_time: { $exists: false } }, { agent_answer_time: '' }] });
  }

  if (dateFrom || dateTo) {
    const dateCondition = {};
    if (dateFrom) dateCondition.$gte = new Date(dateFrom);
    if (dateTo) dateCondition.$lte = new Date(dateTo);
    conditions.push({ created_at: dateCondition });
  }

  // Admin-only agent filter (agents are already scoped to their own calls above)
  if (agentNumber && req.user.role === 'admin') {
    conditions.push({ agent_number: agentNumber });
  }

  const filter = conditions.length > 0 ? { $and: conditions } : {};

  const CALL_SORT_FIELDS = { call_start_time: 'call_start_time', agent_answer_time: 'agent_answer_time', agent_duration: 'agent_duration', duration: 'duration', created_at: 'created_at' };
  const callSortField = CALL_SORT_FIELDS[sortBy] ?? 'created_at';
  const callSortOrder = sortDir === 'asc' ? 1 : -1;

  // Use aggregation so nulls/missing values always sort last regardless of direction
  const [docs, total] = await Promise.all([
    db.collection('calls').aggregate([
      { $match: filter },
      { $addFields: { _hasVal: { $cond: [{ $gt: [`$${callSortField}`, null] }, 1, 0] } } },
      { $sort: { _hasVal: -1, [callSortField]: callSortOrder, _id: -1 } },
      { $skip: Number(offset) },
      { $limit: Number(limit) },
      { $project: { _hasVal: 0 } },
    ]).toArray(),
    db.collection('calls').countDocuments(filter),
  ]);

  // Collect unique agent numbers and look up names from agents collection
  const agentNumbers = [...new Set(docs.map(d => d.agent_number).filter(Boolean))];
  const agentDocs = agentNumbers.length
    ? await db.collection('agents').find({ agent_number: { $in: agentNumbers } }, { projection: { agent_number: 1, name: 1 } }).toArray()
    : [];
  const agentNameMap = Object.fromEntries(agentDocs.map(a => [a.agent_number, a.name]));

  const calls = docs.map(({ _id, ...doc }) => {
    return {
      id: _id.toString(),
      ...doc,
      ...(doc.agent_number && agentNameMap[doc.agent_number]
        ? { agent_name: agentNameMap[doc.agent_number] }
        : {}),
    };
  });
  res.json({ calls, total });
});

// GET /api/calls/export — all filtered records (no pagination) for XLSX export
router.get('/export', async (req, res) => {
  const db = await getDb();
  const { search, status, dateFrom, dateTo, agentNumber } = req.query;

  const conditions = [];

  if (req.user.role === 'agent') {
    conditions.push({
      $or: [
        { agent_number: req.user.agent_number },
        { caller_number: req.user.agent_number },
        { called_number: req.user.agent_number },
        { agent_answer_time: { $exists: false } },
        { agent_answer_time: '' },
      ],
    });
  }

  if (search) {
    conditions.push({ $or: [
      { caller_number: { $regex: search, $options: 'i' } },
      { called_number: { $regex: search, $options: 'i' } },
      { agent_name:    { $regex: search, $options: 'i' } },
      { agent_number:  { $regex: search, $options: 'i' } },
    ]});
  }

  if (status === 'received') {
    conditions.push({ agent_answer_time: { $exists: true, $ne: '' } });
  } else if (status === 'missed') {
    conditions.push({ $or: [{ agent_answer_time: { $exists: false } }, { agent_answer_time: '' }] });
  }

  if (dateFrom || dateTo) {
    const dc = {};
    if (dateFrom) dc.$gte = new Date(dateFrom);
    if (dateTo)   dc.$lte = new Date(dateTo);
    conditions.push({ created_at: dc });
  }

  if (agentNumber && req.user.role === 'admin') {
    conditions.push({ agent_number: agentNumber });
  }

  const filter = conditions.length > 0 ? { $and: conditions } : {};

  const docs = await db.collection('calls').find(filter).sort({ created_at: -1 }).toArray();

  const agentNumbers = [...new Set(docs.map(d => d.agent_number).filter(Boolean))];
  const agentDocs = agentNumbers.length
    ? await db.collection('agents').find({ agent_number: { $in: agentNumbers } }, { projection: { agent_number: 1, name: 1 } }).toArray()
    : [];
  const agentNameMap = Object.fromEntries(agentDocs.map(a => [a.agent_number, a.name]));

  // Join analysis data
  const callIds = docs.map(d => d.call_id).filter(Boolean);
  const analysisDocs = callIds.length
    ? await db.collection('call_analysis').find({ call_id: { $in: callIds }, status: 'completed' }).toArray()
    : [];
  const analysisMap = Object.fromEntries(analysisDocs.map(a => [a.call_id, a]));

  const fmt = v => v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';

  const rows = docs.map(doc => {
    const a = analysisMap[doc.call_id] || {};
    return {
      'Call ID':          doc.call_id || '',
      'Caller Number':    doc.caller_number || '',
      'Called Number':    doc.called_number || '',
      'Agent Name':       agentNameMap[doc.agent_number] || doc.agent_name || '',
      'Agent Number':     doc.agent_number || '',
      'Status':           doc.agent_answer_time ? 'Received' : 'Missed',
      'Call Start Time':  fmt(doc.call_start_time),
      'Answer Time':      fmt(doc.agent_answer_time),
      'Call End Time':    fmt(doc.call_end_time),
      'Duration (s)':     doc.duration || 0,
      'Agent Duration (s)': doc.agent_duration || 0,
      'Call Category':    a.call_category || '',
      'Sub-Category':     a.ai_insight || '',
      'Summary':          (a.summary || '').replace(/\n/g, '\r\n'),
      'Bug Category':     a.bug_category || '',
      'Bug Description':  a.bugs || '',
      'Call Resolved':    a.call_resolved || '',
      'Agent Score':      a.agent_score ?? '',
      'Audio Rating':     a.audio_quality?.rating || '',
      'Language':         Array.isArray(a.language) ? a.language.join(', ') : (a.language || ''),
      'Recording URL':    doc.call_recording || '',
      'Transcription':    (a.transcription || '').replace(/(CANDIDATE:|AGENT:|SYSTEM:)/g, '\n$1').replace(/\n{2,}/g, '\n').trim(),
      'Created At':       fmt(doc.created_at),
    };
  });

  res.json({ rows });
});

router.get('/stats/summary', async (req, res) => {
  const db = await getDb();
  const col = db.collection('calls');
  const { dateFrom, dateTo } = req.query;
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

  // Agents only see stats for their own calls
  const roleFilter = req.user.role === 'agent'
    ? { $or: [
        { agent_number: req.user.agent_number },
        { caller_number: req.user.agent_number },
        { called_number: req.user.agent_number },
        { agent_answer_time: { $exists: false } },
        { agent_answer_time: '' },
      ]}
    : {};

  // Date range filter
  const dateRangeFilter = {};
  if (dateFrom || dateTo) {
    const dc = {};
    if (dateFrom) dc.$gte = new Date(dateFrom);
    if (dateTo) dc.$lte = new Date(dateTo);
    dateRangeFilter.created_at = dc;
  }

  // Combined base filter (role + date range)
  const agentFilter = Object.keys(roleFilter).length
    ? (Object.keys(dateRangeFilter).length ? { $and: [roleFilter, dateRangeFilter] } : roleFilter)
    : dateRangeFilter;

  const receivedFilter = { agent_answer_time: { $exists: true, $ne: '' } };
  const missedFilter   = { $or: [{ agent_answer_time: { $exists: false } }, { agent_answer_time: '' }] };

  // For "today" stats, honour date filter if set, otherwise use start of today
  const todayStart = (dateFrom && !dateTo) ? new Date(dateFrom) : (dateTo ? new Date(dateFrom || 0) : startOfDay);
  const todayEnd   = dateTo ? new Date(dateTo) : null;
  const todayDateFilter = { created_at: { $gte: todayStart, ...(todayEnd ? { $lte: todayEnd } : {}) } };
  const todayReceivedFilter = { ...todayDateFilter, agent_answer_time: { $exists: true, $ne: '' } };
  const baseAndFilter = f => Object.keys(agentFilter).length ? { $and: [agentFilter, f] } : f;

  const andWith = (base, extra) => Object.keys(base).length ? { $and: [base, extra] } : extra;

  const [total, received, missed, recorded, today, [agg], latestDoc, agentBreakdownRaw, agentAvgRaw, categoryRaw, insightsRaw, topBugsRaw] = await Promise.all([
    col.countDocuments(agentFilter),
    col.countDocuments(baseAndFilter(receivedFilter)),
    col.countDocuments(baseAndFilter(missedFilter)),
    col.countDocuments(andWith(agentFilter, { call_recording: { $exists: true, $ne: '' } })),
    col.countDocuments(andWith(agentFilter, todayReceivedFilter)),
    col.aggregate([
      { $match: andWith(agentFilter, { agent_answer_time: { $exists: true, $ne: '' }, call_end_time: { $exists: true, $ne: '' } }) },
      { $addFields: { _agentDur: { $max: [0, { $divide: [{ $subtract: [{ $toDate: '$call_end_time' }, { $toDate: '$agent_answer_time' }] }, 1000] }] } } },
      { $group: { _id: null, avgDuration: { $avg: '$duration' }, avgAgentDuration: { $avg: '$_agentDur' } } },
    ]).toArray(),
    col.find(andWith(agentFilter, { $or: [{ agent_answer_time: { $exists: false } }, { agent_answer_time: '' }] })).sort({ created_at: -1 }).limit(10).toArray(),
    col.aggregate([
      { $match: baseAndFilter(receivedFilter) },
      { $group: { _id: '$agent_number', agent_name: { $first: '$agent_name' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
    col.aggregate([
      { $match: andWith(agentFilter, { agent_number: { $exists: true, $ne: '' }, duration: { $exists: true, $gt: 0 } }) },
      { $group: { _id: '$agent_number', agent_name: { $first: '$agent_name' }, avgDuration: { $avg: '$duration' } } },
      { $sort: { avgDuration: -1 } },
    ]).toArray(),
    col.aggregate([
      { $match: andWith(agentFilter, { category: { $exists: true, $ne: '' } }) },
      { $group: { _id: { category: '$category', sub_category: '$sub_category' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
    db.collection('call_analysis').aggregate([
      { $match: { status: 'completed', ai_insight: { $exists: true, $nin: [null, '', '-'] } } },
      { $group: { _id: { category: '$category', insight: '$ai_insight' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $group: { _id: '$_id.category', insights: { $push: { insight: '$_id.insight', count: '$count' } } } },
    ]).toArray(),
    db.collection('call_analysis').aggregate([
      { $match: { status: 'completed', bug_category: { $exists: true, $nin: [null, '', '-', 'Uncategorised'] }, ...dateRangeFilter } },
      { $group: { _id: '$bug_category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray(),
  ]);

  // Enrich agent names from agents collection
  const allAgentNumbers = [...new Set([
    ...agentBreakdownRaw.map(a => a._id),
    ...agentAvgRaw.map(a => a._id),
  ].filter(Boolean))];
  const agentDocs = allAgentNumbers.length
    ? await db.collection('agents').find({ agent_number: { $in: allAgentNumbers } }, { projection: { agent_number: 1, name: 1 } }).toArray()
    : [];
  const agentNameMap = Object.fromEntries(agentDocs.map(a => [a.agent_number, a.name]));

  const todayByAgent = agentBreakdownRaw.map(a => ({
    agent_number: a._id,
    agent_name: agentNameMap[a._id] || a.agent_name || a._id || 'Unknown',
    verified: !!agentNameMap[a._id],
    count: a.count,
  }));

  const avgDurationByAgent = agentAvgRaw.map(a => ({
    agent_number: a._id,
    agent_name: agentNameMap[a._id] || a.agent_name || a._id || 'Unknown',
    verified: !!agentNameMap[a._id],
    avgDuration: Math.round(a.avgDuration),
  }));

  const latestMissed = latestDoc.map(({ _id, ...rest }) => ({ id: _id.toString(), ...rest }));

  // Category breakdown — group sub-categories under their parent
  const catMap = {};
  categoryRaw.forEach(({ _id: { category, sub_category }, count }) => {
    if (!category) return;
    if (!catMap[category]) catMap[category] = { category, total: 0, subs: [] };
    catMap[category].total += count;
    if (sub_category) catMap[category].subs.push({ sub_category, count });
  });
  const categoryBreakdown = Object.values(catMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // Build insights map: { [category]: [top 3 insights] }
  const categoryInsights = {};
  for (const row of insightsRaw) {
    if (!row._id) continue;
    categoryInsights[row._id] = row.insights.slice(0, 3).map(i => i.insight);
  }

  // Global date bounds — always use roleFilter (not date-filtered agentFilter) so these never change with the filter
  const [minDateDoc, maxDateDoc] = await Promise.all([
    col.find(roleFilter).sort({ created_at: 1 }).limit(1).toArray(),
    col.find(roleFilter).sort({ created_at: -1 }).limit(1).toArray(),
  ]);

  const topBugs = topBugsRaw.map(r => ({ category: r._id, count: r.count }));

  res.json({ total, received, missed, recorded, today, avgDuration: Math.round(agg?.avgDuration || 0), avgAgentDuration: Math.round(agg?.avgAgentDuration || 0), latestMissed, todayByAgent, avgDurationByAgent, categoryBreakdown, categoryInsights, topBugs, minDate: minDateDoc[0]?.created_at ?? null, maxDate: maxDateDoc[0]?.created_at ?? null });
});

// Check if a click2call for a given number was confirmed by webhook within a time window
router.get('/click2call/check', async (req, res) => {
  const { number, since } = req.query;
  if (!number || !since) return res.status(400).json({ error: 'number and since required' });

  const db = await getDb();
  const sinceDate = new Date(Number(since));
  const last10 = number.replace(/\D/g, '').slice(-10);

  // Fetch recent click2call records and normalize numbers for comparison
  const candidates = await db.collection('calls').find({
    source: 'click2call',
    created_at: { $gte: sinceDate },
  }).toArray();

  const call = candidates.find(c =>
    c.caller_number?.replace(/\D/g, '').slice(-10) === last10 ||
    c.called_number?.replace(/\D/g, '').slice(-10) === last10
  );

  res.json({ found: !!call, call_id: call?.call_id ?? null });
});

router.get('/download', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).json({ error: 'Failed to fetch' });
    const filename = url.split('/').pop().split('?')[0] || 'recording.wav';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/wav');
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Verify latest recording URL is accessible
router.get('/recordings/check', async (req, res) => {
  const db = await getDb();
  const call = await db.collection('calls').findOne(
    { call_recording: { $exists: true, $ne: '' } },
    { sort: { created_at: -1 } }
  );
  if (!call) return res.json({ found: false, message: 'No calls with recording URLs' });

  const url = call.call_recording;
  try {
    const { status, headers } = await fetch(url, { method: 'HEAD' });
    logger.debug('Recording check', { call_id: call.call_id, url, status, size: headers.get('content-length'), type: headers.get('content-type') });
    res.json({ found: true, call_id: call.call_id, url, status, size: headers.get('content-length'), type: headers.get('content-type') });
  } catch (e) {
    res.json({ found: true, call_id: call.call_id, url, error: e.message });
  }
});

router.post('/initiate', async (req, res) => {
  const { customer_number, agent_number, original_call_id } = req.body;
  if (!customer_number) return res.status(400).json({ error: 'customer_number is required' });

  logger.info('Click2Call initiated', { customer: customer_number, agent: agent_number || 'none', initiated_by: req.user?.name || req.user?.role });

  const db = await getDb();
  await db.collection('click2call_pending').insertOne({
    customer_number,
    agent_number: agent_number || '',
    initiated_by: req.user?.agent_number || req.user?.name || '',
    original_call_id: original_call_id || '',
    initiated_at: new Date(),
  });

  const params = new URLSearchParams({ auth: process.env.BUZZDIAL_AUTH, cust_no: customer_number, agent_name: req.user?.name || process.env.BUZZDIAL_AGENT_NAME });
  if (agent_number) params.append('agent_no', agent_number);

  const response = await fetch(`${process.env.BUZZDIAL_URL || 'https://buzzdial.io/api/clicktocall.php'}?${params}`);
  const result   = await response.json();
  logger.info('Click2Call BuzzDial response', { result });
  res.json(result);
});


router.get('/:id', async (req, res) => {
  const db = await getDb();
  const { id } = req.params;
  const filter = ObjectId.isValid(id) ? { $or: [{ _id: new ObjectId(id) }, { call_id: id }] } : { call_id: id };
  const doc = await db.collection('calls').findOne(filter);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const { _id, ...rest } = doc;
  res.json({ id: _id.toString(), ...rest });
});

// Manually set recording URL for a call by call_id
router.patch('/:id/recording', async (req, res) => {
  const db = await getDb();
  const { id } = req.params;
  const { recording_url } = req.body;
  if (!recording_url) return res.status(400).json({ error: 'recording_url required' });
  const result = await db.collection('calls').updateOne(
    { $or: [{ call_id: id }, { _id: ObjectId.isValid(id) ? new ObjectId(id) : null }] },
    { $set: { call_recording: recording_url } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});


module.exports = router;
