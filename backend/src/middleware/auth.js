const jwt    = require('jsonwebtoken');
const logger = require('../logger');

/** Require a valid JWT — blocks request if missing or invalid */
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    logger.debug('Auth rejected: no token', { method: req.method, path: req.path });
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    logger.debug('Auth rejected: invalid token', { method: req.method, path: req.path, reason: err.message });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Attach user if token present — never blocks */
function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try { req.user = jwt.verify(token, process.env.JWT_SECRET); } catch {}
  }
  next();
}

/** Block if role is not admin */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    logger.warn('Admin access denied', { method: req.method, path: req.path, role: req.user?.role });
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, optionalAuth, requireAdmin };
