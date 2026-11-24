import { describe, expect, test, vi } from 'vitest';
import { thrown } from './thrown';
import { parse, serialize } from '../src/crypto/envelope';
import { makeKeyPair } from '../src/crypto/keys';
import { assertWithinLimit, open, seal } from '../src/crypto/seal';
import type { Envelope } from '../src/crypto/envelope';
import gcmPublicKey from './golden/aes-256-gcm-publickey.json?raw';
import bobPrivateKey from './golden/aes-256-gcm-publickey.private-key.json?raw';

const TEXT = { kind: 'text', text: 'Meet me at the north gate at seven.' } as const;
const PHOTO = { kind: 'file', name: 'photo.jpg', type: 'image/jpeg', bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]) } as const;
const PASSWORD = 'a throwaway sentence for the tests';
const EMPTY_FILE = { kind: 'file', name: 'empty.txt', type: 'text/plain', bytes: new Uint8Array(0) } as const;
const LONE_SURROGATE = String.fromCodePoint(0xd800);
const GENERATED = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
const KEY_FILE = new TextEncoder().encode('a throwaway key file');
// A packed text payload ("other") as decrypt would return it: a 4-byte header length, the header, the text.
const PACKED_OTHER_TEXT = new Uint8Array([0, 0, 0, 15, ...new TextEncoder().encode('{"kind":"text"}'), ...new TextEncoder().encode('other')]);
/** A payload as decrypt returns it: a 4-byte header length (the header's own unless given), the header, the body. */
function packed(header: string, body: Uint8Array, length = new TextEncoder().encode(header).length): Uint8Array<ArrayBuffer> {
  const head = new TextEncoder().encode(header);
  const out = new Uint8Array(4 + head.length + body.length);
  new DataView(out.buffer).setUint32(0, length);
  out.set(head, 4);
  out.set(body, 4 + head.length);
  return out;
}
const PACKED_OTHER_NAME = packed('{"kind":"file","name":"other.jpg","type":"image/jpeg"}', PHOTO.bytes);
const PACKED_OTHER_BYTES = packed('{"kind":"file","name":"photo.jpg","type":"image/jpeg"}', Uint8Array.from([1, 2, 3]));
const PACKED_EXTRA_FIELD = packed('{"kind":"text","note":"extra"}', new TextEncoder().encode(TEXT.text));
const PACKED_FILE_EXTRA_FIELD = packed('{"kind":"file","name":"photo.jpg","type":"image/jpeg","note":"extra"}', PHOTO.bytes);
// The 15-byte header with a length one past it: unchecked, it would read as an empty text.
const PACKED_LENGTH_ONE_PAST = packed('{"kind":"text"}', new Uint8Array(0), 16);
const ATBASH = '{"format":"cipher-envelope","version":1,"method":"atbash","opensWith":"none","ciphertext":"DRAZIW"}';
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
const BOM_LED = { kind: 'text', text: `${BYTE_ORDER_MARK}Meet me at seven.` } as const;
const PACKED_NOT_UTF8 = packed('{"kind":"text"}', Uint8Array.from([0xff, 0xfe, 0xfd]));
const PACKED_BOM_HEADER = packed(`${BYTE_ORDER_MARK}{"kind":"text"}`, new TextEncoder().encode(TEXT.text));
const PACKED_ONE_BYTE_OFF = packed('{"kind":"file","name":"photo.jpg","type":"image/jpeg"}', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x47]));
const PACKED_OTHER_TYPE = packed('{"kind":"file","name":"photo.jpg","type":"image/png"}', PHOTO.bytes);
const PACKED_FILE_FOR_TEXT = packed('{"kind":"file","name":"x","type":"text/plain"}', new TextEncoder().encode(TEXT.text));
const BIG_FILE = { kind: 'file', name: 'big.bin', type: 'application/octet-stream', bytes: new Uint8Array(100_000).fill(7) } as const;
// The same password typed two ways: "é" as one code point, and as "e" plus a combining accent.
const CAFE_COMPOSED = `caf${String.fromCodePoint(0xe9)} au lait`;
const CAFE_DECOMPOSED = `cafe${String.fromCodePoint(0x301)} au lait`;
// A valid salt and a valid X25519 public key (RFC 7748's Alice), to write in place of the real ones.
const OTHER_SALT = 'AAECAwQFBgcICQoLDA0ODw';
const OTHER_EPK = 'hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmo';
const realParse = JSON.parse;
/** Makes the self-check read the written text back with one key-derivation field changed. */
const rereadWithKdf = (field: 'salt' | 'epk', value: string) =>
  vi.spyOn(JSON, 'parse').mockImplementationOnce((text: string) => {
    const envelope = realParse(text);
    return { ...envelope, kdf: { ...envelope.kdf, [field]: value } };
  });
