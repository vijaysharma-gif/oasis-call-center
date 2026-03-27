const express = require('express');
const { getDb } = require('../db');
const { enqueueRecording } = require('../workers/analysisWorker');

// Normalize to last 10 digits for comparison (handles +91, 91, 0 prefixes)
function normalizeNumber(num) {
  if (!num) return '';
  const digits = String(num).replace(/\D/g, '');
  return digits.slice(-10);
}

const router = express.Router();

function extractCall(payload) {
  const p = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k.toLowerCase().replace(/\s+/g, ''), v]));
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
    call_recording:    p.call_recording || p.callrecording || p.recording_url || p.recording || p.recurl || p.file_url || p.audio_url || '',
    agent_duration:    (() => { const v = parseInt(p.agent_duration || p.agentduration || 0) || 0; return v > 86400 ? 0 : v; })(),
    raw_payload:       JSON.stringify(payload),
  };
}

async function upsertCall(db, call) {
  try {
    await db.collection('calls').insertOne({ ...call, created_at: new Date() });
  } catch (err) {
    if (err.code === 11000) {
      const updates = { raw_payload: call.raw_payload };
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
  console.log(`\n[Webhook] ${req.method} ${new Date().toISOString()}`);
  console.log('[Webhook] Raw payload:', JSON.stringify(payload, null, 2));

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
      await db.collection('click2call_pending').deleteOne({ _id: pending._id });
      console.log(`[Webhook] Tagged as click2call (matched customer ${pending.customer_number})`);
    }

    // Reject pings / empty payloads — must have at least a real call_id or a phone number
    const hasRealCallId = call.call_id && !call.call_id.startsWith('wb_');
    const hasNumber     = call.caller_number || call.called_number;
    if (!hasRealCallId && !hasNumber) {
      console.log('[Webhook] Empty/ping payload — ignored');
      return res.json({ status: 'ok' });
    }

    console.log('[Webhook] Extracted:', JSON.stringify(call, null, 2));
    console.log(`[Webhook] caller_norm=${callerNorm} called_norm=${calledNorm}`);
    await upsertCall(db, call);
    console.log(`[Webhook] Saved call_id: ${call.call_id}`);

    // Auto-enqueue for AI analysis if a recording URL is present
    if (call.call_recording) {
      enqueueRecording(call.call_id, call.call_recording).catch(err =>
        console.error('[Webhook] Enqueue error:', err.message)
      );
    }

    res.json({ status: 'ok', call_id: call.call_id });
  } catch (err) {
    console.error('[Webhook] Error:', err.message, err.stack);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
