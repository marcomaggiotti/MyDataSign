# MyDataSign

A marketplace where **companies and individuals sell their own data**. Every data package is:

- **Customisable**: the seller describes the schema (field name, type, description), adds a free public sample, and chooses the format (CSV, JSON, JSONL, TXT).
- **Priced by the seller**: up to three licenses per listing (Personal / research, Commercial, Exclusive), each with its own price in EUR, CHF, USD or GBP, plus an optional sales limit.
- **Secure**: encrypted at rest with AES-256-GCM, and only buyers who paid can download it. Every download is logged.
- **Signed**: each seller gets an Ed25519 key pair when they sign up. Each package's SHA-256 is signed in a manifest tied to the listing and the seller, and anyone can check a downloaded bundle on `/verify`.
- **Classified**: by **topic** (Health, Finance, Mobility, Energy and more) and **area** (Global, regions, countries). Buyers can filter by topic, area, seller type and price.

## Deploy on Render (Blueprint)

1. Push this repository to GitHub.
2. In Render, go to **New → Blueprint** and pick the repository. Render reads `render.yaml` and creates:
   - `mydatasign`: a Node web service with a health check on `/healthz`
   - `mydatasign-db`: a managed PostgreSQL database
   - `SESSION_SECRET` and `DATA_ENCRYPTION_KEY`, generated automatically
3. Click **Apply**. Tables and the topic/area catalogue are created when the app starts.

> **Back up `DATA_ENCRYPTION_KEY`.** It encrypts every data package and every seller's private signing key. If it is lost, the stored data cannot be recovered.

## Run locally

```bash
npm install
```

```bash
DATABASE_URL=postgres://localhost:5432/mydatasign npm run dev
```

Open http://localhost:3000. In development, fallback secrets are used. In production (`NODE_ENV=production`) they are required.

## Tests

The end-to-end test registers a seller and a buyer. It then lists, encrypts, signs, publishes, buys, downloads and verifies a package. It also checks tampering, access control and CSRF. It needs a disposable Postgres database, because **it drops the schema**:

```bash
TEST_DATABASE_URL=postgres://localhost:5432/mydatasign_test npm test
```

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection string | required in production |
| `SESSION_SECRET` | Signs session cookies | required in production |
| `DATA_ENCRYPTION_KEY` | Master key for data and seller private keys | required in production |
| `PLATFORM_FEE_PERCENT` | Fee kept from each sale | `10` |
| `MAX_UPLOAD_BYTES` | Max size of a data package | `5242880` (5 MB) |
| `PGSSL` | Force TLS to Postgres (`true`) | off; on when the URL has `sslmode=require` |

## How it fits together

```
src/
  server.js        Express app: helmet/CSP, Postgres sessions, CSRF, routes
  migrate.js       Schema + seed topics & areas (runs on boot, idempotent)
  crypto.js        AES-256-GCM, Ed25519 seller keys, signed manifests
  routes/
    auth.js        Register (individual / company), login, logout
    market.js      Browse & filter, listing page, seller profile
    listings.js    Seller dashboard, create/edit/publish listings, upload & sign data
    orders.js      Checkout, order page, decrypted downloads (bundle or raw)
    verify.js      Public verification of signed bundles
views/             EJS templates
public/            CSS and a small script
render.yaml        Render Blueprint
```

**Signed bundle** (`*.signed.json`) contains the data (base64), its SHA-256, the manifest
`mydatasign:v1:listing=<id>:seller=<id>:sha256=<hash>`, the seller's Ed25519 signature over it, and the seller's public key.

### Business rules

- Listings start as **drafts**. Publishing needs uploaded data and at least one price.
- The **Exclusive** license can only be bought before the first sale, and it closes the listing.
- When the **sales limit** is reached, the listing is marked *sold out*.
- Once a listing has sold, its data **cannot be replaced**, so buyers always get the exact signed version they paid for.
- Sellers must confirm they own the data or have consent to sell it (GDPR / nFADP).

## Before going live

- **Payments:** checkout is a demo that records a paid order without charging a card. Replace the `POST /listings/:id/buy` handler with Stripe Checkout and a webhook. Stripe Connect fits marketplace payouts to sellers.
- **Large files:** packages are stored encrypted in Postgres, which is fine up to a few MB. For bigger datasets, move the ciphertext to object storage (S3, R2) and keep the hash and signature in the database.
- Add email verification, password reset, and KYC for company sellers as needed.
