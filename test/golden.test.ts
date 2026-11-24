import { describe, expect, test } from 'vitest';
import { parse, serialize } from '../src/crypto/envelope';
import { open } from '../src/crypto/seal';
import gcmPassword from './golden/aes-256-gcm-password.json?raw';
import gcmPassword650000 from './golden/aes-256-gcm-password-650000.json?raw';
import gcmPasswordNfc from './golden/aes-256-gcm-password-nfc.json?raw';
import cbcPassword from './golden/aes-256-cbc-password.json?raw';
import cbcGenerated from './golden/aes-256-cbc-generated.json?raw';
import cbcKeyfile from './golden/aes-256-cbc-keyfile.json?raw';
import gcmGeneratedFile from './golden/aes-256-gcm-generated-file.json?raw';
import gcmKeyfile from './golden/aes-256-gcm-keyfile.json?raw';
import gcmPublicKey from './golden/aes-256-gcm-publickey.json?raw';
import bobPrivateKey from './golden/aes-256-gcm-publickey.private-key.json?raw';
import caesarEnvelope from './golden/caesar.json?raw';
import vigenereEnvelope from './golden/vigenere.json?raw';
import atbashEnvelope from './golden/atbash.json?raw';
import railFenceEnvelope from './golden/rail-fence.json?raw';
import playfairEnvelope from './golden/playfair.json?raw';
import vigenereKeywordNfc from './golden/vigenere-keyword-nfc.json?raw';

// Version-1 envelopes built by scripts/golden-envelopes.mjs with Web Crypto directly, not with this
// code. Every release must keep opening them.

const TEXT = { kind: 'text', text: 'Meet me at the north gate at seven.' };
// The NFC sample's password typed with a decomposed é ("e" and a combining accent), and the ligature.
const NFC_SAMPLE_PASSWORD_DECOMPOSED = `cafe${String.fromCodePoint(0x301)} ${String.fromCodePoint(0xfb01)}`;
// The keyword sample's keyword, typed the same way.
const NFC_SAMPLE_KEYWORD_DECOMPOSED = NFC_SAMPLE_PASSWORD_DECOMPOSED;
const SAMPLE_FILE_BYTES = Uint8Array.from({ length: 64 }, (_, i) => 0x40 + i);

describe('version-1 envelopes still open', () => {
  test('AES-256-GCM, password', async () => {
    expect(await open(parse(gcmPassword), { kind: 'password', password: 'correct horse battery staple' })).toEqual(TEXT);
  });
  test("AES-256-GCM, password, at 650,000 iterations: opening uses the envelope's own count", async () => {
    expect(await open(parse(gcmPassword650000), { kind: 'password', password: 'correct horse battery staple' })).toEqual(TEXT);
  });
  test('AES-256-GCM, a non-ASCII password typed in another Unicode form: opening normalises it to NFC', async () => {
    expect(await open(parse(gcmPasswordNfc), { kind: 'password', password: NFC_SAMPLE_PASSWORD_DECOMPOSED })).toEqual(TEXT);
  });
  test('AES-256-CBC, password', async () => {
    expect(await open(parse(cbcPassword), { kind: 'password', password: 'correct horse battery staple' })).toEqual(TEXT);
  });
  test('AES-256-CBC, generated key', async () => {
    expect(await open(parse(cbcGenerated), { kind: 'generated', key: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA' })).toEqual(TEXT);
  });
  test('AES-256-CBC, key file', async () => {
    expect(await open(parse(cbcKeyfile), { kind: 'keyfile', file: new TextEncoder().encode('the key file for the sample envelope') })).toEqual(TEXT);
  });
  test('AES-256-GCM, generated key, a file', async () => {
    expect(await open(parse(gcmGeneratedFile), { kind: 'generated', key: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA' })).toEqual({
      kind: 'file',
      name: 'photo.jpg',
      type: 'image/jpeg',
      bytes: SAMPLE_FILE_BYTES,
    });
  });
  test('AES-256-GCM, key file', async () => {
    expect(await open(parse(gcmKeyfile), { kind: 'keyfile', file: new TextEncoder().encode('the key file for the sample envelope') })).toEqual(TEXT);
  });
  test('AES-256-GCM, public key, opened with the RFC 7748 recipient key', async () => {
    expect(await open(parse(gcmPublicKey), { kind: 'privatekey', file: bobPrivateKey })).toEqual(TEXT);
  });
  test('Caesar', async () => {
    expect(await open(parse(caesarEnvelope), { kind: 'shift', shift: '3' })).toEqual({ kind: 'text', text: 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG' });
  });
  test('Vigenère', async () => {
    expect(await open(parse(vigenereEnvelope), { kind: 'keyword', keyword: 'LEMON' })).toEqual({ kind: 'text', text: 'ATTACKATDAWN' });
  });
  test('Atbash', async () => {
    expect(await open(parse(atbashEnvelope), { kind: 'none' })).toEqual({ kind: 'text', text: 'WIZARD' });
  });
  test('Rail fence', async () => {
    expect(await open(parse(railFenceEnvelope), { kind: 'rails', rails: '3' })).toEqual({ kind: 'text', text: 'WEAREDISCOVEREDRUNATONCE' });
  });
  test('Playfair', async () => {
    expect(await open(parse(playfairEnvelope), { kind: 'keyword', keyword: 'playfair example' })).toEqual({ kind: 'text', text: 'HIDETHEGOLDINTHETREXESTUMP' });
  });
  test('Vigenère, a non-ASCII keyword typed in another Unicode form: only its letters A to Z count after NFC', async () => {
    expect(await open(parse(vigenereKeywordNfc), { kind: 'keyword', keyword: NFC_SAMPLE_KEYWORD_DECOMPOSED })).toEqual({ kind: 'text', text: 'ATTACKATDAWN' });
  });
});

describe('an envelope serialises back to exactly the text it was read from', () => {
  test('a password envelope', () => {
    expect(serialize(parse(gcmPassword))).toBe(gcmPassword);
  });
  test('a generated-key envelope holding a file', () => {
    expect(serialize(parse(gcmGeneratedFile))).toBe(gcmGeneratedFile);
  });
  test('a key-file envelope', () => {
    expect(serialize(parse(cbcKeyfile))).toBe(cbcKeyfile);
  });
  test('a public-key envelope', () => {
    expect(serialize(parse(gcmPublicKey))).toBe(gcmPublicKey);
  });
  test('a classical envelope', () => {
    expect(serialize(parse(railFenceEnvelope))).toBe(railFenceEnvelope);
  });
});
