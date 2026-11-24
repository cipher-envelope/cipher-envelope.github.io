import { describe, expect, test } from 'vitest';
import { thrown } from './thrown';
import { parse, serialize } from '../src/crypto/envelope';
import { gradeOf } from '../src/crypto/methods';
import gcmPublicKey from './golden/aes-256-gcm-publickey.json?raw';
import gcmKeyfile from './golden/aes-256-gcm-keyfile.json?raw';

const VALID = {
  format: 'cipher-envelope',
  version: 1,
  method: 'aes-256-gcm',
  opensWith: 'password',
  kdf: { id: 'pbkdf2-sha256', iterations: 600000, salt: 'AAECAwQFBgcICQoLDA0ODw' },
  nonce: 'oKGio6Slpqeoqaqr',
  // 16 bytes: an AES-GCM tag and nothing else, the shortest ciphertext AES-GCM gives.
  ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA',
};
// The same envelope under AES-256-CBC, whose nonce is 16 bytes.
const CBC = { ...VALID, method: 'aes-256-cbc', nonce: 'AAECAwQFBgcICQoLDA0ODw' };
const json = (value: unknown) => JSON.stringify(value);
const PUBLIC_KEY_ENVELOPE = JSON.parse(gcmPublicKey);
const KEY_FILE_ENVELOPE = JSON.parse(gcmKeyfile);
const CAESAR = { format: 'cipher-envelope', version: 1, method: 'caesar', opensWith: 'shift', ciphertext: 'KHOOR' };

