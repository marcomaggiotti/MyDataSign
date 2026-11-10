'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { generateSellerKeys } = require('../crypto');
const { flash } = require('../middleware');

const router = express.Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

router.get('/register', (req, res) => {
  res.render('register', { title: 'Create account', values: {}, error: null });
});

router.post('/register', authLimiter, async (req, res, next) => {
  const values = {
    email: String(req.body.email || '').trim().toLowerCase(),
    display_name: String(req.body.display_name || '').trim(),
    account_type: req.body.account_type === 'company' ? 'company' : 'individual',
    company_name: String(req.body.company_name || '').trim(),
    vat_id: String(req.body.vat_id || '').trim(),
  };
  const password = String(req.body.password || '');
  const render = (error) => res.status(400).render('register', { title: 'Create account', values, error });

  if (!EMAIL_RE.test(values.email)) return render('Please enter a valid email address.');
  if (values.display_name.length < 2 || values.display_name.length > 80) return render('Display name must be 2–80 characters.');
  if (password.length < 10) return render('Password must be at least 10 characters.');
  if (values.account_type === 'company' && values.company_name.length < 2) return render('Company name is required for company accounts.');
  if (!req.body.terms) return render('You must accept the seller terms.');

  try {
    const hash = await bcrypt.hash(password, 12);
    const keys = generateSellerKeys();
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, display_name, account_type, company_name, vat_id, public_key, private_key_enc)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [values.email, hash, values.display_name, values.account_type,
        values.account_type === 'company' ? values.company_name : null,
        values.account_type === 'company' ? values.vat_id || null : null,
        keys.publicKey, keys.privateKeyEnc],
    );
    if (!rows[0]) return render('An account with this email already exists.');
    await regenerate(req);
    req.session.userId = rows[0].id;
    flash(req, 'success', 'Welcome! Your signing key pair has been created.');
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
});

router.get('/login', (req, res) => {
  res.render('login', { title: 'Sign in', email: '', error: null });
});

router.post('/login', authLimiter, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  try {
    const { rows } = await query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
    // Always run a bcrypt compare so response time does not reveal whether the email exists.
    const hash = rows[0] ? rows[0].password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const ok = await bcrypt.compare(password, hash);
    if (!rows[0] || !ok) {
      return res.status(401).render('login', { title: 'Sign in', email, error: 'Invalid email or password.' });
    }
    const returnTo = req.session.returnTo;
    await regenerate(req);
    req.session.userId = rows[0].id;
    res.redirect(returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/dashboard');
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('mds.sid');
    res.redirect('/');
  });
});

module.exports = router;
