const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');
const logger          = require('../logger');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  // ── Admin login ──────────────────────────────────────────────────────────
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = jwt.sign({ role: 'admin', name: 'Admin' }, process.env.JWT_SECRET, { expiresIn: '12h' });
    logger.info('Admin login', { username });
    return res.json({ token, user: { role: 'admin', name: 'Admin' } });
  }

  // ── Agent login ──────────────────────────────────────────────────────────
  const db    = await getDb();
  const agent = await db.collection('agents').findOne({ agent_number: username });

  if (!agent) { logger.warn('Login failed: agent not found', { username }); return res.status(401).json({ error: 'Invalid credentials' }); }

  const valid = await bcrypt.compare(password, agent.password_hash);
  if (!valid) { logger.warn('Login failed: wrong password', { username }); return res.status(401).json({ error: 'Invalid credentials' }); }

  const token = jwt.sign(
    { role: 'agent', agent_id: agent._id.toString(), agent_number: agent.agent_number, name: agent.name },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: { role: 'agent', name: agent.name, agent_number: agent.agent_number },
    must_change_password: agent.must_change_password === true,
  });
});

// POST /api/auth/refresh — silently issue a fresh token while current one is still valid
router.post('/refresh', requireAuth, (req, res) => {
  const { role, agent_id, agent_number, name } = req.user;
  const payload = role === 'admin'
    ? { role, name }
    : { role, agent_id, agent_number, name };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// POST /api/auth/change-password — agent changes their own password
router.post('/change-password', requireAuth, async (req, res) => {
  if (req.user.role !== 'agent') return res.status(403).json({ error: 'Agents only' });

  const { new_password } = req.body;
  if (!new_password || new_password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const db = await getDb();
  const { ObjectId } = require('mongodb');
  const password_hash = await bcrypt.hash(new_password, 10);
  await db.collection('agents').updateOne(
    { _id: new ObjectId(req.user.agent_id) },
    { $set: { password_hash, must_change_password: false } }
  );

  res.json({ success: true });
});

module.exports = router;
