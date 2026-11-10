'use strict';

/**
 * Builds a static, read-only demo of MyDataSign into ./demo-dist.
 * It needs no database and no secret keys: every page is rendered from the
 * real EJS templates with sample data, and links are rewritten to flat .html
 * files so the demo works on any static host (Render static site, artifact, file://).
 *
 *   npm run build:demo
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ejs = require('ejs');

const helpers = require('../src/helpers');
const { TOPICS, AREAS } = require('../src/migrate');
const { sha256Hex, manifestFor, keyFingerprint } = require('../src/crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'demo-dist');
const VIEWS = path.join(ROOT, 'views');

// ---------------------------------------------------------------- sample data

const topics = TOPICS.map(([slug, name], i) => ({ id: i + 1, slug, name }));
const areas = AREAS.map(([slug, name, kind], i) => ({ id: i + 1, slug, name, kind }));
const topic = (slug) => topics.find((t) => t.slug === slug);
const area = (slug) => areas.find((a) => a.slug === slug);

// Demo-only signing keys, generated fresh at build time and never stored.
function makeSeller(id, fields) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { id, vat_id: null, company_name: null, created_at: new Date('2025-03-01'), ...fields, public_key: publicKey, privateKey };
}

const sellers = [
  makeSeller(1, { display_name: 'Alex Demo', account_type: 'individual', email: 'alex@demo.local', created_at: new Date('2025-06-12') }),
  makeSeller(2, { display_name: 'Marta', account_type: 'company', company_name: 'Helvetia Grid Analytics SA', vat_id: 'CHE-482.913.006', created_at: new Date('2025-02-03') }),
  makeSeller(3, { display_name: 'Luca', account_type: 'company', company_name: 'UrbanFlow Mobility S.r.l.', vat_id: 'IT 09876543210', created_at: new Date('2025-04-20') }),
  makeSeller(4, { display_name: 'Priya R.', account_type: 'individual', created_at: new Date('2025-08-30') }),
  makeSeller(5, { display_name: 'Jonas', account_type: 'company', company_name: 'Feldwerk Agrar GmbH', vat_id: 'DE 312 456 789', created_at: new Date('2025-01-15') }),
];
const demoUser = sellers[0];

function csv(header, rows) {
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
}

function randomRows(n, fn) {
  return Array.from({ length: n }, (_, i) => fn(i));
}

const listingSpecs = [
  {
    seller: 1, topic: 'health-fitness', area: 'ch', created: '2025-10-28',
    title: 'Daily step counts & sleep, 2024–2025',
    summary: 'Two years of my own wearable data: steps, sleep duration and resting heart rate per day.',
    description: 'Exported from my fitness watch and cleaned by hand. One row per day, no gaps longer than 3 days.\n\nNo location data and no identifiers beyond the date.',
    fields: [['date', 'date', 'Calendar day (Europe/Zurich)'], ['steps', 'integer', 'Total steps'], ['sleep_min', 'integer', 'Minutes asleep'], ['rhr', 'integer', 'Resting heart rate (bpm)']],
    prices: { personal: 900, commercial: 4900 }, currency: 'CHF', sales: 7,
    data: () => csv(['date', 'steps', 'sleep_min', 'rhr'], randomRows(730, (i) => [new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), 4000 + ((i * 7919) % 9000), 360 + ((i * 31) % 120), 52 + ((i * 13) % 9)])),
  },
  {
    seller: 1, topic: 'technology-usage', area: 'europe', created: '2025-11-02', status: 'draft',
    title: 'Smartphone screen-time by app category',
    summary: 'Hourly screen-time per app category from my phone over six months.',
    fields: [['hour', 'datetime', 'Start of the hour, UTC'], ['category', 'category', 'Social, Video, Work, Games…'], ['minutes', 'integer', 'Minutes in the foreground']],
    prices: { personal: 500 }, currency: 'EUR', sales: 0,
    data: () => csv(['hour', 'category', 'minutes'], randomRows(400, (i) => [new Date(Date.UTC(2025, 4, 1, i)).toISOString(), ['social', 'video', 'work', 'games'][i % 4], (i * 17) % 60])),
  },
  {
    seller: 2, topic: 'energy', area: 'ch', created: '2025-10-15',
    title: 'Hourly household electricity use — 200 Swiss homes',
    summary: 'Anonymised smart-meter readings at hourly resolution, with home size and heating type.',
    description: 'Collected with written consent from participating households in Vaud and Zurich. Home identifiers are random and cannot be linked to addresses.\n\nUpdated quarterly; this package covers Jan 2024 – Jun 2025.',
    fields: [['home_id', 'string', 'Random identifier'], ['timestamp', 'datetime', 'UTC hour'], ['kwh', 'number', 'Consumption in the hour'], ['heating', 'category', 'heat_pump | gas | oil | district'], ['m2', 'integer', 'Living area']],
    prices: { personal: 4900, commercial: 39000, exclusive: 250000 }, currency: 'CHF', sales: 0,
    data: () => csv(['home_id', 'timestamp', 'kwh', 'heating', 'm2'], randomRows(1200, (i) => [`h${(i % 200).toString().padStart(3, '0')}`, new Date(Date.UTC(2024, 0, 1, Math.floor(i / 200))).toISOString(), (0.2 + ((i * 37) % 180) / 100).toFixed(2), ['heat_pump', 'gas', 'oil', 'district'][i % 4], 60 + (i % 140)])),
  },
  {
    seller: 2, topic: 'environment-climate', area: 'europe', created: '2025-09-01',
    title: 'Rooftop solar yield vs. weather, 1,400 installations',
    summary: 'Daily PV production joined with irradiance, temperature and cloud cover.',
    fields: [['site_id', 'string', 'Random identifier'], ['date', 'date', 'Day'], ['kwh_per_kwp', 'number', 'Specific yield'], ['ghi', 'number', 'Global horizontal irradiance (kWh/m²)'], ['cloud_pct', 'integer', 'Mean cloud cover']],
    prices: { commercial: 89000 }, currency: 'EUR', sales: 3, max_sales: 10,
    data: () => csv(['site_id', 'date', 'kwh_per_kwp', 'ghi', 'cloud_pct'], randomRows(800, (i) => [`s${i % 1400}`, new Date(Date.UTC(2025, 0, 1 + (i % 180))).toISOString().slice(0, 10), (1 + (i % 50) / 10).toFixed(1), (0.5 + (i % 70) / 10).toFixed(1), (i * 7) % 100])),
  },
  {
    seller: 3, topic: 'mobility-location', area: 'it', created: '2025-10-30',
    title: 'E-scooter trips in Milan — origin/destination grid',
    summary: '1.2M trips aggregated to a 250 m grid with duration, distance and time of day.',
    description: 'No individual trajectories: trips are aggregated to grid cells with a minimum of 10 trips per cell and hour (k-anonymity).',
    fields: [['origin_cell', 'geo', 'H3 cell, resolution 9'], ['dest_cell', 'geo', 'H3 cell, resolution 9'], ['hour', 'integer', 'Hour of day 0–23'], ['trips', 'integer', 'Trip count'], ['median_min', 'number', 'Median duration']],
    prices: { personal: 2900, commercial: 59000 }, currency: 'EUR', sales: 12,
    data: () => csv(['origin_cell', 'dest_cell', 'hour', 'trips', 'median_min'], randomRows(600, (i) => [`891f1d48${(i * 7).toString(16).padStart(3, '0')}ffff`, `891f1d48${(i * 11).toString(16).padStart(3, '0')}ffff`, i % 24, 10 + (i % 90), (4 + (i % 20) / 2).toFixed(1)])),
  },
  {
    seller: 3, topic: 'real-estate', area: 'europe', created: '2025-08-18',
    title: 'Parking occupancy near transit hubs, 14 EU cities',
    summary: '15-minute occupancy rates for 3,100 on-street parking zones.',
    fields: [['city', 'category', 'City name'], ['zone_id', 'string', 'Operator zone'], ['ts', 'datetime', '15-min slot, UTC'], ['occupancy', 'number', '0–1']],
    prices: { commercial: 120000 }, currency: 'EUR', sales: 2,
    data: () => csv(['city', 'zone_id', 'ts', 'occupancy'], randomRows(500, (i) => [['Milan', 'Lyon', 'Munich', 'Madrid'][i % 4], `z${i}`, new Date(Date.UTC(2025, 5, 1, 0, 15 * i)).toISOString(), ((i * 13) % 100 / 100).toFixed(2)])),
  },
  {
    seller: 4, topic: 'finance', area: 'gb', created: '2025-11-05',
    title: 'Personal grocery & household spending, 3 years',
    summary: 'Every card transaction I made at supermarkets and pharmacies, categorised.',
    description: 'Merchant names generalised to chain level. Amounts in GBP. Great for inflation and basket studies.',
    fields: [['date', 'date', 'Transaction date'], ['merchant_chain', 'category', 'Chain, not branch'], ['category', 'category', 'groceries | household | pharmacy'], ['amount', 'number', 'GBP']],
    prices: { personal: 1500, commercial: 9900 }, currency: 'GBP', sales: 4,
    data: () => csv(['date', 'merchant_chain', 'category', 'amount'], randomRows(900, (i) => [new Date(Date.UTC(2022, 9, 1 + Math.floor(i * 1.2))).toISOString().slice(0, 10), ['Tesco', 'Sainsbury\'s', 'Boots', 'Aldi'][i % 4], ['groceries', 'household', 'pharmacy'][i % 3], (3 + ((i * 97) % 9000) / 100).toFixed(2)])),
  },
  {
    seller: 4, topic: 'media-entertainment', area: 'global', created: '2025-07-22',
    title: 'Ten years of my music listening history',
    summary: 'Every track I streamed since 2015 with genre, skip flag and time of day.',
    fields: [['played_at', 'datetime', 'UTC'], ['artist', 'string', 'Artist name'], ['genre', 'category', 'Primary genre'], ['skipped', 'boolean', 'Skipped before 30s']],
    prices: { personal: 400, commercial: 2900 }, currency: 'USD', sales: 9,
    data: () => csv(['played_at', 'artist', 'genre', 'skipped'], randomRows(700, (i) => [new Date(Date.UTC(2015, 0, 1, i * 7)).toISOString(), ['Aurora Lane', 'The Static', 'Nadia K', 'Low Tide'][i % 4], ['indie', 'electronic', 'jazz', 'pop'][i % 4], i % 5 === 0])),
  },
  {
    seller: 5, topic: 'agriculture', area: 'de', created: '2025-09-25',
    title: 'Soil moisture & yield per field, 2019–2025',
    summary: 'Sensor readings from 86 fields in Lower Saxony with harvest yields per crop.',
    description: 'Capacitive soil sensors at 20 cm and 60 cm depth, aggregated daily. Yield from combine harvester logs.',
    fields: [['field_id', 'string', 'Random identifier'], ['date', 'date', 'Day'], ['moisture_20cm', 'number', 'Volumetric %'], ['moisture_60cm', 'number', 'Volumetric %'], ['crop', 'category', 'wheat | barley | rapeseed | maize']],
    prices: { personal: 1900, commercial: 49000, exclusive: 300000 }, currency: 'EUR', sales: 0,
    data: () => csv(['field_id', 'date', 'moisture_20cm', 'moisture_60cm', 'crop'], randomRows(900, (i) => [`f${i % 86}`, new Date(Date.UTC(2019, 2, 1 + (i % 2000))).toISOString().slice(0, 10), (15 + (i % 25)).toFixed(1), (20 + (i % 18)).toFixed(1), ['wheat', 'barley', 'rapeseed', 'maize'][i % 4]])),
  },
  {
    seller: 5, topic: 'industrial-iot', area: 'europe', created: '2025-06-10',
    title: 'Tractor engine telemetry — predictive maintenance set',
    summary: 'CAN-bus telemetry from 40 tractors with labelled failure events.',
    fields: [['unit_id', 'string', 'Tractor'], ['ts', 'datetime', 'UTC, 1 min'], ['rpm', 'integer', 'Engine RPM'], ['coolant_c', 'number', 'Coolant °C'], ['failure_within_7d', 'boolean', 'Label']],
    prices: { commercial: 75000 }, currency: 'EUR', sales: 1,
    data: () => csv(['unit_id', 'ts', 'rpm', 'coolant_c', 'failure_within_7d'], randomRows(800, (i) => [`t${i % 40}`, new Date(Date.UTC(2024, 3, 1, 0, i)).toISOString(), 800 + (i * 37) % 1500, (70 + (i % 30)).toFixed(1), i % 97 === 0])),
  },
  {
    seller: 2, topic: 'demographics', area: 'ch', created: '2025-05-02',
    title: 'Commuter survey: how Swiss employees get to work',
    summary: '4,800 survey responses on mode of transport, distance and remote-work days.',
    fields: [['canton', 'category', 'Canton of residence'], ['mode', 'category', 'train | car | bike | walk | mixed'], ['km', 'number', 'One-way distance'], ['remote_days', 'integer', 'Remote days per week']],
    prices: { personal: 0, commercial: 19000 }, currency: 'CHF', sales: 31,
    data: () => csv(['canton', 'mode', 'km', 'remote_days'], randomRows(500, (i) => [['ZH', 'BE', 'VD', 'GE', 'TI'][i % 5], ['train', 'car', 'bike', 'walk', 'mixed'][i % 5], (1 + (i * 7) % 60).toFixed(1), i % 4])),
  },
  {
    seller: 3, topic: 'retail-consumer', area: 'latin-america', created: '2025-10-08',
    title: 'Footfall in shopping centres — São Paulo & Rio',
    summary: 'Hourly visitor counts from Wi-Fi probes in 22 malls, de-duplicated.',
    fields: [['mall_id', 'string', 'Random identifier'], ['city', 'category', 'São Paulo | Rio de Janeiro'], ['hour', 'datetime', 'Local time'], ['visitors', 'integer', 'Unique devices']],
    prices: { commercial: 45000 }, currency: 'USD', sales: 0,
    data: () => csv(['mall_id', 'city', 'hour', 'visitors'], randomRows(500, (i) => [`m${i % 22}`, i % 2 ? 'São Paulo' : 'Rio de Janeiro', new Date(Date.UTC(2025, 6, 1, i)).toISOString(), 200 + (i * 53) % 3000])),
  },
];

const listings = listingSpecs.map((s, i) => {
  const id = i + 1;
  const seller = sellers.find((u) => u.id === s.seller);
  const data = Buffer.from(s.data(), 'utf8');
  const sha256 = sha256Hex(data);
  const manifest = manifestFor({ listingId: id, sellerId: seller.id, sha256 });
  const signature = crypto.sign(null, Buffer.from(manifest), seller.privateKey).toString('base64');
  const t = topic(s.topic);
  const a = area(s.area);
  const text = data.toString('utf8');
  const prices = Object.entries(s.prices).map(([license, price_cents]) => ({ license, price_cents, currency: s.currency }));
  return {
    id,
    seller_id: seller.id,
    title: s.title,
    summary: s.summary,
    description: s.description || '',
    topic_id: t.id, topic_name: t.name, topic_slug: t.slug,
    area_id: a.id, area_name: a.name, area_slug: a.slug,
    fields: s.fields.map(([name, type, description]) => ({ name, type, description })),
    sample: text.split('\n').slice(0, 6).join('\n'),
    data_format: 'csv',
    data, data_sha256: sha256, signature, manifest,
    data_enc: 'demo',
    size_bytes: data.length,
    max_sales: s.max_sales || null,
    status: s.status || 'published',
    sales: s.sales,
    created_at: new Date(s.created), updated_at: new Date(s.created),
    prices,
    min_price: Math.min(...prices.map((p) => p.price_cents)),
    currency: s.currency,
    // seller columns used by templates
    display_name: seller.display_name, account_type: seller.account_type,
    company_name: seller.company_name, public_key: seller.public_key,
  };
});

// The demo user has bought two listings.
const purchases = [
  { listingId: 5, license: 'personal', date: '2025-11-03' },
  { listingId: 8, license: 'commercial', date: '2025-10-11' },
];

// ---------------------------------------------------------------- rendering

const LICENSE_ORDER = ['personal', 'commercial', 'exclusive'];

/** Maps an app URL to its file in the static demo. */
function toStatic(url) {
  if (!url.startsWith('/') || url.startsWith('//')) return url;
  const [p, qs] = url.split('?');
  const q = qs ? `?${qs}` : '';
  const rules = [
    [/^\/$/, () => `index.html${q}`],
    [/^\/(styles\.css|app\.js)$/, (m) => m[1]],
    [/^\/verify$/, () => 'verify.html'],
    [/^\/(login|register|dashboard)$/, (m) => `${m[1]}.html`],
    [/^\/logout$/, () => 'index.html'],
    [/^\/listings\/new$/, () => 'listing-new.html'],
    [/^\/listings$/, () => 'dashboard.html'],
    [/^\/listings\/(\d+)$/, (m) => `listing-${m[1]}.html`],
    [/^\/listings\/(\d+)\/(edit|status)$/, (m) => `listing-${m[1]}-edit.html`],
    [/^\/listings\/(\d+)\/buy$/, (m) => `order-${m[1]}.html`],
    [/^\/sellers\/(\d+)$/, (m) => `seller-${m[1]}.html`],
    [/^\/orders\/(\d+)$/, (m) => `order-${m[1]}.html`],
    [/^\/orders\/(\d+)\/download$/, (m) => (/format=raw/.test(q) ? `data-${m[1]}.csv` : `bundle-${m[1]}.signed.json`)],
  ];
  for (const [re, fn] of rules) {
    const m = p.match(re);
    if (m) return fn(m);
  }
  return url;
}