/** A field of an envelope as written, read back from its text. */
const nonceOf = (envelope: Envelope) => realParse(serialize(envelope)).nonce;
const saltOf = (envelope: Envelope) => realParse(serialize(envelope)).kdf.salt;
// The header alone, with a length far past it: unchecked, it would read as an empty text.
const PACKED_LONG_LENGTH = packed('{"kind":"text"}', new Uint8Array(0), 0xffffffff);
// AES-CBC works on whole 16-byte blocks, so a 15-byte ciphertext can never decrypt.
const CBC_PARTIAL_BLOCK = { format: 'cipher-envelope', version: 1, method: 'aes-256-cbc', opensWith: 'generated', nonce: 'AAECAwQFBgcICQoLDA0ODw', ciphertext: 'AAAAAAAAAAAAAAAAAAAA' } as const;

describe('round trips', () => {
  test('AES-256-GCM with a password', async () => {
    expect(await open(await seal('aes-256-gcm', TEXT, { kind: 'password', password: PASSWORD }), { kind: 'password', password: PASSWORD })).toEqual(TEXT);
  });
  test('AES-256-GCM with a generated key, a photo comes back byte for byte', async () => {
    expect(await open(await seal('aes-256-gcm', PHOTO, { kind: 'generated', key: GENERATED }), { kind: 'generated', key: GENERATED })).toEqual(PHOTO);
  });
  test('AES-256-GCM with a key file', async () => {
    expect(await open(await seal('aes-256-gcm', TEXT, { kind: 'keyfile', file: KEY_FILE }), { kind: 'keyfile', file: KEY_FILE })).toEqual(TEXT);
  });
  test('AES-256-GCM with a public key opens, from its saved text, with the private-key file', async () => {
    const pair = await makeKeyPair();
    const envelope = await seal('aes-256-gcm', TEXT, { kind: 'publickey', publicKey: pair.publicKey });
    expect(await open(parse(serialize(envelope)), { kind: 'privatekey', file: JSON.stringify(pair.privateKeyFile) })).toEqual(TEXT);
  });
  test('AES-256-CBC with a password', async () => {
    expect(await open(await seal('aes-256-cbc', TEXT, { kind: 'password', password: PASSWORD }), { kind: 'password', password: PASSWORD })).toEqual(TEXT);
  });
  test('AES-256-CBC with a generated key', async () => {
    expect(await open(await seal('aes-256-cbc', TEXT, { kind: 'generated', key: GENERATED }), { kind: 'generated', key: GENERATED })).toEqual(TEXT);
  });
  test('AES-256-CBC with a key file', async () => {
    expect(await open(await seal('aes-256-cbc', TEXT, { kind: 'keyfile', file: KEY_FILE }), { kind: 'keyfile', file: KEY_FILE })).toEqual(TEXT);
  });
  test('Caesar through the envelope', async () => {
    expect(await seal('caesar', { kind: 'text', text: 'ABC xyz' }, { kind: 'shift', shift: '3' })).toMatchObject({ method: 'caesar', opensWith: 'shift', ciphertext: 'DEF abc' });
  });
  test('Playfair through the envelope seals letters only', async () => {
    expect(await seal('playfair', { kind: 'text', text: 'Hide the gold in the tree stump' }, { kind: 'keyword', keyword: 'playfair example' })).toMatchObject({ ciphertext: 'BMODZBXDNABEKUDMUIXMMOUVIF' });
  });
  test('Atbash needs no key', async () => {
    expect(await seal('atbash', { kind: 'text', text: 'WIZARD' }, { kind: 'none' })).toMatchObject({ opensWith: 'none', ciphertext: 'DRAZIW' });
  });
});

