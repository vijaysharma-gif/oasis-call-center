const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { createExportJob, getExportJob } = require('../workers/exportWorker');

const router = express.Router();

// Token-based download for analysis export (no Authorization header required).
// Must be declared before `requireAuth` mount — which happens in server.js.
// To expose a non-auth route on this router, we use a path prefix and check
// directly for the signed token.
router.get('/export/jobs/:id/download', async (req, res, next) => {
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  if (!queryToken) return next(); // let Bearer-auth fallback handle it

  let payload;
  try {
    payload = jwt.verify(queryToken, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired download token' });
  }
  if (payload.job_id !== req.params.id || payload.type !== 'analysis-export-download') {
    return res.status(403).json({ error: 'Token does not match job' });
  }

  const job = await getExportJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Export job not found' });
  if (job.status !== 'completed') return res.status(409).json({ error: 'Export is not ready yet' });
  if (!job.file_path) return res.status(404).json({ error: 'Export file missing' });

  const baseDir = path.resolve(process.env.LOG_DIR || path.join(__dirname, '../../logs'), 'exports');
  const filePath = path.resolve(job.file_path);
  if (!filePath.startsWith(baseDir)) return res.status(400).json({ error: 'Invalid export path' });

  try { await fs.access(filePath); }
  catch { return res.status(404).json({ error: 'Export file not found on disk' }); }

  res.download(filePath, job.file_name || path.basename(filePath), (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Failed to download export' });
  });
});

// All routes below require authentication
router.use(requireAuth);

function pickAnalysisExportFilters(src = {}) {
  const pick = k => typeof src[k] === 'string' ? src[k].trim() : '';
  return {
    search: pick('search'),
    category: pick('category'),
    callCategory: pick('callCategory'),
    bugCategory: pick('bugCategory'),
    bugsOnly: pick('bugsOnly'),
    dateFrom: pick('dateFrom'),
    dateTo: pick('dateTo'),
  };
}

function canAccessJob(job, user) {
  if (!job) return false;
  if (user?.role === 'admin') return true;
  return job.requested_by?.agent_number && user?.agent_number && job.requested_by.agent_number === user.agent_number;
}

// POST /api/analysis/export/jobs — queue async export
router.post('/export/jobs', async (req, res) => {
  const filters = pickAnalysisExportFilters(req.body || {});
  const jobId = await createExportJob({ filters, user: req.user, type: 'analysis' });
  res.status(202).json({ job_id: jobId, status: 'pending' });
});

// GET /api/analysis/export/jobs/:id — job status
router.get('/export/jobs/:id', async (req, res) => {
  const job = await getExportJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Export job not found' });
  if (!canAccessJob(job, req.user)) return res.status(403).json({ error: 'Access denied' });

  let downloadUrl = null;
  if (job.status === 'completed') {
    const token = jwt.sign(
      { job_id: job._id.toString(), type: 'analysis-export-download' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    downloadUrl = `/api/analysis/export/jobs/${job._id.toString()}/download?token=${token}`;
  }

  res.json({
    job_id: job._id.toString(),
    status: job.status,
    rows_processed: job.rows_processed || 0,
    file_name: job.file_name || null,
    file_size: job.file_size || null,
    error: job.error || null,
    download_url: downloadUrl,
  });
});

// POST /api/analysis/retry-failed — admin-only: requeue records that exhausted retries.
// Body (all optional):
//   call_ids:   string[]   specific records to reset (takes priority over other filters)
//   since:      ISO date   only records created at or after this
//   until:      ISO date   only records created at or before this
//   all:        boolean    if true, reset every failed record (ignores limit safety cap)
//   limit:      number     max records to reset (default 1000, max 100000)
//   reason:     string     free-text note, stored on each record for audit
//
// By default the endpoint caps at 1000 to avoid accidentally kicking off a huge
// Gemini batch. Pass { "all": true } (or a large `limit`) to override.
router.post('/retry-failed', requireAdmin, async (req, res) => {
  const db = await getDb();
  const { call_ids, since, until, reason, all } = req.body || {};
  const rawLimit = Number(req.body?.limit);
  const limit = all
    ? 1_000_000
    : Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 1000, 1), 100_000);

  // Base filter: only records currently marked failed (terminal state)
  const filter = { status: 'failed' };

  if (Array.isArray(call_ids) && call_ids.length > 0) {
    filter.call_id = { $in: call_ids.filter(id => typeof id === 'string' && id.trim()) };
  } else {
    const dateRange = {};
    if (since) {
      const d = new Date(since);
      if (!Number.isNaN(d.getTime())) dateRange.$gte = d;
    }
    if (until) {
      const d = new Date(until);
      if (!Number.isNaN(d.getTime())) dateRange.$lte = d;
    }
    if (Object.keys(dateRange).length > 0) filter.created_at = dateRange;
  }

  const matched = await db.collection('call_analysis').countDocuments(filter);
  if (matched === 0) {
    return res.json({ ok: true, matched: 0, reset: 0, message: 'No failed records match the filter' });
  }

  const retryMeta = {
    status: 'pending',
    attempts: 0,
    error: null,
    last_error: null,
    next_attempt_at: null,
    processing_id: null,
    retry_requested_at: new Date(),
    retry_requested_by: req.user?.name || req.user?.role || 'admin',
    retry_reason: typeof reason === 'string' ? reason.trim().slice(0, 200) : null,
    updated_at: new Date(),
  };

  // Fast path: resetting all matching records — a single bulk updateMany is
  // much cheaper than fetching _ids then updating.
  if (matched <= limit) {
    const result = await db.collection('call_analysis').updateMany(filter, { $set: retryMeta });
    return res.json({
      ok: true,
      matched,
      reset: result.modifiedCount,
      limited: false,
      message: `Reset ${result.modifiedCount} failed record(s) to pending; the worker will pick them up on its next tick.`,
    });
  }

  // Bounded path: more matches than our limit — pick the newest `limit` records
  const ids = await db.collection('call_analysis')
    .find(filter, { projection: { _id: 1 } })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();

  const result = await db.collection('call_analysis').updateMany(
    { _id: { $in: ids.map(d => d._id) } },
    { $set: retryMeta }
  );

  res.json({
    ok: true,
    matched,
    reset: result.modifiedCount,
    limited: true,
    message: `Reset ${result.modifiedCount} of ${matched} failed record(s) (limited by 'limit'); pass {"all": true} to reset everything.`,
  });
});

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
  const { status, category, search, limit = '25', offset = '0', dateFrom, dateTo, sortBy, sortDir, bugsOnly, bugCategory, callCategory } = req.query;

  const conditions = [{ status: 'completed' }];
  if (bugsOnly) conditions.push({ bugs: { $exists: true, $nin: ['', '-'] } });
  if (bugCategory) conditions.push({ bug_category: bugCategory });
  if (callCategory) conditions.push({ call_category: callCategory });
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

  const SORT_FIELDS = { bugs: 'bugs', bug_category: 'bug_category', call_category: 'call_category', call_resolved: 'call_resolved', agent_score: 'agent_score', audio_quality: 'audio_quality.rating', created_at: 'created_at' };
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
        { projection: { call_id:1, caller_number:1, called_number:1, agent_name:1, agent_number:1, call_start_time:1, duration:1, call_recording:1 } }
      ).toArray()
    : [];
  const callMap = Object.fromEntries(callDocs.map(c => [c.call_id, c]));

  const analyses = docs.map(d => ({ ...d, call: callMap[d.call_id] || null }));

  // Distinct categories for filter dropdown
  const [categories, bugCategories, callCategories] = await Promise.all([
    db.collection('call_analysis')
      .distinct('category', { status: 'completed', category: { $exists: true, $ne: '' } }),
    db.collection('bug_categories').find({}).sort({ name: 1 }).toArray(),
    db.collection('call_categories').find({}).sort({ name: 1 }).toArray(),
  ]);

  res.json({ analyses, total, categories: categories.sort(), bugCategories: bugCategories.map(c => c.name), callCategories: callCategories.map(c => c.name) });
});

module.exports = router;
