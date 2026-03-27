const { MongoClient } = require('mongodb');
const logger = require('./logger');

let dbPromise = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = MongoClient.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    })
      .then(client => {
        client.on('error', (err) => {
          logger.error('[DB] Connection error — will reconnect on next request', { message: err.message });
          dbPromise = null;
        });
        client.on('close', () => {
          logger.warn('[DB] Connection closed — will reconnect on next request');
          dbPromise = null;
        });
        const db = client.db('callcenter');
        logger.info('[DB] Connected', { database: 'callcenter' });
        return Promise.all([
          db.collection('calls').createIndex({ call_id: 1 }, { unique: true }),
          db.collection('call_analysis').createIndex({ call_id: 1 }, { unique: true }),
          db.collection('call_analysis').createIndex({ status: 1, created_at: 1 }),
          db.collection('agents').createIndex({ agent_number: 1 }, { unique: true }),
        ]).then(() => db);
      })
      .catch(err => {
        logger.error('[DB] Failed to connect', { message: err.message });
        dbPromise = null;
        throw err;
      });
  }
  return dbPromise;
}

module.exports = { getDb };
