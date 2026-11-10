'use strict';

const crypto = require('crypto');
const config = require('./config');

// 256-bit key derived from the configured secret, so any sufficiently random
// string (such as the value Render's generateValue produces) works.
const KEY = crypto.createHash('sha256').update(config.dataEncryptionKey, 'utf8').digest();

/** AES-256-GCM encryption; output format: v1.<iv>.<tag>.<ciphertext> (base64url). */
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.isBuffer(plain) ? plain : Buffer.from(String(plain), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decrypt(payload) {
  const [version, iv, tag, ciphertext] = String(payload).split('.');
  if (version !== 'v1') throw new Error('Unsupported ciphertext version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
}

/** Each seller gets an Ed25519 key pair; the private key is stored encrypted. */
function generateSellerKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKeyEnc: encrypt(privateKey) };
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * The signed manifest binds the data hash to the listing and seller, so a
 * signature cannot be replayed for a different listing.
 */
function manifestFor({ listingId, sellerId, sha256 }) {
  return `mydatasign:v1:listing=${listingId}:seller=${sellerId}:sha256=${sha256}`;
}

function signManifest(manifest, privateKeyEnc) {
  const privateKey = decrypt(privateKeyEnc).toString('utf8');
  return crypto.sign(null, Buffer.from(manifest, 'utf8'), privateKey).toString('base64');
}

function verifyManifest(manifest, signatureB64, publicKeyPem) {
  try {
    return crypto.verify(null, Buffer.from(manifest, 'utf8'), publicKeyPem, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

function keyFingerprint(publicKeyPem) {
  return sha256Hex(Buffer.from(publicKeyPem, 'utf8')).slice(0, 16).match(/.{4}/g).join(':');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

module.exports = {
  encrypt,
  decrypt,
  generateSellerKeys,
  sha256Hex,
  manifestFor,
  signManifest,
  verifyManifest,
  keyFingerprint,
  randomToken,
  safeEqual,
};
