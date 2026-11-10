'use strict';

const { Pool } = require('pg');
const config = require('./config');

// Render's managed Postgres requires TLS for external connections; the internal
// connection string works without it. Enable TLS only when the URL asks for it.
const needsSsl = /sslmode=require/.test(config.databaseUrl) || process.env.PGSSL === 'true';

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX || 10),
});

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