describe('the envelope never holds the secret', () => {
  test('a password is not in the saved envelope', async () => {
    expect(serialize(await seal('aes-256-gcm', TEXT, { kind: 'password', password: PASSWORD }))).not.toContain(PASSWORD);
  });
  test('a generated key is not in the saved envelope', async () => {
    expect(serialize(await seal('aes-256-gcm', TEXT, { kind: 'generated', key: GENERATED }))).not.toContain(GENERATED);
  });
  test('the file name is not in the saved envelope', async () => {
    expect(serialize(await seal('aes-256-gcm', PHOTO, { kind: 'generated', key: GENERATED }))).not.toContain('photo.jpg');
  });
  test('a saved envelope carries no grade', async () => {
    expect(serialize(await seal('aes-256-cbc', TEXT, { kind: 'password', password: PASSWORD }))).not.toContain('grade');
  });
});

describe('the self-check', () => {
  test('a seal whose re-read does not open back to its input is refused', async () => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(PACKED_OTHER_TEXT.buffer);
    await expect(seal('aes-256-gcm', TEXT, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'round-trip-failed' });
  });
  test('a file that comes back under another name is refused', async () => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(PACKED_OTHER_NAME.buffer);
    await expect(seal('aes-256-gcm', PHOTO, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'round-trip-failed' });
  });
  test('a file that comes back with other bytes is refused', async () => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(PACKED_OTHER_BYTES.buffer);
    await expect(seal('aes-256-gcm', PHOTO, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'round-trip-failed' });
  });
});

describe('the payload inside the ciphertext is read strictly', () => {
  test('a header with a field it does not have is garbled', async () => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(PACKED_EXTRA_FIELD.buffer);
    await expect(seal('aes-256-gcm', TEXT, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'garbled' });
  });
  test('a file header with a field it does not have is garbled', async () => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(PACKED_FILE_EXTRA_FIELD.buffer);
    await expect(seal('aes-256-gcm', PHOTO, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'garbled' });
  });
  test('a header length one past the payload is garbled', async () => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(PACKED_LENGTH_ONE_PAST.buffer);
    await expect(seal('aes-256-gcm', TEXT, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'garbled' });
  });
  test('a header length beyond the payload is garbled', async () => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(PACKED_LONG_LENGTH.buffer);
    await expect(seal('aes-256-gcm', TEXT, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'garbled' });
  });
});

describe('refusals', () => {
  test('a cipher without a tamper check says it cannot tell a wrong key from a changed envelope', async () => {
    await expect(open(CBC_PARTIAL_BLOCK, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'unauthenticated-failed' });
  });
  test('a wrong password on AES-256-GCM', async () => {
    const envelope = await seal('aes-256-gcm', TEXT, { kind: 'password', password: PASSWORD });
    await expect(open(envelope, { kind: 'password', password: 'not it' })).rejects.toMatchObject({ code: 'wrong-secret' });
  });
  test('a different key file', async () => {
    const envelope = await seal('aes-256-gcm', TEXT, { kind: 'keyfile', file: KEY_FILE });
    await expect(open(envelope, { kind: 'keyfile', file: new TextEncoder().encode('another file') })).rejects.toMatchObject({ code: 'wrong-secret' });
  });
  test('somebody else’s private key', async () => {
    const [recipient, stranger] = await Promise.all([makeKeyPair(), makeKeyPair()]);
    const envelope = await seal('aes-256-gcm', TEXT, { kind: 'publickey', publicKey: recipient.publicKey });
    await expect(open(envelope, { kind: 'privatekey', file: JSON.stringify(stranger.privateKeyFile) })).rejects.toMatchObject({ code: 'wrong-secret' });
  });
  test('a learning cipher refuses a file', async () => {
    await expect(seal('caesar', PHOTO, { kind: 'shift', shift: '3' })).rejects.toMatchObject({ code: 'text-only' });
  });
  test('a key kind the method does not take', async () => {
    await expect(seal('aes-256-cbc', TEXT, { kind: 'publickey', publicKey: GENERATED })).rejects.toMatchObject({ code: 'key-kind-unsupported', detail: 'publickey' });
  });
  test('an empty text', async () => {
    await expect(seal('aes-256-gcm', { kind: 'text', text: '' }, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'empty-input' });
  });
  test('an envelope re-read from its text opens the same way', async () => {
    const envelope = await seal('aes-256-gcm', TEXT, { kind: 'generated', key: GENERATED });
    expect(await open(parse(serialize(envelope)), { kind: 'generated', key: GENERATED })).toEqual(TEXT);
  });
});

