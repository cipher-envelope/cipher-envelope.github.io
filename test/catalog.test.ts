import { describe, expect, test } from 'vitest';
import { DETAIL_TEXT, ERROR_TEXT } from '../src/ui/catalog';

// The numbers the interface states are read from the limits the code enforces.

// A value read from an envelope, as the error text quotes it.
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const BELL = String.fromCodePoint(7);
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
// Half of a surrogate pair, as a cut through the middle of an emoji leaves it.
const LONE_SURROGATE = String.fromCodePoint(0xd83d);

describe('values from an envelope, quoted in the text', () => {
  test('a long field name is cut to 32 characters', () => {
    expect(ERROR_TEXT['field-unknown']('abcdefghijklmnopqrstuvwxyz0123456789ABCD')).toBe('That envelope has a field this page does not know: "abcdefghijklmnopqrstuvwxyz012345…". It was not opened.');
  });
  test('a name of exactly 32 characters is quoted whole', () => {
    expect(ERROR_TEXT['field-unknown']('abcdefghijklmnopqrstuvwxyz012345')).toBe('That envelope has a field this page does not know: "abcdefghijklmnopqrstuvwxyz012345". It was not opened.');
  });
  test('a value cut before its invisible characters were removed is still marked as cut', () => {
    expect(ERROR_TEXT['field-unknown'](`${'a'.repeat(20)}${ZERO_WIDTH_SPACE.repeat(108)}${'b'.repeat(50)}`)).toBe('That envelope has a field this page does not know: "aaaaaaaaaaaaaaaaaaaa…". It was not opened.');
  });
  test('a value of exactly 128 units is not marked as cut', () => {
    expect(ERROR_TEXT['field-unknown'](`${BELL.repeat(96)}${'a'.repeat(32)}`)).toBe('That envelope has a field this page does not know: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa". It was not opened.');
  });
  test('a value of 129 units is cut at 128 and marked', () => {
    expect(ERROR_TEXT['field-unknown'](`${BELL.repeat(97)}${'a'.repeat(32)}`)).toBe('That envelope has a field this page does not know: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa…". It was not opened.');
  });
  test('half of a surrogate pair in a field name is removed', () => {
    expect(ERROR_TEXT['field-unknown'](`a${LONE_SURROGATE}b`)).toBe('That envelope has a field this page does not know: "ab". It was not opened.');
  });
  test('a control character in a field name is removed', () => {
    expect(ERROR_TEXT['field-unknown'](`a${BELL}b`)).toBe('That envelope has a field this page does not know: "ab". It was not opened.');
  });
  test('a line separator in a method name is removed', () => {
    expect(ERROR_TEXT['method-unknown'](`rot${LINE_SEPARATOR}13`)).toBe('This page does not know the method "rot13", so it cannot open the envelope.');
  });
  test('a direction control in a key-derivation name is removed', () => {
    expect(ERROR_TEXT['kdf-unknown'](`scrypt${RIGHT_TO_LEFT_OVERRIDE}`)).toBe('This page does not know the key derivation "scrypt", so it cannot open the envelope.');
  });
  test('a direction control in a method name is removed', () => {
    expect(ERROR_TEXT['method-unknown'](`rot${RIGHT_TO_LEFT_OVERRIDE}13`)).toBe('This page does not know the method "rot13", so it cannot open the envelope.');
  });
});

describe('numbers in the text', () => {
  test('the sealing limit is stated in binary units', () => {
    expect(ERROR_TEXT['too-large']('67108864')).toBe('That is larger than 64 MiB, the most this version seals in one go.');
  });
  test('a limit below a mebibyte is stated in kibibytes', () => {
    expect(ERROR_TEXT['file-too-large']('65536')).toBe('That file is larger than 64 KiB, the most this page reads for it.');
  });
  test('a limit that is not a whole number of mebibytes is rounded down to one decimal, never overstated', () => {
    expect(ERROR_TEXT['file-too-large']('89631403')).toBe('That file is larger than 85.4 MiB, the most this page reads for it.');
  });
  test('the password line states what sealing spends', () => {
    expect(DETAIL_TEXT.password).toBe('PBKDF2-SHA256, 600,000 iterations, 16-byte random salt');
  });
  test('the learning-cipher limit is stated as its own, in mebibytes', () => {
    expect(ERROR_TEXT['learn-too-large']('1048576')).toBe('That is larger than 1 MiB, the most a learning cipher seals. The Strong lock seals more.');
  });
  test('the rail range is the one the parser enforces', () => {
    expect(ERROR_TEXT['rails-range']()).toBe('The rails must be a whole number from 2 to 64.');
  });
  test('the shift range is the one the parser enforces', () => {
    expect(ERROR_TEXT['shift-range']()).toBe('The shift must be a whole number from 1 to 25.');
  });
});