describe('reading an envelope', () => {
  test('a valid envelope reads back unchanged', () => {
    expect(parse(json(VALID))).toEqual(VALID);
  });
  test('serialising and reading again is lossless', () => {
    expect(parse(serialize(parse(json(VALID))))).toEqual(VALID);
  });
  test('text that is not JSON is not an envelope', () => {
    expect(thrown(parse, 'hello')).toMatchObject({ code: 'not-envelope' });
  });
  test('another format is not an envelope', () => {
    expect(thrown(parse, json({ ...VALID, format: 'age' }))).toMatchObject({ code: 'not-envelope' });
  });
  test('a newer version is refused, naming the version', () => {
    expect(thrown(parse, json({ ...VALID, version: 2 }))).toMatchObject({ code: 'version-newer', detail: '2' });
  });
  test('an unknown method is refused, naming it', () => {
    expect(thrown(parse, json({ ...VALID, method: 'rot13' }))).toMatchObject({ code: 'method-unknown', detail: 'rot13' });
  });
  test('a stored grade is refused: the grade is never part of an envelope', () => {
    expect(thrown(parse, json({ ...VALID, grade: 'recommended' }))).toMatchObject({ code: 'field-unknown', detail: 'grade' });
  });
  test('a field that could carry a key is refused', () => {
    expect(thrown(parse, json({ ...VALID, key: 'AAAA' }))).toMatchObject({ code: 'field-unknown', detail: 'key' });
  });
  test('an unknown key derivation is refused, naming it, with no fallback', () => {
    expect(thrown(parse, json({ ...VALID, kdf: { id: 'argon2id', salt: 'AAECAwQFBgcICQoLDA0ODw' } }))).toMatchObject({ code: 'kdf-unknown', detail: 'argon2id' });
  });
  test('fewer PBKDF2 iterations than 600,000 are refused', () => {
    expect(thrown(parse, json({ ...VALID, kdf: { ...VALID.kdf, iterations: 1000 } }))).toMatchObject({ code: 'iterations-range', detail: '1000' });
  });
  test('a key kind the method does not take is refused', () => {
    expect(thrown(parse, json({ ...VALID, method: 'aes-256-cbc', opensWith: 'publickey' }))).toMatchObject({ code: 'field-invalid', detail: 'opensWith' });
  });
  test('a nonce of the wrong length is refused', () => {
    expect(thrown(parse, json({ ...VALID, nonce: 'AAAA' }))).toMatchObject({ code: 'field-invalid', detail: 'nonce' });
  });
  test('more PBKDF2 iterations than 10,000,000 are refused', () => {
    expect(thrown(parse, json({ ...VALID, kdf: { ...VALID.kdf, iterations: 10_000_001 } }))).toMatchObject({ code: 'iterations-range', detail: '10000001' });
  });
  test('599,999 PBKDF2 iterations are refused', () => {
    expect(thrown(parse, json({ ...VALID, kdf: { ...VALID.kdf, iterations: 599_999 } }))).toMatchObject({ code: 'iterations-range', detail: '599999' });
  });
  test('a version that is not a number is refused, naming it', () => {
    expect(thrown(parse, json({ ...VALID, version: '1' }))).toMatchObject({ code: 'version-invalid', detail: '1' });
  });
  test('a version that is an object is refused, named by its type', () => {
    expect(thrown(parse, json({ ...VALID, version: { toString: 1 } }))).toMatchObject({ code: 'version-invalid', detail: 'object' });
  });
  test('a method that is an object is refused, named by its type', () => {
    expect(thrown(parse, json({ ...VALID, method: { toString: 1 } }))).toMatchObject({ code: 'method-unknown', detail: 'object' });
  });
  test('a method named after a built-in property is unknown', () => {
    expect(thrown(parse, json({ ...VALID, method: '__proto__' }))).toMatchObject({ code: 'method-unknown', detail: '__proto__' });
  });
  test('a key derivation of another kind of key is refused', () => {
    expect(thrown(parse, json({ ...VALID, kdf: { id: 'hkdf-sha256', salt: VALID.kdf.salt } }))).toMatchObject({ code: 'field-invalid', detail: 'kdf.id' });
  });
  test('a generated-key envelope may not carry key-derivation parameters', () => {
    expect(thrown(parse, json({ ...VALID, opensWith: 'generated' }))).toMatchObject({ code: 'field-invalid', detail: 'kdf' });
  });
  test('a key-derivation field that could carry a key is refused', () => {
    expect(thrown(parse, json({ ...VALID, kdf: { ...VALID.kdf, key: 'AAAA' } }))).toMatchObject({ code: 'field-unknown', detail: 'kdf.key' });
  });
  test('a salt of the wrong length is refused', () => {
    expect(thrown(parse, json({ ...VALID, kdf: { ...VALID.kdf, salt: 'AAAA' } }))).toMatchObject({ code: 'field-invalid', detail: 'kdf.salt' });
  });
  test('a salt spelled with stray bits in its last character is refused', () => {
    expect(thrown(parse, json({ ...VALID, kdf: { ...VALID.kdf, salt: 'AAECAwQFBgcICQoLDA0ODx' } }))).toMatchObject({ code: 'field-invalid', detail: 'kdf.salt' });
  });
  test('an ephemeral key of the wrong length is refused', () => {
    expect(thrown(parse, json({ ...PUBLIC_KEY_ENVELOPE, kdf: { ...PUBLIC_KEY_ENVELOPE.kdf, epk: 'AAAA' } }))).toMatchObject({ code: 'field-invalid', detail: 'kdf.epk' });
  });
  test('a ciphertext outside the base64url alphabet is refused', () => {
    expect(thrown(parse, json({ ...VALID, ciphertext: 'AA+A' }))).toMatchObject({ code: 'field-invalid', detail: 'ciphertext' });
  });
  test('a classical envelope that opens with another kind of key is refused', () => {
    expect(thrown(parse, json({ ...CAESAR, opensWith: 'keyword' }))).toMatchObject({ code: 'field-invalid', detail: 'opensWith' });
  });
  test('a classical envelope may not carry a nonce', () => {
    expect(thrown(parse, json({ ...CAESAR, nonce: VALID.nonce }))).toMatchObject({ code: 'field-invalid', detail: 'nonce' });
  });
  test('a classical ciphertext over 2 MiB, longer than any seal gives, is refused', () => {
    expect(thrown(parse, json({ ...CAESAR, ciphertext: 'K'.repeat(2_097_153) }))).toMatchObject({ code: 'field-invalid', detail: 'ciphertext' });
  });
  test('a classical ciphertext of exactly 2 MiB is read', () => {
    expect(parse(json({ ...CAESAR, ciphertext: 'K'.repeat(2_097_152) }))).toMatchObject({ method: 'caesar' });
  });
  test('10,000,000 PBKDF2 iterations are read', () => {
    expect(parse(json({ ...VALID, kdf: { ...VALID.kdf, iterations: 10_000_000 } }))).toMatchObject({ kdf: { iterations: 10_000_000 } });
  });
  test('a password envelope without key-derivation parameters is refused, naming the field', () => {
    expect(thrown(parse, json({ ...VALID, kdf: undefined }))).toMatchObject({ code: 'field-invalid', detail: 'kdf' });
  });
  test('a key-file envelope with an extra key-derivation field is refused', () => {
    expect(thrown(parse, json({ ...KEY_FILE_ENVELOPE, kdf: { ...KEY_FILE_ENVELOPE.kdf, key: 'AAAA' } }))).toMatchObject({ code: 'field-unknown', detail: 'kdf.key' });
  });
  test('a public-key envelope with an extra key-derivation field is refused', () => {
    expect(thrown(parse, json({ ...PUBLIC_KEY_ENVELOPE, kdf: { ...PUBLIC_KEY_ENVELOPE.kdf, key: 'AAAA' } }))).toMatchObject({ code: 'field-unknown', detail: 'kdf.key' });
  });
  test('a key-derivation ID that is an object is refused, named by its type', () => {
    expect(thrown(parse, json({ ...VALID, kdf: { ...VALID.kdf, id: { toString: 1 } } }))).toMatchObject({ code: 'kdf-unknown', detail: 'object' });
  });
  test('iterations that are an object are refused, named by their type', () => {
    expect(thrown(parse, json({ ...VALID, kdf: { ...VALID.kdf, iterations: { toString: 1 } } }))).toMatchObject({ code: 'iterations-range', detail: 'object' });
  });
  test('a classical envelope may not carry key-derivation parameters', () => {
    expect(thrown(parse, json({ format: 'cipher-envelope', version: 1, method: 'caesar', opensWith: 'shift', kdf: VALID.kdf, ciphertext: 'X' }))).toMatchObject({ code: 'field-invalid', detail: 'kdf' });
  });
});

