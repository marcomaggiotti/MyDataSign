'use strict';

const express = require('express');
const multer = require('multer');
const config = require('../config');
const { query, withTransaction } = require('../db');
const { encrypt, sha256Hex, manifestFor, signManifest } = require('../crypto');
const { requireAuth, verifyCsrf, flash } = require('../middleware');
const { loadTaxonomy } = require('./market');
const { LICENSES, CURRENCIES, DATA_FORMATS, FIELD_TYPES, parsePriceToCents } = require('../helpers');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 200 },
});

const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v, max) => String(v ?? '').trim().slice(0, max);

/** Validates the listing form; returns { values, errors }. */
async function parseListingForm(req) {
  const b = req.body;
  const errors = [];
  const values = {
    title: str(b.title, 140),
    summary: str(b.summary, 280),
    description: str(b.description, 10000),
    topic_id: Number.parseInt(b.topic_id, 10),
    area_id: Number.parseInt(b.area_id, 10),
    data_format: DATA_FORMATS.includes(b.data_format) ? b.data_format : 'csv',
    sample: str(b.sample, 5000),
    currency: CURRENCIES.includes(b.currency) ? b.currency : 'EUR',
    max_sales: b.max_sales ? Number.parseInt(b.max_sales, 10) : null,
    fields: [],
    prices: {},
    data_text: typeof b.data_text === 'string' ? b.data_text : '',
  };

  // Seller-defined schema: name / type / description for each column.
  const names = asArray(b['field_name[]'] ?? b.field_name);
  const types = asArray(b['field_type[]'] ?? b.field_type);
  const descs = asArray(b['field_desc[]'] ?? b.field_desc);
  names.forEach((name, i) => {
    const n = str(name, 60);
    if (!n) return;
    values.fields.push({
      name: n,
      type: FIELD_TYPES.includes(types[i]) ? types[i] : 'string',
      description: str(descs[i], 200),
    });
  });
  if (values.fields.length > 50) errors.push('A listing can describe at most 50 fields.');

  for (const license of Object.keys(LICENSES)) {
    const cents = parsePriceToCents(b[`price_${license}`]);
    if (Number.isNaN(cents)) errors.push(`Invalid price for the ${LICENSES[license].label} license.`);
    else if (cents !== null) values.prices[license] = cents;
  }

  if (values.title.length < 5) errors.push('Title must be at least 5 characters.');
  if (values.summary.length < 10) errors.push('Summary must be at least 10 characters.');
  if (values.max_sales !== null && (!Number.isInteger(values.max_sales) || values.max_sales < 1)) {
    errors.push('Sales limit must be a positive whole number or empty.');
  }
  const { rows: t } = await query('SELECT 1 FROM topics WHERE id = $1', [values.topic_id || 0]);
  if (!t[0]) errors.push('Please choose a topic.');
  const { rows: a } = await query('SELECT 1 FROM areas WHERE id = $1', [values.area_id || 0]);
  if (!a[0]) errors.push('Please choose an area.');

  return { values, errors };
}

function dataFromRequest(req, values) {
  if (req.file && req.file.size > 0) return req.file.buffer;
  if (values.data_text.trim()) return Buffer.from(values.data_text, 'utf8');
  return null;
}

async function renderForm(res, { listing, values, errors, status = 200 }) {
  const taxonomy = await loadTaxonomy();
  res.status(status).render('listing-form', {
    title: listing ? 'Edit listing' : 'New listing',
    listing,
    values,
    errors,
    LICENSES,
    CURRENCIES,
    DATA_FORMATS,
    FIELD_TYPES,
    ...taxonomy,
  });
}

async function loadOwnListing(req) {
  if (!/^\d+$/.test(req.params.id)) return null;
  const { rows } = await query(
    `SELECT l.*, (SELECT COUNT(*)::int FROM orders o WHERE o.listing_id = l.id) AS sales
     FROM listings l WHERE l.id = $1 AND l.seller_id = $2`,
    [req.params.id, req.user.id],
  );
  return rows[0] || null;
}

async function savePrices(client, listingId, prices, currency) {
  await client.query('DELETE FROM listing_prices WHERE listing_id = $1', [listingId]);
  for (const [license, cents] of Object.entries(prices)) {
    await client.query(
      'INSERT INTO listing_prices (listing_id, license, price_cents, currency) VALUES ($1, $2, $3, $4)',
      [listingId, license, cents, currency],
    );
  }
}

/** Encrypts the payload and signs a manifest with the seller's Ed25519 key. */
async function attachData(client, listingId, sellerId, data) {
  const { rows } = await client.query('SELECT private_key_enc FROM users WHERE id = $1', [sellerId]);
  const sha256 = sha256Hex(data);
  const signature = signManifest(manifestFor({ listingId, sellerId, sha256 }), rows[0].private_key_enc);
  await client.query(
    'UPDATE listings SET data_enc = $1, data_sha256 = $2, signature = $3, size_bytes = $4, updated_at = now() WHERE id = $5',
    [encrypt(data), sha256, signature, data.length, listingId],
  );
}