function rewriteLinks(html) {
  return html.replace(/(href|action|src)="([^"]*)"/g, (all, attr, url) => `${attr}="${toStatic(url.replace(/&amp;/g, '&')).replace(/&/g, '&amp;')}"`);
}

const files = [];
async function page(file, view, locals) {
  const html = await ejs.renderFile(path.join(VIEWS, `${view}.ejs`), {
    appName: 'MyDataSign',
    h: helpers,
    maxUploadBytes: 5 * 1024 * 1024,
    demo: true,
    currentUser: demoUser,
    csrfToken: 'demo',
    flash: null,
    path: '',
    ...locals,
  });
  fs.writeFileSync(path.join(OUT, file), rewriteLinks(html));
  files.push(file);
}

function asset(file, content) {
  fs.writeFileSync(path.join(OUT, file), content);
  files.push(file);
}

function orderFor(l, license, date) {
  const price = l.prices.find((p) => p.license === license) || l.prices[0];
  return {
    id: l.id,
    listing_id: l.id,
    license: price.license,
    price_cents: price.price_cents,
    fee_cents: Math.round(price.price_cents * 0.1),
    currency: price.currency,
    created_at: new Date(date),
    title: l.title,
    data_sha256: l.data_sha256,
    signature: l.signature,
    data_format: l.data_format,
    fields: l.fields,
    seller_id: l.seller_id,
    topic_name: l.topic_name,
    area_name: l.area_name,
    seller_name: l.display_name,
    seller_company: l.company_name,
    public_key: l.public_key,
  };
}

