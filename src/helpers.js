'use strict';

const LICENSES = {
  personal: { label: 'Personal / research', description: 'Non-commercial use by the buyer only.' },
  commercial: { label: 'Commercial', description: 'Use in commercial products and analytics. No resale.' },
  exclusive: { label: 'Exclusive', description: 'Single buyer. The listing closes after this sale.' },
};

const CURRENCIES = ['EUR', 'CHF', 'USD', 'GBP'];
const DATA_FORMATS = ['csv', 'json', 'jsonl', 'txt'];
const FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'date', 'datetime', 'geo', 'category'];

function formatMoney(cents, currency) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(cents / 100);
}

/** Parses "12.50" / "12,50" into integer cents; returns null if invalid. */
function parsePriceToCents(input) {
  if (input === undefined || input === null || String(input).trim() === '') return null;
  const normalized = String(input).trim().replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(normalized)) return NaN;
  return Math.round(Number(normalized) * 100);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

module.exports = { LICENSES, CURRENCIES, DATA_FORMATS, FIELD_TYPES, formatMoney, parsePriceToCents, formatBytes };
