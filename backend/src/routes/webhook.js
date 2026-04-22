const express = require('express');
const { getDb } = require('../db');
const { enqueueRecording } = require('../workers/analysisWorker');
const logger = require('../logger');

// Normalize to last 10 digits for comparison (handles +91, 91, 0 prefixes)
function normalizeNumber(num) {
  if (!num) return '';
  const digits = String(num).replace(/\D/g, '');
  return digits.slice(-10);
}

// Accept only recording URLs that end in a real audio file extension.
// Missed calls sometimes arrive with just the directory prefix (e.g.
// ".../202604/1445/") — those would always fail Gemini analysis with 403/404,
// so we drop them at ingestion.
const AUDIO_EXT_RE = /\.(wav|mp3|m4a|mp4|aac|ogg|flac)(\?|#|$)/i;

function isValidRecordingUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Must start with http(s) and end with a known audio extension
  if (!/^https?:\/\//i.test(trimmed)) return false;
  return AUDIO_EXT_RE.test(trimmed);
}

const router = express.Router();

function extractCall(payload) {
  const p = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k.toLowerCase().replace(/\s+/g, ''), v]));
  const rawRecording = p.call_recording || p.callrecording || p.recording_url || p.recording || p.recurl || p.file_url || p.audio_url || '';
  // Drop URLs that aren't a real audio file — they'd only fail Gemini analysis.
  const call_recording = isValidRecordingUrl(rawRecording) ? String(rawRecording).trim() : '';
  return {
    call_id:           p.call_id || p.callid || p.uid || p.id || `wb_${Date.now()}`,
    caller_number:     p.caller_number || p.callernumber || p.caller || '',
    called_number:     p.called_number || p.callednumber || p.customer_number || p.mobile || p.to || '',
    agent_number:      p.agent_number || p.agentnumber || p.agent || '',
    agent_name:        p.agent_name || p.agentname || p.account || '',
    call_start_time:   p.call_start_time || p.callstarttime || p.start_time || '',
    agent_answer_time: p.agent_answer_time || p.agentanswertime || p.answer_time || '',
    call_end_time:     p.call_end_time || p.callendtime || p.end_time || '',
    duration:          parseInt(p.duration || p.call_duration || 0) || 0,
    call_recording,
    agent_duration:    (() => { const v = parseInt(p.agent_duration || p.agentduration || 0) || 0; return v > 86400 ? 0 : v; })(),
  };
}

async function upsertCall(db, call) {
  try {
    await db.collection('calls').insertOne({ ...call, created_at: new Date() });
  } catch (err) {
    if (err.code === 11000) {
      const updates = {};
      for (const [key, val] of Object.entries(call)) {
        if (key === 'call_id') continue;
        if (key === 'call_recording' && val !== '') { updates[key] = val; continue; }
        if (typeof val === 'string' && val !== '') updates[key] = val;
        if (typeof val === 'number' && val > 0) updates[key] = val;
      }
      await db.collection('calls').updateOne({ call_id: call.call_id }, { $set: updates });
    } else {
      throw err;
    }
  }
}

router.all('/', async (req, res) => {
  const payload = Object.keys(req.body || {}).length > 0 ? req.body : req.query;
  logger.debug('Webhook received', { method: req.method, payload });

  try {
    const db = await getDb();
    const call = extractCall(payload);

    // Check if initiated via Click2Call (within last 15 minutes)
    // Match on last 10 digits of either caller or called number to handle country-code prefixes
    const callerNorm = normalizeNumber(call.caller_number);
    const calledNorm = normalizeNumber(call.called_number);
    const pendingDocs = await db.collection('click2call_pending')
      .find({ initiated_at: { $gte: new Date(Date.now() - 15 * 60 * 1000) } })
      .toArray();
    const pending = pendingDocs.find(p => {
      const stored = normalizeNumber(p.customer_number);
      return stored && (stored === callerNorm || stored === calledNorm);
    });
    if (pending) {
      call.source = 'click2call';
      // Mark the original missed call as called back by this agent
      const pendingNorm = normalizeNumber(pending.customer_number);
      if (pending.initiated_by && pending.original_call_id) {
        await db.collection('calls').updateOne(
          { call_id: pending.original_call_id },
          { $set: { called_back_by: pending.initiated_by, called_back_at: new Date() } }
        );
      }
      await db.collection('click2call_pending').deleteOne({ _id: pending._id });
      logger.info('Webhook tagged as click2call', { customer: pending.customer_number, called_back_by: pending.initiated_by });
    }

    // Reject pings / empty payloads — must have at least a real call_id or a phone number
    const hasRealCallId = call.call_id && !call.call_id.startsWith('wb_');
    const hasNumber     = call.caller_number || call.called_number;
    if (!hasRealCallId && !hasNumber) {
      logger.debug('Webhook empty/ping payload — ignored');
      return res.json({ status: 'ok' });
    }

    logger.debug('Webhook extracted call', { call_id: call.call_id, callerNorm, calledNorm });
    await upsertCall(db, call);
    logger.info('Webhook saved call', { call_id: call.call_id });

    // Auto-enqueue for AI analysis if a valid recording URL is present.
    // (extractCall already blanks invalid URLs — this is just belt & suspenders.)
    if (call.call_recording && isValidRecordingUrl(call.call_recording)) {
      enqueueRecording(call.call_id, call.call_recording).catch(err =>
        logger.error('Webhook enqueue error', { error: err.message })
      );
    } else if (payload.call_recording || payload.recording_url) {
      // We received a URL but it's not a real audio file — record for observability
      logger.debug('Webhook skipped enqueue: non-audio recording URL', {
        call_id: call.call_id,
        url: (payload.call_recording || payload.recording_url || '').slice(0, 120),
      });
    }

    res.json({ status: 'ok', call_id: call.call_id });
  } catch (err) {
    logger.error('Webhook error', { error: err.message, stack: err.stack });
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