router.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const [listings, purchases, sales] = await Promise.all([
      query(
        `SELECT l.id, l.title, l.status, l.size_bytes, l.updated_at, t.name AS topic_name, a.name AS area_name,
                COUNT(o.id)::int AS sales, COALESCE(SUM(o.price_cents - o.fee_cents), 0)::int AS revenue,
                MIN(o.currency) AS currency
         FROM listings l
         JOIN topics t ON t.id = l.topic_id JOIN areas a ON a.id = l.area_id
         LEFT JOIN orders o ON o.listing_id = l.id AND o.status = 'paid'
         WHERE l.seller_id = $1
         GROUP BY l.id, t.name, a.name ORDER BY l.updated_at DESC`,
        [req.user.id],
      ),
      query(
        `SELECT o.id, o.license, o.price_cents, o.currency, o.created_at, l.id AS listing_id, l.title
         FROM orders o JOIN listings l ON l.id = o.listing_id
         WHERE o.buyer_id = $1 AND o.status = 'paid' ORDER BY o.created_at DESC`,
        [req.user.id],
      ),
      query(
        `SELECT o.id, o.license, o.price_cents, o.fee_cents, o.currency, o.created_at, l.title,
                COALESCE(u.company_name, u.display_name) AS buyer
         FROM orders o JOIN listings l ON l.id = o.listing_id JOIN users u ON u.id = o.buyer_id
         WHERE l.seller_id = $1 AND o.status = 'paid' ORDER BY o.created_at DESC LIMIT 50`,
        [req.user.id],
      ),
    ]);
    res.render('dashboard', {
      title: 'Dashboard',
      listings: listings.rows,
      purchases: purchases.rows,
      sales: sales.rows,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/listings/new', requireAuth, async (req, res, next) => {
  try {
    await renderForm(res, {
      listing: null,
      values: { fields: [], prices: {}, currency: 'EUR', data_format: 'csv' },
      errors: [],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/listings', requireAuth, upload.single('datafile'), verifyCsrf, async (req, res, next) => {
  try {
    const { values, errors } = await parseListingForm(req);
    const data = dataFromRequest(req, values);
    if (!req.body.consent) errors.push('You must confirm you own this data or have consent to sell it.');
    if (errors.length) return renderForm(res, { listing: null, values, errors, status: 400 });

    const id = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO listings (seller_id, title, summary, description, topic_id, area_id, fields, sample, data_format, max_sales)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [req.user.id, values.title, values.summary, values.description, values.topic_id, values.area_id,
          JSON.stringify(values.fields), values.sample, values.data_format, values.max_sales],
      );
      const listingId = rows[0].id;
      await savePrices(client, listingId, values.prices, values.currency);
      if (data) await attachData(client, listingId, req.user.id, data);
      return listingId;
    });
    flash(req, 'success', data
      ? 'Listing saved and data signed. Publish it when you are ready.'
      : 'Listing saved as draft. Upload the data before publishing.');
    res.redirect(`/listings/${id}/edit`);
  } catch (err) {
    next(err);
  }
});

router.get('/listings/:id/edit', requireAuth, async (req, res, next) => {
  try {
    const listing = await loadOwnListing(req);
    if (!listing) return next();
    const { rows: prices } = await query('SELECT license, price_cents, currency FROM listing_prices WHERE listing_id = $1', [listing.id]);
    const values = {
      ...listing,
      prices: Object.fromEntries(prices.map((p) => [p.license, p.price_cents])),
      currency: prices[0] ? prices[0].currency : 'EUR',
    };
    await renderForm(res, { listing, values, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post('/listings/:id', requireAuth, upload.single('datafile'), verifyCsrf, async (req, res, next) => {
  try {
    const listing = await loadOwnListing(req);
    if (!listing) return next();
    const { values, errors } = await parseListingForm(req);
    const data = dataFromRequest(req, values);
    if (data && listing.sales > 0) {
      errors.push('The data of a listing that has already been sold cannot be replaced. Create a new listing for a new version.');
    }
    if (data && !req.body.consent) errors.push('You must confirm you own this data or have consent to sell it.');
    if (listing.status === 'published' && Object.keys(values.prices).length === 0) {
      errors.push('A published listing needs at least one price.');
    }
    if (errors.length) return renderForm(res, { listing, values, errors, status: 400 });

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE listings SET title = $1, summary = $2, description = $3, topic_id = $4, area_id = $5, fields = $6,
                sample = $7, data_format = $8, max_sales = $9, updated_at = now()
         WHERE id = $10`,
        [values.title, values.summary, values.description, values.topic_id, values.area_id,
          JSON.stringify(values.fields), values.sample, values.data_format, values.max_sales, listing.id],
      );
      await savePrices(client, listing.id, values.prices, values.currency);
      if (data) await attachData(client, listing.id, req.user.id, data);
    });
    flash(req, 'success', data ? 'Listing updated and new data signed.' : 'Listing updated.');
    res.redirect(`/listings/${listing.id}/edit`);
  } catch (err) {
    next(err);
  }
});

router.post('/listings/:id/status', requireAuth, async (req, res, next) => {
  try {
    const listing = await loadOwnListing(req);
    if (!listing) return next();
    const action = req.body.action;
    if (action === 'publish') {
      const { rows } = await query('SELECT COUNT(*)::int AS n FROM listing_prices WHERE listing_id = $1', [listing.id]);
      if (!listing.data_enc) {
        flash(req, 'error', 'Upload the data before publishing.');
      } else if (rows[0].n === 0) {
        flash(req, 'error', 'Set at least one license price before publishing.');
      } else if (listing.status === 'sold_out') {
        flash(req, 'error', 'This listing is sold out and cannot be re-published.');
      } else {
        await query("UPDATE listings SET status = 'published', updated_at = now() WHERE id = $1", [listing.id]);
        flash(req, 'success', 'Listing published to the marketplace.');
      }
    } else if (action === 'unpublish' && listing.status === 'published') {
      await query("UPDATE listings SET status = 'draft', updated_at = now() WHERE id = $1", [listing.id]);
      flash(req, 'success', 'Listing moved back to draft.');
    } else if (action === 'archive') {
      await query("UPDATE listings SET status = 'archived', updated_at = now() WHERE id = $1", [listing.id]);
      flash(req, 'success', 'Listing archived. Existing buyers keep access.');
    }
    res.redirect(req.body.back === 'dashboard' ? '/dashboard' : `/listings/${listing.id}/edit`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
