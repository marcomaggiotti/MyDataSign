'use strict';

const express = require('express');
const config = require('../config');
const { query, withTransaction } = require('../db');
const { decrypt, manifestFor, keyFingerprint } = require('../crypto');
const { requireAuth, flash } = require('../middleware');
const { LICENSES } = require('../helpers');

const router = express.Router();

class PurchaseError extends Error {}

/**
 * Demo checkout: records a paid order without charging a card. Swap the body of
 * this handler for a Stripe Checkout session + webhook to take real payments.
 */
router.post('/listings/:id/buy', requireAuth, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  const license = String(req.body.license || '');
  if (!LICENSES[license]) {
    flash(req, 'error', 'Please choose a license.');
    return res.redirect(`/listings/${req.params.id}`);
  }
  try {
    const orderId = await withTransaction(async (client) => {
      // Lock the listing row so sales limits and exclusivity are enforced under concurrency.
      const { rows } = await client.query('SELECT * FROM listings WHERE id = $1 FOR UPDATE', [req.params.id]);
      const listing = rows[0];
      if (!listing || listing.status !== 'published') throw new PurchaseError('This listing is not available for purchase.');
      if (listing.seller_id === req.user.id) throw new PurchaseError('You cannot buy your own listing.');

      const existing = await client.query(
        "SELECT id FROM orders WHERE listing_id = $1 AND buyer_id = $2 AND license = $3 AND status = 'paid'",
        [listing.id, req.user.id, license],
      );
      if (existing.rows[0]) return existing.rows[0].id;

      const { rows: priceRows } = await client.query(
        'SELECT price_cents, currency FROM listing_prices WHERE listing_id = $1 AND license = $2',
        [listing.id, license],
      );
      if (!priceRows[0]) throw new PurchaseError('This license is not offered for this listing.');

      const { rows: countRows } = await client.query(
        "SELECT COUNT(*)::int AS n FROM orders WHERE listing_id = $1 AND status = 'paid'",
        [listing.id],
      );
      const sold = countRows[0].n;
      if (license === 'exclusive' && sold > 0) throw new PurchaseError('Exclusive rights are only available before the first sale.');
      if (listing.max_sales && sold >= listing.max_sales) throw new PurchaseError('This listing has reached its sales limit.');

      const { price_cents: price, currency } = priceRows[0];
      const fee = Math.round((price * config.platformFeePercent) / 100);
      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (buyer_id, listing_id, license, price_cents, fee_cents, currency, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'paid') RETURNING id`,
        [req.user.id, listing.id, license, price, fee, currency],
      );
      if (license === 'exclusive' || (listing.max_sales && sold + 1 >= listing.max_sales)) {
        await client.query("UPDATE listings SET status = 'sold_out', updated_at = now() WHERE id = $1", [listing.id]);
      }
      return orderRows[0].id;
    });
    flash(req, 'success', 'Purchase complete. Your signed data package is ready to download.');
    res.redirect(`/orders/${orderId}`);
  } catch (err) {
    if (err instanceof PurchaseError) {
      flash(req, 'error', err.message);
      return res.redirect(`/listings/${req.params.id}`);
    }
    next(err);
  }
});

async function loadOrder(req) {
  if (!/^\d+$/.test(req.params.id)) return null;
  const { rows } = await query(
    `SELECT o.*, l.title, l.data_enc, l.data_sha256, l.signature, l.data_format, l.size_bytes, l.fields, l.seller_id,
            t.name AS topic_name, a.name AS area_name,
            u.display_name AS seller_name, u.company_name AS seller_company, u.public_key
     FROM orders o
     JOIN listings l ON l.id = o.listing_id
     JOIN topics t ON t.id = l.topic_id
     JOIN areas a ON a.id = l.area_id
     JOIN users u ON u.id = l.seller_id
     WHERE o.id = $1 AND o.buyer_id = $2 AND o.status = 'paid'`,
    [req.params.id, req.user.id],
  );
  return rows[0] || null;
}

router.get('/orders/:id', requireAuth, async (req, res, next) => {
  try {
    const order = await loadOrder(req);
    if (!order) return next();
    const { rows: downloads } = await query(
      'SELECT created_at FROM download_log WHERE order_id = $1 ORDER BY created_at DESC LIMIT 10',
      [order.id],
    );
    res.render('order', { title: `Order #${order.id}`, order, downloads, fingerprint: keyFingerprint(order.public_key) });
  } catch (err) {
    next(err);
  }
});

/**
 * Downloads are decrypted on the fly for the buyer only and every access is
 * logged. ?format=raw returns the plain file; the default is a signed bundle
 * that anyone can check on /verify.
 */
router.get('/orders/:id/download', requireAuth, async (req, res, next) => {
  try {
    const order = await loadOrder(req);
    if (!order) return next();
    const data = decrypt(order.data_enc);
    await query('INSERT INTO download_log (order_id, user_id, ip) VALUES ($1, $2, $3)', [order.id, req.user.id, req.ip]);

    res.set('Cache-Control', 'no-store');
    const base = `mydatasign-listing-${order.listing_id}`;
    if (req.query.format === 'raw') {
      res.attachment(`${base}.${order.data_format}`);
      return res.type('application/octet-stream').send(data);
    }
    const bundle = {
      format: 'mydatasign-bundle/v1',
      order: { id: order.id, license: order.license, purchased_at: order.created_at },
      listing: { id: order.listing_id, title: order.title, topic: order.topic_name, area: order.area_name, fields: order.fields },
      seller: {
        id: order.seller_id,
        name: order.seller_company || order.seller_name,
        public_key: order.public_key,
        fingerprint: keyFingerprint(order.public_key),
      },
      manifest: manifestFor({ listingId: order.listing_id, sellerId: order.seller_id, sha256: order.data_sha256 }),
      sha256: order.data_sha256,
      signature: order.signature,
      data_format: order.data_format,
      data_base64: data.toString('base64'),
    };
    res.attachment(`${base}.signed.json`);
    res.json(bundle);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
