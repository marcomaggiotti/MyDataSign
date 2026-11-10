'use strict';

const isProd = process.env.NODE_ENV === 'production';

function required(name, devFallback) {
  const value = process.env[name];
  if (value) return value;
  if (!isProd && devFallback !== undefined) return devFallback;
  throw new Error(`Missing required environment variable ${name}`);
}

module.exports = {
  isProd,
  port: Number(process.env.PORT || 3000),
  databaseUrl: required('DATABASE_URL', 'postgres://localhost:5432/mydatasign'),
  sessionSecret: required('SESSION_SECRET', 'dev-only-session-secret-change-me'),
  dataEncryptionKey: required('DATA_ENCRYPTION_KEY', 'dev-only-encryption-key-change-me'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024),
  platformFeePercent: Number(process.env.PLATFORM_FEE_PERCENT || 10),
};
