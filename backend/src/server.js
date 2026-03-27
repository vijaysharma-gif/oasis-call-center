require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const logger       = require('./logger');

const callsRouter    = require('./routes/calls');
const webhookRouter  = require('./routes/webhook');
const analysisRouter = require('./routes/analysis');
const agentsRouter   = require('./routes/agents');
const authRouter     = require('./routes/auth');
const ticketsRouter  = require('./routes/tickets');
const { requireAuth } = require('./middleware/auth');
const { startWorker } = require('./workers/analysisWorker');

const app  = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── HTTP request logging ──────────────────────────────────────────────────────
app.use(morgan(isProd ? 'combined' : 'dev', {
  stream: { write: msg => logger.http(msg.trim()) },
  skip: (req) => req.path === '/health',
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Production: strict per-IP limits (real users each have their own IP).
// Development: relaxed so load tests from a single localhost IP aren't throttled.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 20 : 10000,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: isProd ? 300 : 30000,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',          authLimiter, authRouter);
app.use('/api/calls',         apiLimiter,  callsRouter);
app.use('/api/analysis',      apiLimiter,  requireAuth, analysisRouter);
app.use('/api/agents',        apiLimiter,  agentsRouter);
app.use('/api/tickets',       apiLimiter,  ticketsRouter);
app.use('/webhook/recording',             webhookRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const { getDb } = require('./db');
    await getDb();
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), env: process.env.NODE_ENV || 'development' });
  } catch (err) {
    res.status(503).json({ status: 'error', message: 'DB unavailable' });
  }
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  logger.error('Unhandled error', {
    method: req.method,
    path:   req.path,
    status,
    message: err.message,
    stack: isProd ? undefined : err.stack,
  });
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
    ...(isProd ? {} : { stack: err.stack }),
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server started`, { port: PORT, env: process.env.NODE_ENV || 'development' });
    startWorker();
  });

  // Graceful shutdown
  function shutdown(signal) {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Force shutdown after timeout');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (err) => {
    logger.error('Unhandled rejection', { message: err?.message, stack: err?.stack });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { message: err?.message, stack: err?.stack });
    process.exit(1);
  });
}

module.exports = app;
