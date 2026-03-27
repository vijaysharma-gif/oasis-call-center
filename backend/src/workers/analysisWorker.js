/**
 * Analysis Worker — background job that processes call recordings.
 *
 * Polls every POLL_INTERVAL_MS for calls that have a recording URL
 * but no completed analysis yet. Processes one at a time and writes
 * results to the `call_analysis` collection.
 */
const { getDb }               = require('../db');
const { categorizeRecording } = require('../services/geminiService');
const logger                  = require('../logger');

const POLL_INTERVAL_MS = 10_000;  // check every 10 seconds
const STALE_LOCK_MIN   = 15;      // re-queue if stuck in "processing" > 15 min

let isRunning = false;

// ─── One processing tick ──────────────────────────────────────────────────────

async function processTick() {
  if (isRunning) return;

  let db;
  try {
    db = await getDb();
  } catch (err) {
    logger.error('[Worker] DB connection error', { message: err.message });
    return;
  }

  const analysisCol = db.collection('call_analysis');
  const callsCol    = db.collection('calls');

  // ── 1. Reset stale "processing" records ──────────────────────────────────
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MIN * 60 * 1000);
  await analysisCol.updateMany(
    { status: 'processing', updated_at: { $lt: staleThreshold } },
    { $set: { status: 'pending', error: 'Stale lock reset', updated_at: new Date() } }
  );

  // ── 2. Find a pending call_analysis record ────────────────────────────────
  const record = await analysisCol.findOneAndUpdate(
    { status: 'pending' },
    { $set: { status: 'processing', updated_at: new Date() } },
    { sort: { created_at: 1 }, returnDocument: 'after' }
  );

  if (!record) return;

  isRunning = true;
  const { call_id, recording_url } = record;
  logger.info('[Worker] Processing', { call_id });

  try {
    const callDoc = await callsCol.findOne({ call_id });
    if (callDoc && callDoc.duration > 0 && callDoc.duration < 10) {
      await analysisCol.updateOne(
        { call_id },
        { $set: { status: 'completed', category: 'Call too Short', sub_category: '', summary: '', transcription: '', language: '', error: null, processed_at: new Date(), updated_at: new Date() } }
      );
      await callsCol.updateOne({ call_id }, { $set: { category: 'Call too Short', sub_category: '' } });
      logger.info('[Worker] Skipped (too short)', { call_id, duration: callDoc.duration });
      isRunning = false;
      return;
    }

    const result = await categorizeRecording(recording_url);

    if (result.success && result.category === 'Audio Unclear') {
      await analysisCol.updateOne(
        { call_id },
        { $set: { status: 'completed', category: 'Audio Unclear', sub_category: '', summary: result.summary || '', ai_insight: '-', bugs: '-', agent_score: null, call_resolved: 'No', audio_quality: result.audio_quality, transcription: result.transcription || '', language: result.language || [], error: null, processed_at: new Date(), updated_at: new Date() } }
      );
      await callsCol.updateOne({ call_id }, { $set: { category: 'Audio Unclear', sub_category: '' } });
      logger.info('[Worker] Audio Unclear', { call_id });
    } else if (result.permanent) {
      await analysisCol.updateOne(
        { call_id },
        { $set: { status: 'failed', error: result.error, updated_at: new Date() }, $inc: { attempts: 1 } }
      );
      await callsCol.updateOne({ call_id }, { $set: { call_recording: '' } });
      logger.warn('[Worker] Permanent failure — not retrying', { call_id, error: result.error });
    } else if (result.success) {
      await analysisCol.updateOne(
        { call_id },
        {
          $set: {
            status:        'completed',
            category:      result.category,
            sub_category:  result.sub_category,
            summary:       result.summary,
            ai_insight:    result.ai_insight,
            bugs:          result.bugs,
            agent_score:   result.agent_score,
            call_resolved: result.call_resolved,
            audio_quality: result.audio_quality,
            transcription: result.transcription,
            language:      result.language,
            error:         null,
            processed_at:  new Date(),
            updated_at:    new Date(),
          },
        }
      );
      await callsCol.updateOne(
        { call_id },
        { $set: { category: result.category, sub_category: result.sub_category } }
      );
      logger.info('[Worker] Done', { call_id, category: result.category, sub_category: result.sub_category });
    } else {
      await analysisCol.updateOne(
        { call_id },
        { $set: { status: 'failed', error: result.error, updated_at: new Date() }, $inc: { attempts: 1 } }
      );
      logger.warn('[Worker] Failed', { call_id, error: result.error });

      const updated = await analysisCol.findOne({ call_id });
      if ((updated?.attempts || 0) < 3) {
        await analysisCol.updateOne(
          { call_id },
          { $set: { status: 'pending', updated_at: new Date() } }
        );
      }
    }
  } catch (err) {
    logger.error('[Worker] Unexpected error', { call_id, message: err.message, stack: err.stack });
    await analysisCol.updateOne(
      { call_id },
      { $set: { status: 'failed', error: err.message, updated_at: new Date() } }
    );
  } finally {
    isRunning = false;
  }
}

// ─── Enqueue a new recording (called by webhook) ──────────────────────────────

async function enqueueRecording(call_id, recording_url) {
  const db  = await getDb();
  const col = db.collection('call_analysis');

  const existing = await col.findOne({ call_id });
  if (existing && (existing.status === 'completed' || existing.status === 'failed')) return;

  await col.updateOne(
    { call_id },
    {
      $setOnInsert: { created_at: new Date(), attempts: 0 },
      $set: { recording_url, status: 'pending', updated_at: new Date() },
    },
    { upsert: true }
  );
  logger.info('[Worker] Enqueued', { call_id });
}

// ─── Start the background polling loop ───────────────────────────────────────

function startWorker() {
  logger.info(`[Worker] Started`, { pollIntervalSec: POLL_INTERVAL_MS / 1000 });
  processTick();
  setInterval(processTick, POLL_INTERVAL_MS);
}

module.exports = { startWorker, enqueueRecording };
