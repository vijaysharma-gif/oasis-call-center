const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../logs');

const { combine, timestamp, errors, json, colorize, printf } = format;

const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${ts} ${level}: ${stack || message}${extra}`;
  })
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  format: isProd ? prodFormat : devFormat,
  transports: [
    new transports.Console({ silent: process.env.NODE_ENV === 'test' }),
  ],
});

if (isProd) {
  logger.add(new transports.DailyRotateFile({
    dirname:     LOG_DIR,
    filename:    'app-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles:    '30d',
    maxSize:     '20m',
    zippedArchive: true,
  }));

  logger.add(new transports.DailyRotateFile({
    level:       'error',
    dirname:     LOG_DIR,
    filename:    'error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles:    '90d',
    maxSize:     '10m',
    zippedArchive: true,
  }));
}

module.exports = logger;
