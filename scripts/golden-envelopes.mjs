// Writes the version-1 sample envelopes under test/golden/. Every later release must still open
// them. They are built here with Web Crypto directly and fixed inputs, not with the app's code, so
// a test that opens them compares the app against a second, independent reading of the format.
//
// An existing sample is never rewritten. A sample that fails its test means a release broke
// compatibility, never that the sample is stale. Running this again only adds new samples, and it
// fails if a committed one no longer reproduces byte for byte.
//
// Run: node scripts/golden-envelopes.mjs to add new samples.
//      node scripts/golden-envelopes.mjs --check to write nothing and fail if a sample is missing or
//      differs; npm run check runs this.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const subtle = globalThis.crypto.subtle;
const enc = (s) => new TextEncoder().encode(s);
const hex = (h) => Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const counting = (n, start) => Uint8Array.from({ length: n }, (_, i) => (start + i) & 0xff);
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));

function pack(header, body) {
  const h = enc(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, h.length);
  return cat(len, h, body);
}

async function aes(name, key, iv, plain) {
  return new Uint8Array(await subtle.encrypt({ name, iv }, key, plain));
}

const GOLDEN = new URL('../test/golden/', import.meta.url);
const SALT = counting(16, 0x00);
const NONCE = counting(12, 0xa0);
const IV = counting(16, 0xb0);
const TEXT = 'Meet me at the north gate at seven.';
const out = {};

// Password, AES-256-GCM and AES-256-CBC. (CBC's nonce is its IV.) A password is NFC-normalised
// before PBKDF2; this one is plain ASCII, which NFC leaves unchanged.
for (const [name, method, iv] of [['AES-GCM', 'aes-256-gcm', NONCE], ['AES-CBC', 'aes-256-cbc', IV]]) {
  const base = await subtle.importKey('raw', enc('correct horse battery staple'.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: SALT, iterations: 600000 }, base, { name, length: 256 }, false, ['encrypt']);
  const ciphertext = await aes(name, key, iv, pack({ kind: 'text' }, enc(TEXT)));
  out[`${method}-password`] = { format: 'cipher-envelope', version: 1, method, opensWith: 'password', kdf: { id: 'pbkdf2-sha256', iterations: 600000, salt: b64u(SALT) }, nonce: b64u(iv), ciphertext: b64u(ciphertext) };
}

