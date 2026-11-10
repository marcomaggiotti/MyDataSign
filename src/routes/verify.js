'use strict';

const express = require('express');
const multer = require('multer');
const config = require('../config');
const { query } = require('../db');
const { verifyCsrf } = require('../middleware');
const { sha256Hex, manifestFor, verifyManifest, keyFingerprint } = require('../crypto');

const router = express.Router();
// Bundles are base64 so they are ~4/3 the data size.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.ceil(config.maxUploadBytes * 1.5), files: 1 } });

/** Checks a downloaded bundle: data hash, Ed25519 signature, and that the key is the seller's key on file. */
async function verifyBundle(bundle) {
  const checks = [];
  const add = (label, ok, detail) => checks.push({ label, ok, detail });

  if (!bundle || bundle.format !== 'mydatasign-bundle/v1') {
    add('Bundle format', false, 'Not a MyDataSign v1 bundle.');
    return { valid: false, checks };
  }
  const data = Buffer.from(String(bundle.data_base64 || ''), 'base64');
  const sha = sha256Hex(data);
  add('Data integrity (SHA-256)', sha === bundle.sha256, sha);

  const listingId = bundle.listing && bundle.listing.id;
  const sellerId = bundle.seller && bundle.seller.id;
  const manifest = manifestFor({ listingId, sellerId, sha256: sha });
  add('Manifest matches listing & seller', manifest === bundle.manifest, manifest);

  const publicKey = bundle.seller && bundle.seller.public_key;
  add('Seller signature (Ed25519)', Boolean(publicKey) && verifyManifest(manifest, String(bundle.signature || ''), publicKey),
    publicKey ? `Key ${keyFingerprint(publicKey)}` : 'No public key in bundle');

  const { rows } = await query('SELECT public_key FROM users WHERE id = $1', [Number.parseInt(sellerId, 10) || 0]);
  add('Key registered to this seller on MyDataSign', Boolean(rows[0]) && rows[0].public_key === publicKey,
    rows[0] ? `Registered key ${keyFingerprint(rows[0].public_key)}` : 'Seller not found');

  return { valid: checks.every((c) => c.ok), checks };
}

router.get('/verify', (req, res) => {
  res.render('verify', { title: 'Verify a data package', result: null, error: null });
});

router.post('/verify', upload.single('bundle'), verifyCsrf, async (req, res, next) => {
  try {
    let bundle;
    try {
      const text = req.file ? req.file.buffer.toString('utf8') : String(req.body.bundle_text || '');
      bundle = JSON.parse(text);
    } catch {
      return res.status(400).render('verify', { title: 'Verify a data package', result: null, error: 'The file is not valid JSON.' });
    }
    const result = await verifyBundle(bundle);
    res.render('verify', { title: 'Verify a data package', result, error: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.verifyBundle = verifyBundle;