function bundleFor(order, l) {
  return {
    format: 'mydatasign-bundle/v1',
    order: { id: order.id, license: order.license, purchased_at: order.created_at },
    listing: { id: l.id, title: l.title, topic: l.topic_name, area: l.area_name, fields: l.fields },
    seller: { id: l.seller_id, name: l.company_name || l.display_name, public_key: l.public_key, fingerprint: keyFingerprint(l.public_key) },
    manifest: l.manifest,
    sha256: l.data_sha256,
    signature: l.signature,
    data_format: l.data_format,
    data_base64: l.data.toString('base64'),
  };
}

async function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'public', 'styles.css'), path.join(OUT, 'styles.css'));
  fs.copyFileSync(path.join(ROOT, 'public', 'app.js'), path.join(OUT, 'app.js'));
  files.push('styles.css', 'app.js');

  const published = listings.filter((l) => l.status === 'published');
  const topicCounts = Object.fromEntries(topics.map((t) => [t.slug, published.filter((l) => l.topic_slug === t.slug).length]));
  const newest = [...published].sort((a, b) => b.created_at - a.created_at);

  await page('index.html', 'index', {
    title: 'Browse data', path: '/', listings: newest, hasMore: false, page: 1,
    filters: { q: '', topic: '', area: '', seller: '', max_price: '', sort: 'newest' },
    topicCounts, topics, areas,
  });

  for (const l of listings) {
    const prices = [...l.prices].sort((a, b) => LICENSE_ORDER.indexOf(a.license) - LICENSE_ORDER.indexOf(b.license));
    const owned = purchases.filter((p) => p.listingId === l.id).map((p) => ({ id: l.id, license: p.license }));
    await page(`listing-${l.id}.html`, 'listing', {
      title: l.title, listing: l, prices, myOrders: owned,
      isOwner: l.seller_id === demoUser.id, fingerprint: keyFingerprint(l.public_key),
    });

    // Every listing gets an order page + downloads so the demo "Buy" button has somewhere to go.
    const p = purchases.find((x) => x.listingId === l.id);
    const order = orderFor(l, p ? p.license : prices[0].license, p ? p.date : '2025-11-10');
    await page(`order-${l.id}.html`, 'order', {
      title: `Order #${order.id}`, order,
      downloads: p ? [{ created_at: new Date(`${p.date}T09:14:00Z`) }] : [],
      fingerprint: keyFingerprint(l.public_key),
    });
    asset(`bundle-${l.id}.signed.json`, JSON.stringify(bundleFor(order, l), null, 2));
    asset(`data-${l.id}.csv`, l.data);

    if (l.seller_id === demoUser.id) {
      await page(`listing-${l.id}-edit.html`, 'listing-form', {
        title: 'Edit listing', listing: l,
        values: { ...l, prices: Object.fromEntries(l.prices.map((x) => [x.license, x.price_cents])) },
        errors: [], LICENSES: helpers.LICENSES, CURRENCIES: helpers.CURRENCIES,
        DATA_FORMATS: helpers.DATA_FORMATS, FIELD_TYPES: helpers.FIELD_TYPES, topics, areas,
      });
    }
  }

  for (const s of sellers) {
    await page(`seller-${s.id}.html`, 'seller', {
      title: s.company_name || s.display_name, seller: s,
      listings: newest.filter((l) => l.seller_id === s.id), fingerprint: keyFingerprint(s.public_key),
    });
  }

  const mine = listings.filter((l) => l.seller_id === demoUser.id);
  await page('dashboard.html', 'dashboard', {
    title: 'Dashboard', path: '/dashboard',
    listings: mine.map((l) => ({
      ...l,
      revenue: l.sales * Math.round(l.prices[0].price_cents * 0.9),
      currency: l.prices[0].currency,
    })),
    purchases: purchases.map((p) => {
      const l = listings.find((x) => x.id === p.listingId);
      const o = orderFor(l, p.license, p.date);
      return { id: o.id, license: o.license, price_cents: o.price_cents, currency: o.currency, created_at: o.created_at, listing_id: l.id, title: l.title };
    }),
    sales: ['Nordlicht Research AG', 'J. Moreau', 'Kaito S.', 'Helix Health Ltd', 'A. Rossi'].map((buyer, i) => ({
      id: 100 + i, license: i % 2 ? 'commercial' : 'personal',
      price_cents: i % 2 ? 4900 : 900, fee_cents: i % 2 ? 490 : 90, currency: 'CHF',
      created_at: new Date(Date.UTC(2025, 10, 8 - i * 3)), title: mine[0].title, buyer,
    })),
  });

  await page('listing-new.html', 'listing-form', {
    title: 'New listing', path: '/listings/new', listing: null,
    values: { fields: [], prices: {}, currency: 'EUR', data_format: 'csv' },
    errors: [], LICENSES: helpers.LICENSES, CURRENCIES: helpers.CURRENCIES,
    DATA_FORMATS: helpers.DATA_FORMATS, FIELD_TYPES: helpers.FIELD_TYPES, topics, areas,
  });

  // Verify: show the result of verifying a real bundle so the demo has something to see.
  const v = listings[4];
  await page('verify.html', 'verify', {
    title: 'Verify a data package', path: '/verify', error: null,
    result: {
      valid: true,
      checks: [
        { label: 'Data integrity (SHA-256)', ok: true, detail: v.data_sha256 },
        { label: 'Manifest matches listing & seller', ok: true, detail: v.manifest },
        { label: 'Seller signature (Ed25519)', ok: true, detail: `Key ${keyFingerprint(v.public_key)}` },
        { label: 'Key registered to this seller on MyDataSign', ok: true, detail: `Registered key ${keyFingerprint(v.public_key)}` },
      ],
    },
  });
  await page('login.html', 'login', { title: 'Sign in', currentUser: null, email: 'alex@demo.local', error: null });
  await page('register.html', 'register', { title: 'Create account', currentUser: null, values: {}, error: null });

  console.log(`Demo built: ${files.length} files in ${path.relative(ROOT, OUT)}/`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
