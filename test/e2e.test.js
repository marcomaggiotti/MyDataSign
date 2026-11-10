'use strict';

// End-to-end flow against a real Postgres database.
// Run with: TEST_DATABASE_URL=postgres://... npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const dbUrl = process.env.TEST_DATABASE_URL;
if (dbUrl) process.env.DATABASE_URL = dbUrl;

const skip = dbUrl ? false : 'TEST_DATABASE_URL not set';

let server;
let base;

/** Tiny browser: keeps cookies and extracts the CSRF token from pages. */
function agent() {
  let cookie = '';
  async function req(path, opts = {}) {
    const res = await fetch(base + path, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie } });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    return res;
  }
  async function csrf(path = '/') {
    const html = await (await req(path)).text();
    return html.match(/name="_csrf" value="([^"]+)"/)[1];
  }
  async function form(path, fields, from = '/') {
    const body = new URLSearchParams({ _csrf: await csrf(from), ...fields });
    return req(path, { method: 'POST', body });
  }
  return { req, csrf, form };
}

before(async () => {
  if (skip) return;
  const { pool } = require('../src/db');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await require('../src/migrate').migrate();
  const app = require('../src/server').createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (skip) return;
  server.close();
  await require('../src/db').pool.end();
});

test('seller lists signed data, buyer purchases, downloads and verifies it', { skip }, async () => {
  const { query } = require('../src/db');
  const seller = agent();
  const buyer = agent();

  let res = await seller.form('/register', {
    account_type: 'company', display_name: 'Ada', company_name: 'Acme Data SA', vat_id: 'CHE-123',
    email: 'seller@example.com', password: 'correct horse battery', terms: '1',
  }, '/register');
  assert.equal(res.status, 302);

  // Create a listing with a schema, three prices and pasted data.
  const topic = (await query("SELECT id FROM topics WHERE slug = 'energy'")).rows[0].id;
  const area = (await query("SELECT id FROM areas WHERE slug = 'ch'")).rows[0].id;
  const fd = new FormData();
  fd.append('_csrf', await seller.csrf('/listings/new'));
  Object.entries({
    title: 'Hourly household energy use', summary: 'Smart-meter readings from 200 Swiss homes',
    topic_id: String(topic), area_id: String(area), data_format: 'csv', currency: 'CHF',
    price_personal: '19.90', price_commercial: '149', price_exclusive: '', consent: '1',
  }).forEach(([k, v]) => fd.append(k, v));
  fd.append('field_name[]', 'timestamp'); fd.append('field_type[]', 'datetime'); fd.append('field_desc[]', 'UTC hour');
  fd.append('field_name[]', 'kwh'); fd.append('field_type[]', 'number'); fd.append('field_desc[]', 'Consumption');
  const csv = 'timestamp,kwh\n2025-01-01T00:00Z,0.42\n';
  fd.append('datafile', new Blob([csv], { type: 'text/csv' }), 'energy.csv');
  res = await seller.req('/listings', { method: 'POST', body: fd });
  assert.equal(res.status, 302, await res.text());
  const listingId = res.headers.get('location').match(/\/listings\/(\d+)\/edit/)[1];

  // Data is stored encrypted, never in plaintext.
  const stored = (await query('SELECT data_enc, fields FROM listings WHERE id = $1', [listingId])).rows[0];
  assert.ok(stored.data_enc.startsWith('v1.'));
  assert.ok(!stored.data_enc.includes('kwh'));
  assert.equal(stored.fields.length, 2);

  // Drafts are hidden from the public.
  assert.equal((await buyer.req(`/listings/${listingId}`)).status, 404);

  res = await seller.form(`/listings/${listingId}/status`, { action: 'publish' }, `/listings/${listingId}/edit`);
  assert.equal(res.status, 302);

  // Browse by topic + area finds it.
  const html = await (await buyer.req('/?topic=energy&area=ch')).text();
  assert.match(html, /Hourly household energy use/);
  assert.match(html, /CHF\s?19\.90/);

  // Buyer purchases the commercial license.
  await buyer.form('/register', {
    account_type: 'individual', display_name: 'Bob', email: 'buyer@example.com', password: 'another long pass', terms: '1',
  }, '/register');
  res = await buyer.form(`/listings/${listingId}/buy`, { license: 'commercial' }, `/listings/${listingId}`);
  assert.equal(res.status, 302);
  const orderPath = res.headers.get('location');
  assert.match(orderPath, /^\/orders\/\d+$/);

  // The seller cannot download the buyer's order.
  assert.equal((await seller.req(`${orderPath}/download`)).status, 404);

  const raw = await (await buyer.req(`${orderPath}/download?format=raw`)).text();
  assert.equal(raw, csv);

  const bundle = await (await buyer.req(`${orderPath}/download`)).json();
  const { verifyBundle } = require('../src/routes/verify');
  assert.equal((await verifyBundle(bundle)).valid, true);

  // Tampering with the data breaks verification.
  const tampered = { ...bundle, data_base64: Buffer.from(csv.replace('0.42', '0.01')).toString('base64') };
  assert.equal((await verifyBundle(tampered)).valid, false);

  // Data cannot be swapped once sold.
  const fd2 = new FormData();
  fd2.append('_csrf', await seller.csrf(`/listings/${listingId}/edit`));
  Object.entries({
    title: 'Hourly household energy use', summary: 'Smart-meter readings from 200 Swiss homes',
    topic_id: String(topic), area_id: String(area), data_format: 'csv', currency: 'CHF',
    price_personal: '19.90', data_text: 'other', consent: '1',
  }).forEach(([k, v]) => fd2.append(k, v));
  res = await seller.req(`/listings/${listingId}`, { method: 'POST', body: fd2 });
  assert.equal(res.status, 400);

  // Missing CSRF token is rejected.
  res = await buyer.req(`/listings/${listingId}/buy`, { method: 'POST', body: new URLSearchParams({ license: 'personal' }) });
  assert.equal(res.status, 403);
});