describe('grades come from the method, at read time', () => {
  test('AES-256-GCM is recommended', () => {
    expect(gradeOf('aes-256-gcm')).toBe('recommended');
  });
  test('AES-256-CBC is legacy', () => {
    expect(gradeOf('aes-256-cbc')).toBe('legacy');
  });
  test('Playfair is insecure', () => {
    expect(gradeOf('playfair')).toBe('insecure');
  });
});

describe('refusals the frozen v1 reader keeps', () => {
  test('a top-level null is not an envelope', () => {
    expect(thrown(parse, 'null')).toMatchObject({ code: 'not-envelope' });
  });
  test('a version of 1.5 is refused, naming it', () => {
    expect(thrown(parse, json({ ...VALID, version: 1.5 }))).toMatchObject({ code: 'version-invalid', detail: '1.5' });
  });
  test('a classical ciphertext that is not a string is refused', () => {
    expect(thrown(parse, json({ ...CAESAR, ciphertext: 5 }))).toMatchObject({ code: 'field-invalid', detail: 'ciphertext' });
  });
  test('a fractional iteration count is refused, naming it', () => {
    expect(thrown(parse, json({ ...VALID, kdf: { ...VALID.kdf, iterations: 600000.5 } }))).toMatchObject({ code: 'iterations-range', detail: '600000.5' });
  });
  test('a key-file salt of the wrong length is refused', () => {
    expect(thrown(parse, json({ ...KEY_FILE_ENVELOPE, kdf: { ...KEY_FILE_ENVELOPE.kdf, salt: 'AAAA' } }))).toMatchObject({ code: 'field-invalid', detail: 'kdf.salt' });
  });
  test('a public-key salt of the wrong length is refused', () => {
    expect(thrown(parse, json({ ...PUBLIC_KEY_ENVELOPE, kdf: { ...PUBLIC_KEY_ENVELOPE.kdf, salt: 'AAAA' } }))).toMatchObject({ code: 'field-invalid', detail: 'kdf.salt' });
  });
});

describe('an AES ciphertext has a length its cipher can give', () => {
  test('an AES-GCM ciphertext of 15 bytes, shorter than its tag, is refused', () => {
    expect(thrown(parse, json({ ...VALID, ciphertext: 'AAAAAAAAAAAAAAAAAAAA' }))).toMatchObject({ code: 'field-invalid', detail: 'ciphertext' });
  });
  test('an AES-GCM ciphertext of exactly its 16-byte tag is read', () => {
    expect(parse(json(VALID))).toMatchObject({ ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA' });
  });
  test('an empty AES ciphertext is refused', () => {
    expect(thrown(parse, json({ ...VALID, ciphertext: '' }))).toMatchObject({ code: 'field-invalid', detail: 'ciphertext' });
  });
  test('an AES-CBC ciphertext of 17 bytes, not whole blocks, is refused', () => {
    expect(thrown(parse, json({ ...CBC, ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAA' }))).toMatchObject({ code: 'field-invalid', detail: 'ciphertext' });
  });
  test('an AES-CBC ciphertext of two whole blocks, 32 bytes, is read', () => {
    expect(parse(json({ ...CBC, ciphertext: 'A'.repeat(43) }))).toMatchObject({ method: 'aes-256-cbc' });
  });
});