// Password, AES-256-GCM, with more iterations than sealing spends today: opening must use the
// envelope's own count, not the current sealing figure.
{
  const base = await subtle.importKey('raw', enc('correct horse battery staple'.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: SALT, iterations: 650000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ciphertext = await aes('AES-GCM', key, NONCE, pack({ kind: 'text' }, enc(TEXT)));
  out['aes-256-gcm-password-650000'] = { format: 'cipher-envelope', version: 1, method: 'aes-256-gcm', opensWith: 'password', kdf: { id: 'pbkdf2-sha256', iterations: 650000, salt: b64u(SALT) }, nonce: b64u(NONCE), ciphertext: b64u(ciphertext) };
}

// Password, AES-256-GCM, not plain ASCII: "café" with a composed é, and the "ﬁ" ligature (U+FB01),
// normalised to NFC as v1 requires. NFC keeps the ligature, where NFKC would turn it into "fi".
{
  const password = `caf${String.fromCodePoint(0xe9)} ${String.fromCodePoint(0xfb01)}`.normalize('NFC');
  const base = await subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: SALT, iterations: 600000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ciphertext = await aes('AES-GCM', key, NONCE, pack({ kind: 'text' }, enc(TEXT)));
  out['aes-256-gcm-password-nfc'] = { format: 'cipher-envelope', version: 1, method: 'aes-256-gcm', opensWith: 'password', kdf: { id: 'pbkdf2-sha256', iterations: 600000, salt: b64u(SALT) }, nonce: b64u(NONCE), ciphertext: b64u(ciphertext) };
}

// Generated key, AES-256-GCM, a file rather than text.
{
  const key = await subtle.importKey('raw', counting(32, 0x01), 'AES-GCM', false, ['encrypt']);
  const photo = counting(64, 0x40);
  out['aes-256-gcm-generated-file'] = { format: 'cipher-envelope', version: 1, method: 'aes-256-gcm', opensWith: 'generated', nonce: b64u(NONCE), ciphertext: b64u(await aes('AES-GCM', key, NONCE, pack({ kind: 'file', name: 'photo.jpg', type: 'image/jpeg' }, photo))) };
}

// Generated key and key file, AES-256-CBC.
{
  const key = await subtle.importKey('raw', counting(32, 0x01), 'AES-CBC', false, ['encrypt']);
  const ciphertext = await aes('AES-CBC', key, IV, pack({ kind: 'text' }, enc(TEXT)));
  out['aes-256-cbc-generated'] = { format: 'cipher-envelope', version: 1, method: 'aes-256-cbc', opensWith: 'generated', nonce: b64u(IV), ciphertext: b64u(ciphertext) };
}
{
  const base = await subtle.importKey('raw', enc('the key file for the sample envelope'), 'HKDF', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc('cipher-envelope v1 key file') }, base, { name: 'AES-CBC', length: 256 }, false, ['encrypt']);
  const ciphertext = await aes('AES-CBC', key, IV, pack({ kind: 'text' }, enc(TEXT)));
  out['aes-256-cbc-keyfile'] = { format: 'cipher-envelope', version: 1, method: 'aes-256-cbc', opensWith: 'keyfile', kdf: { id: 'hkdf-sha256', salt: b64u(SALT) }, nonce: b64u(IV), ciphertext: b64u(ciphertext) };
}

// Key file, AES-256-GCM.
{
  const base = await subtle.importKey('raw', enc('the key file for the sample envelope'), 'HKDF', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc('cipher-envelope v1 key file') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  out['aes-256-gcm-keyfile'] = { format: 'cipher-envelope', version: 1, method: 'aes-256-gcm', opensWith: 'keyfile', kdf: { id: 'hkdf-sha256', salt: b64u(SALT) }, nonce: b64u(NONCE), ciphertext: b64u(await aes('AES-GCM', key, NONCE, pack({ kind: 'text' }, enc(TEXT)))) };
}

// Public key, X25519. The keys are RFC 7748 section 6.1's: Alice's pair is the sender's ephemeral
// pair, Bob is the recipient.
{
  const pkcs8 = (scalar) => cat(hex('302e020100300506032b656e04220420'), hex(scalar));
  const RFC = {
    alicePrivate: '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
    alicePublic: '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
    bobPrivate: '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb',
    bobPublic: 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f',
    shared: '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742',
  };
  const importPrivate = (scalar) => subtle.importKey('pkcs8', pkcs8(scalar), { name: 'X25519' }, true, ['deriveBits']);
  const publicOf = async (key) => Buffer.from((await subtle.exportKey('jwk', key)).x, 'base64url').toString('hex');
  const alice = await importPrivate(RFC.alicePrivate);
  const bob = await importPrivate(RFC.bobPrivate);
  const bobPublicKey = await subtle.importKey('raw', hex(RFC.bobPublic), { name: 'X25519' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: bobPublicKey }, alice, 256));
  // The sample is only as good as the vector: stop if any value differs from RFC 7748.
  if ((await publicOf(alice)) !== RFC.alicePublic || (await publicOf(bob)) !== RFC.bobPublic || Buffer.from(shared).toString('hex') !== RFC.shared) {
    throw new Error('The RFC 7748 vector does not reproduce; refusing to write the public-key sample.');
  }
  const ephemeral = hex(RFC.alicePublic);
  const recipient = hex(RFC.bobPublic);
  const base = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: cat(enc('cipher-envelope v1 x25519'), ephemeral, recipient) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  out['aes-256-gcm-publickey'] = { format: 'cipher-envelope', version: 1, method: 'aes-256-gcm', opensWith: 'publickey', kdf: { id: 'x25519-hkdf-sha256', salt: b64u(SALT), epk: b64u(ephemeral) }, nonce: b64u(NONCE), ciphertext: b64u(await aes('AES-GCM', key, NONCE, pack({ kind: 'text' }, enc(TEXT)))) };
  const bobFile = { format: 'cipher-envelope-key', version: 1, kind: 'x25519-private', publicKey: b64u(recipient), privateKey: b64u(pkcs8(RFC.bobPrivate)) };
  out['aes-256-gcm-publickey.private-key'] = bobFile;
}

// The classical ciphers' textbook examples, as envelopes.
const classical = (method, opensWith, ciphertext) => ({ format: 'cipher-envelope', version: 1, method, opensWith, ciphertext });
out['caesar'] = classical('caesar', 'shift', 'WKH TXLFN EURZQ IRA MXPSV RYHU WKH ODCB GRJ');
out['vigenere'] = classical('vigenere', 'keyword', 'LXFOPVEFRNHR');
out['atbash'] = classical('atbash', 'none', 'DRAZIW');
out['rail-fence'] = classical('rail-fence', 'rails', 'WECRUOERDSOEERNTNEAIVDAC');
out['playfair'] = classical('playfair', 'keyword', 'BMODZBXDNABEKUDMUIXMMOUVIF');

// Vigenère with the keyword "café ﬁ", normalised to NFC as v1 requires. Only the letters A to Z
// count, so the key is CAF: NFC keeps é and the ligature whole and both are dropped, where NFD would
// give CAFE and NFKC CAFFI. Worked by hand: ATTACKATDAWN shifted by C, A, F in turn.
out['vigenere-keyword-nfc'] = classical('vigenere', 'keyword', 'CTYCCPCTICWS');

const checking = process.argv.includes('--check');
let failed = 0;
for (const [name, value] of Object.entries(out)) {
  const file = new URL(`${name}.json`, GOLDEN);
  const text = JSON.stringify(value, null, 2) + '\n';
  if (!existsSync(file) && checking) {
    failed += 1;
    console.error(`MISSING test/golden/${name}.json`);
  } else if (!existsSync(file)) {
    writeFileSync(file, text, { flag: 'wx' });
    console.log(`added   test/golden/${name}.json`);
  } else if (readFileSync(file, 'utf8') === text) {
    console.log(`same    test/golden/${name}.json`);
  } else {
    failed += 1;
    console.error(`DIFFERS test/golden/${name}.json: kept the committed file`);
  }
}
if (failed > 0) process.exit(1);
