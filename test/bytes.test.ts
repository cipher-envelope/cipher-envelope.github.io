import { describe, expect, test } from 'vitest';
import { thrown } from './thrown';
import { equalBytes, fromBase64Url, isBase64Url } from '../src/crypto/bytes';

// Strict base64url gives each byte string exactly one spelling. "AA" is one zero byte; "AB" has the
// same byte with a stray bit in the part of its last character that no byte uses.

describe('strict base64url', () => {
  test('one byte, spelled canonically, is accepted', () => {
    expect(isBase64Url('AA')).toBe(true);
  });
  test('one byte with stray bits in its last character is refused', () => {
    expect(isBase64Url('AB')).toBe(false);
  });
  test('two bytes, spelled canonically, are accepted', () => {
    expect(isBase64Url('AAA')).toBe(true);
  });
  test('two bytes with stray bits in their last character are refused', () => {
    expect(isBase64Url('AAB')).toBe(false);
  });
  test('two bytes with the other stray bit set are refused', () => {
    expect(isBase64Url('AAC')).toBe(false);
  });
  test('one byte with the highest stray bit set is refused', () => {
    expect(isBase64Url('AI')).toBe(false);
  });
  test('a length no byte string has is refused', () => {
    expect(isBase64Url('AAAAA')).toBe(false);
  });
  test('padding is refused', () => {
    expect(isBase64Url('AA==')).toBe(false);
  });
  test("the standard alphabet's + is refused", () => {
    expect(isBase64Url('AA+A')).toBe(false);
  });
  test("the standard alphabet's / is refused", () => {
    expect(isBase64Url('AA/A')).toBe(false);
  });
  test('decoding refuses what the check refuses', () => {
    expect(thrown(fromBase64Url, 'AB')).toBeInstanceOf(RangeError);
  });
  test('decoding gives the bytes back', () => {
    expect(fromBase64Url('AQID')).toEqual(Uint8Array.from([1, 2, 3]));
  });
});

describe('comparing bytes', () => {
  test('a longer byte string is not equal to its prefix', () => {
    expect(equalBytes(Uint8Array.from([1, 2]), Uint8Array.from([1, 2, 0]))).toBe(false);
  });
  test('byte strings that differ only in their first byte are not equal', () => {
    expect(equalBytes(Uint8Array.from([1, 2]), Uint8Array.from([0, 2]))).toBe(false);
  });
  test('the same bytes are equal', () => {
    expect(equalBytes(Uint8Array.from([1, 2]), Uint8Array.from([1, 2]))).toBe(true);
  });
});
