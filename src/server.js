'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');

const config = require('./config');
const { pool } = require('./db');
const { migrate } = require('./migrate');
const { loadUser, csrfProtection } = require('./middleware');
const helpers = require('./helpers');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  // Render terminates TLS at its proxy; trust it so secure cookies and req.ip work.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));

  app.get('/healthz', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '1d' : 0 }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(session({
    store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
    name: 'mds.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }));

  app.locals.h = helpers;
  app.locals.appName = 'MyDataSign';
  app.locals.maxUploadBytes = config.maxUploadBytes;
  app.locals.demo = false;

  app.use(loadUser);
  app.use(csrfProtection);

  app.use(require('./routes/auth'));
  app.use(require('./routes/market'));
  app.use(require('./routes/listings'));
  app.use(require('./routes/orders'));
  app.use(require('./routes/verify'));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Not found', message: 'The page you are looking for does not exist.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).render('error', { title: 'File too large', message: `Uploads are limited to ${helpers.formatBytes(config.maxUploadBytes)}.` });
    }
    console.error(err);
    res.status(500).render('error', { title: 'Something went wrong', message: 'An unexpected error occurred.' });
  });

  return app;
}

async function start() {
  await migrate();
  const app = createApp();
  app.listen(config.port, () => console.log(`MyDataSign listening on :${config.port}`));
}

module.exports = { createApp };

if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start', err);
    process.exit(1);
  });
}
