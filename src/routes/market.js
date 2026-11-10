'use strict';

const express = require('express');
const { query } = require('../db');
const { keyFingerprint } = require('../crypto');
const { parsePriceToCents } = require('../helpers');

const router = express.Router();
const PAGE_SIZE = 24;

async function loadTaxonomy() {
  const [topics, areas] = await Promise.all([
    query('SELECT id, slug, name FROM topics ORDER BY name'),
    query("SELECT id, slug, name, kind FROM areas ORDER BY CASE kind WHEN 'global' THEN 0 WHEN 'region' THEN 1 ELSE 2 END, name"),
  ]);
  return { topics: topics.rows, areas: areas.rows };
}

// Shared SELECT for listing cards: includes the lowest offered price.
const CARD_SELECT = `
  SELECT l.id, l.title, l.summary, l.status, l.data_format, l.size_bytes, l.created_at,
         t.name AS topic_name, t.slug AS topic_slug, a.name AS area_name, a.slug AS area_slug,
         u.id AS seller_id, u.display_name, u.account_type, u.company_name,
         p.min_price, p.currency
  FROM listings l
  JOIN topics t ON t.id = l.topic_id
  JOIN areas a ON a.id = l.area_id
  JOIN users u ON u.id = l.seller_id
  LEFT JOIN LATERAL (
    SELECT MIN(price_cents) AS min_price, MIN(currency) AS currency
    FROM listing_prices lp WHERE lp.listing_id = l.id
  ) p ON true`;

router.get('/', async (req, res, next) => {
  try {
    const filters = {
      q: String(req.query.q || '').trim().slice(0, 100),
      topic: String(req.query.topic || ''),
      area: String(req.query.area || ''),
      seller: ['individual', 'company'].includes(req.query.seller) ? req.query.seller : '',
      max_price: String(req.query.max_price || ''),
      sort: ['newest', 'price_asc', 'price_desc'].includes(req.query.sort) ? req.query.sort : 'newest',
    };
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);

    const where = ["l.status = 'published'"];
    const params = [];
    const param = (value) => { params.push(value); return `$${params.length}`; };

    if (filters.q) {
      const p = param(`%${filters.q}%`);
      where.push(`(l.title ILIKE ${p} OR l.summary ILIKE ${p})`);
    }
    if (filters.topic) where.push(`t.slug = ${param(filters.topic)}`);
    if (filters.area) where.push(`a.slug = ${param(filters.area)}`);
    if (filters.seller) where.push(`u.account_type = ${param(filters.seller)}`);
    const maxCents = parsePriceToCents(filters.max_price);
    if (Number.isInteger(maxCents)) where.push(`p.min_price <= ${param(maxCents)}`);

    const order = {
      newest: 'l.created_at DESC',
      price_asc: 'p.min_price ASC NULLS LAST, l.created_at DESC',
      price_desc: 'p.min_price DESC NULLS LAST, l.created_at DESC',
    }[filters.sort];

    const sql = `${CARD_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}
                 LIMIT ${param(PAGE_SIZE + 1)} OFFSET ${param((page - 1) * PAGE_SIZE)}`;

    const [{ rows }, taxonomy, stats] = await Promise.all([
      query(sql, params),
      loadTaxonomy(),
      query(`SELECT t.slug, COUNT(l.id)::int AS n FROM topics t
             LEFT JOIN listings l ON l.topic_id = t.id AND l.status = 'published'
             GROUP BY t.slug`),
    ]);
    const topicCounts = Object.fromEntries(stats.rows.map((r) => [r.slug, r.n]));

    res.render('index', {
      title: 'Browse data',
      listings: rows.slice(0, PAGE_SIZE),
      hasMore: rows.length > PAGE_SIZE,
      page,
      filters,
      topicCounts,
      ...taxonomy,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/listings/:id', async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  try {
    const { rows } = await query(
      `SELECT l.*, t.name AS topic_name, t.slug AS topic_slug, a.name AS area_name, a.slug AS area_slug,
              u.display_name, u.account_type, u.company_name, u.public_key,
              (SELECT COUNT(*)::int FROM orders o WHERE o.listing_id = l.id AND o.status = 'paid') AS sales
       FROM listings l
       JOIN topics t ON t.id = l.topic_id
       JOIN areas a ON a.id = l.area_id
       JOIN users u ON u.id = l.seller_id
       WHERE l.id = $1`,
      [req.params.id],
    );
    const listing = rows[0];
    const isOwner = Boolean(listing && req.user && req.user.id === listing.seller_id);
    if (!listing || (listing.status === 'draft' && !isOwner)) {
      return res.status(404).render('error', { title: 'Not found', message: 'This listing does not exist or is not public.' });
    }
    const prices = await query(
      "SELECT license, price_cents, currency FROM listing_prices WHERE listing_id = $1 ORDER BY array_position(ARRAY['personal','commercial','exclusive'], license)",
      [listing.id],
    );
    let myOrders = [];
    if (req.user) {
      myOrders = (await query(
        "SELECT id, license FROM orders WHERE listing_id = $1 AND buyer_id = $2 AND status = 'paid'",
        [listing.id, req.user.id],
      )).rows;
    }
    res.render('listing', {
      title: listing.title,
      listing,
      prices: prices.rows,
      myOrders,
      isOwner,
      fingerprint: keyFingerprint(listing.public_key),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/sellers/:id', async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  try {
    const { rows } = await query(
      'SELECT id, display_name, account_type, company_name, vat_id, public_key, created_at FROM users WHERE id = $1',
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).render('error', { title: 'Not found', message: 'Seller not found.' });
    const listings = await query(`${CARD_SELECT} WHERE l.seller_id = $1 AND l.status = 'published' ORDER BY l.created_at DESC`, [rows[0].id]);
    res.render('seller', {
      title: rows[0].company_name || rows[0].display_name,
      seller: rows[0],
      listings: listings.rows,
      fingerprint: keyFingerprint(rows[0].public_key),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.loadTaxonomy = loadTaxonomy;
