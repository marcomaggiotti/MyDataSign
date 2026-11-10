'use strict';

const { randomToken, safeEqual } = require('./crypto');
const { query } = require('./db');

/** Loads the signed-in user (if any) and exposes common template locals. */
async function loadUser(req, res, next) {
  try {
    res.locals.currentUser = null;
    if (req.session.userId) {
      const { rows } = await query(
        'SELECT id, email, display_name, account_type, company_name FROM users WHERE id = $1',
        [req.session.userId],
      );
      if (rows[0]) {
        req.user = rows[0];
        res.locals.currentUser = rows[0];
      } else {
        delete req.session.userId;
      }
    }
    if (!req.session.csrfToken) req.session.csrfToken = randomToken();
    res.locals.csrfToken = req.session.csrfToken;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    res.locals.path = req.path;
    next();
  } catch (err) {
    next(err);
  }
}

function verifyCsrf(req, res, next) {
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!token || !req.session.csrfToken || !safeEqual(token, req.session.csrfToken)) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'Invalid or expired form token. Please reload the page and try again.' });
  }
  next();
}

/**
 * CSRF protection for every state-changing request. Multipart forms are parsed
 * per-route by multer, so those routes call verifyCsrf themselves after parsing.
 */
function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.is('multipart/form-data')) return next();
  return verifyCsrf(req, res, next);
}

function requireAuth(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function flash(req, type, message) {
  req.session.flash = { type, message };
}

module.exports = { loadUser, csrfProtection, verifyCsrf, requireAuth, flash };
