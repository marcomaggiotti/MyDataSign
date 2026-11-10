'use strict';

const { pool } = require('./db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  account_type    TEXT NOT NULL CHECK (account_type IN ('individual', 'company')),
  company_name    TEXT,
  vat_id          TEXT,
  public_key      TEXT NOT NULL,
  private_key_enc TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topics (
  id   SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS areas (
  id   SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('global', 'region', 'country'))
);

CREATE TABLE IF NOT EXISTS listings (
  id            SERIAL PRIMARY KEY,
  seller_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  topic_id      INTEGER NOT NULL REFERENCES topics(id),
  area_id       INTEGER NOT NULL REFERENCES areas(id),
  fields        JSONB NOT NULL DEFAULT '[]',
  sample        TEXT NOT NULL DEFAULT '',
  data_format   TEXT NOT NULL DEFAULT 'csv',
  data_enc      TEXT,
  data_sha256   TEXT,
  signature     TEXT,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  max_sales     INTEGER CHECK (max_sales IS NULL OR max_sales > 0),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'sold_out', 'archived')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_browse_idx ON listings (status, topic_id, area_id);

CREATE TABLE IF NOT EXISTS listing_prices (
  id          SERIAL PRIMARY KEY,
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  license     TEXT NOT NULL CHECK (license IN ('personal', 'commercial', 'exclusive')),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency    TEXT NOT NULL DEFAULT 'EUR',
  UNIQUE (listing_id, license)
);

CREATE TABLE IF NOT EXISTS orders (
  id          SERIAL PRIMARY KEY,
  buyer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  license     TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  fee_cents   INTEGER NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending', 'paid', 'refunded')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_buyer_idx ON orders (buyer_id);
CREATE INDEX IF NOT EXISTS orders_listing_idx ON orders (listing_id);

CREATE TABLE IF NOT EXISTS download_log (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const TOPICS = [
  ['health-fitness', 'Health & Fitness'],
  ['finance', 'Finance & Spending'],
  ['mobility-location', 'Mobility & Location'],
  ['retail-consumer', 'Retail & Consumer Behaviour'],
  ['energy', 'Energy & Utilities'],
  ['agriculture', 'Agriculture & Food'],
  ['demographics', 'Social & Demographics'],
  ['technology-usage', 'Technology & App Usage'],
  ['environment-climate', 'Environment & Climate'],
  ['real-estate', 'Real Estate'],
  ['media-entertainment', 'Media & Entertainment'],
  ['industrial-iot', 'Industrial & IoT Sensors'],
];

const AREAS = [
  ['global', 'Global', 'global'],
  ['europe', 'Europe', 'region'],
  ['north-america', 'North America', 'region'],
  ['latin-america', 'Latin America', 'region'],
  ['asia-pacific', 'Asia-Pacific', 'region'],
  ['middle-east-africa', 'Middle East & Africa', 'region'],
  ['ch', 'Switzerland', 'country'],
  ['it', 'Italy', 'country'],
  ['de', 'Germany', 'country'],
  ['fr', 'France', 'country'],
  ['es', 'Spain', 'country'],
  ['gb', 'United Kingdom', 'country'],
  ['us', 'United States', 'country'],
  ['br', 'Brazil', 'country'],
  ['in', 'India', 'country'],
  ['jp', 'Japan', 'country'],
];

async function migrate() {
  await pool.query(SCHEMA);
  for (const [slug, name] of TOPICS) {
    await pool.query(
      'INSERT INTO topics (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name',
      [slug, name],
    );
  }
  for (const [slug, name, kind] of AREAS) {
    await pool.query(
      'INSERT INTO areas (slug, name, kind) VALUES ($1, $2, $3) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind',
      [slug, name, kind],
    );
  }
}

module.exports = { migrate, TOPICS, AREAS };

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Migrations applied');
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