describe('X25519 low-order keys', () => {
  test('sealing to the all-zero public key is refused', async () => {
    await expect(seal('aes-256-gcm', TEXT, { kind: 'publickey', publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })).rejects.toMatchObject({ code: 'public-key-invalid' });
  });
  test('a platform that returns an all-zero secret instead of refusing is still refused', async () => {
    vi.spyOn(crypto.subtle, 'deriveBits').mockResolvedValueOnce(new ArrayBuffer(32));
    await expect(seal('aes-256-gcm', TEXT, { kind: 'publickey', publicKey: 'hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmo' })).rejects.toMatchObject({ code: 'public-key-invalid', detail: 'low-order' });
  });
  test('an envelope whose ephemeral key is all zeros is refused as damaged', async () => {
    const crafted = parse(gcmPublicKey.replace(/"epk": "[^"]+"/, '"epk": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"'));
    await expect(open(crafted, { kind: 'privatekey', file: bobPrivateKey })).rejects.toMatchObject({ code: 'field-invalid', detail: 'kdf.epk' });
  });
});

describe('nothing is sealed into an envelope that opens to nothing', () => {
  test('Playfair refuses a text with no letters', async () => {
    await expect(seal('playfair', { kind: 'text', text: '123' }, { kind: 'keyword', keyword: 'playfair example' })).rejects.toMatchObject({ code: 'empty-input' });
  });
});

describe('empty secrets', () => {
  test('an empty password is refused', async () => {
    await expect(seal('aes-256-gcm', TEXT, { kind: 'password', password: '' })).rejects.toMatchObject({ code: 'password-empty' });
  });
  test('an empty key file is refused', async () => {
    await expect(seal('aes-256-gcm', TEXT, { kind: 'keyfile', file: new Uint8Array(0) })).rejects.toMatchObject({ code: 'keyfile-missing' });
  });
});

describe('the size limit', () => {
  test('sealing a file one byte over 64 MiB is refused, naming the limit', async () => {
    await expect(seal('aes-256-gcm', { kind: 'file', name: 'big.bin', type: '', bytes: new Uint8Array(67_108_865) }, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'too-large', detail: '67108864' });
  });
  test('a learning cipher refuses text over 1 MiB, naming its own limit', async () => {
    await expect(seal('caesar', { kind: 'text', text: 'A'.repeat(1_048_577) }, { kind: 'shift', shift: '3' })).rejects.toMatchObject({ code: 'learn-too-large', detail: '1048576' });
  });
  test('a learning cipher seals exactly 1 MiB', async () => {
    expect(await seal('caesar', { kind: 'text', text: 'A'.repeat(1_048_576) }, { kind: 'shift', shift: '3' })).toMatchObject({ ciphertext: 'D'.repeat(1_048_576) });
  });
  test('Playfair seals 1 MiB of one letter, padded to 2 MiB: AX in one column of the "key" square slides to GA', async () => {
    expect(await seal('playfair', { kind: 'text', text: 'A'.repeat(1_048_576) }, { kind: 'keyword', keyword: 'key' })).toMatchObject({ ciphertext: 'GA'.repeat(1_048_576) });
  });
  test('exactly the limit is accepted', () => {
    expect(assertWithinLimit(10, 10)).toBeUndefined();
  });
  test('one byte over the limit is refused, naming the limit', () => {
    expect(thrown(assertWithinLimit, 11, 10)).toMatchObject({ code: 'too-large', detail: '10' });
  });
});

describe('a browser without X25519', () => {
  test('public-key sealing reports it as unsupported', async () => {
    vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValueOnce(new DOMException('Unrecognized name', 'NotSupportedError'));
    await expect(seal('aes-256-gcm', TEXT, { kind: 'publickey', publicKey: 'hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmo' })).rejects.toMatchObject({ code: 'x25519-unsupported' });
  });
});

describe('every seal is fresh', () => {
  test('two seals with the same key draw different nonces', async () => {
    const first = await seal('aes-256-gcm', TEXT, { kind: 'generated', key: GENERATED });
    const second = await seal('aes-256-gcm', TEXT, { kind: 'generated', key: GENERATED });
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });
  test('two seals with the same password draw different salts', async () => {
    const first = await seal('aes-256-gcm', TEXT, { kind: 'password', password: PASSWORD });
    const second = await seal('aes-256-gcm', TEXT, { kind: 'password', password: PASSWORD });
    expect(saltOf(first)).not.toBe(saltOf(second));
  });
});

describe('the public-key self-check reads its key derivation back from the written text', () => {
  test('a salt written wrong is caught before the envelope is offered', async () => {
    const pair = await makeKeyPair();
    rereadWithKdf('salt', OTHER_SALT);
    await expect(seal('aes-256-gcm', TEXT, { kind: 'publickey', publicKey: pair.publicKey })).rejects.toMatchObject({ code: 'wrong-secret' });
  });
  test('an ephemeral key written wrong is caught before the envelope is offered', async () => {
    const pair = await makeKeyPair();
    rereadWithKdf('epk', OTHER_EPK);
    await expect(seal('aes-256-gcm', TEXT, { kind: 'publickey', publicKey: pair.publicKey })).rejects.toMatchObject({ code: 'wrong-secret' });
  });
});

describe('passwords', () => {
  test('a password typed with a decomposed accent opens what the composed one sealed', async () => {
    expect(await open(await seal('aes-256-gcm', TEXT, { kind: 'password', password: CAFE_COMPOSED }), { kind: 'password', password: CAFE_DECOMPOSED })).toEqual(TEXT);
  });
});

describe('a learning envelope opens only with its own kind of key', () => {
  test('Atbash refuses a shift', async () => {
    await expect(open(parse(ATBASH), { kind: 'shift', shift: '3' })).rejects.toMatchObject({ code: 'key-kind-unsupported' });
  });
});

describe('text is read back exactly', () => {
  test('a text that starts with a byte order mark seals and opens unchanged', async () => {
    expect(await open(await seal('aes-256-gcm', BOM_LED, { kind: 'generated', key: GENERATED }), { kind: 'generated', key: GENERATED })).toEqual(BOM_LED);
  });
  test('a text body that is not UTF-8 is garbled, not repaired', async () => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(PACKED_NOT_UTF8.buffer);
    await expect(seal('aes-256-gcm', TEXT, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'garbled' });
  });
  test('a header with a byte order mark in front is garbled', async () => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(PACKED_BOM_HEADER.buffer);
    await expect(seal('aes-256-gcm', TEXT, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'garbled' });
  });
});

describe('the self-check compares everything', () => {
  test('a file that comes back with one byte different is refused', async () => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(PACKED_ONE_BYTE_OFF.buffer);
    await expect(seal('aes-256-gcm', PHOTO, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'round-trip-failed' });
  });
  test('a file that comes back with another type is refused', async () => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(PACKED_OTHER_TYPE.buffer);
    await expect(seal('aes-256-gcm', PHOTO, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'round-trip-failed' });
  });
  test('a text that comes back as a file is refused', async () => {
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(PACKED_FILE_FOR_TEXT.buffer);
    await expect(seal('aes-256-gcm', TEXT, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'round-trip-failed' });
  });
  test('a 100,000-byte file round trips, past one 32 KiB base64 chunk', async () => {
    expect(await open(await seal('aes-256-gcm', BIG_FILE, { kind: 'generated', key: GENERATED }), { kind: 'generated', key: GENERATED })).toEqual(BIG_FILE);
  });
  test('a learning cipher counts its limit in UTF-8 bytes', async () => {
    await expect(seal('caesar', { kind: 'text', text: 'é'.repeat(524_289) }, { kind: 'shift', shift: '3' })).rejects.toMatchObject({ code: 'learn-too-large' });
  });
});

describe('edges of what can be sealed', () => {
  test('an empty file seals and opens back to the same empty file', async () => {
    const envelope = await seal('aes-256-gcm', EMPTY_FILE, { kind: 'generated', key: GENERATED });
    expect(await open(envelope, { kind: 'generated', key: GENERATED })).toEqual(EMPTY_FILE);
  });
  test('an AES seal refuses a text holding a lone surrogate, which UTF-8 cannot carry', async () => {
    await expect(seal('aes-256-gcm', { kind: 'text', text: `a${LONE_SURROGATE}b` }, { kind: 'generated', key: GENERATED })).rejects.toMatchObject({ code: 'round-trip-failed' });
  });
  test('an envelope given the wrong kind of secret is refused by kind, not tried', async () => {
    await expect(open(await seal('aes-256-gcm', TEXT, { kind: 'generated', key: GENERATED }), { kind: 'password', password: PASSWORD })).rejects.toMatchObject({ code: 'key-kind-unsupported' });
  });
});
