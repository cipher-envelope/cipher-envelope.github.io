import { describe, expect, test } from 'vitest';
import { thrown } from './thrown';
import { atbash, caesar, classicalExpected, normalises, parseKeyword, parseRails, parseShift, playfair, playfairSquare, railFence, vigenere } from '../src/crypto/classical';

// Expected values are the textbook examples for each cipher, or short cases worked by hand, never
// values computed by this code.

describe('Caesar', () => {
  test('a shift of 3 seals the pangram as in the textbook', () => {
    expect(caesar('THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG', 3, 'seal')).toBe('WKH TXLFN EURZQ IRA MXPSV RYHU WKH ODCB GRJ');
  });
  test('opening with the same shift gives the text back', () => {
    expect(caesar('WKH TXLFN EURZQ IRA MXPSV RYHU WKH ODCB GRJ', 3, 'open')).toBe('THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG');
  });
  test('case and everything but letters are kept', () => {
    expect(caesar('Zebra, 42!', 1, 'seal')).toBe('Afcsb, 42!');
  });
  test('a shift outside 1 to 25 is refused', () => {
    expect(thrown(parseShift, '26')).toMatchObject({ code: 'shift-range' });
  });
  test('a shift of 0 is refused', () => {
    expect(thrown(parseShift, '0')).toMatchObject({ code: 'shift-range' });
  });
  test('the lowest shift, 1, is accepted', () => {
    expect(parseShift('1')).toBe(1);
  });
  test('the highest shift, 25, is accepted', () => {
    expect(parseShift('25')).toBe(25);
  });
  test('a shift that is not a whole number is refused', () => {
    expect(thrown(parseShift, '2.5')).toMatchObject({ code: 'shift-range' });
  });
});

describe('Vigenère', () => {
  test('LEMON seals ATTACKATDAWN as in the textbook', () => {
    expect(vigenere('ATTACKATDAWN', 'LEMON', 'seal')).toBe('LXFOPVEFRNHR');
  });
  test('opening with LEMON gives the text back', () => {
    expect(vigenere('LXFOPVEFRNHR', 'LEMON', 'open')).toBe('ATTACKATDAWN');
  });
  test('the keyword advances only on letters', () => {
    expect(vigenere('AT TACK', 'LEMON', 'seal')).toBe('LX FOPV');
  });
  test('a keyword typed with a decomposed accent is the same key as with a composed one', () => {
    expect(parseKeyword(`cafe${String.fromCodePoint(0x301)}`)).toBe(parseKeyword(`caf${String.fromCodePoint(0xe9)}`));
  });
  test('an accented letter in a keyword does not count, even typed decomposed: "café" is CAF', () => {
    expect(parseKeyword(`cafe${String.fromCodePoint(0x301)}`)).toBe('CAF');
  });
  test('a ligature in a keyword does not count as its letters: NFC keeps it whole', () => {
    expect(parseKeyword(`caf ${String.fromCodePoint(0xfb01)}`)).toBe('CAF');
  });
  test('a keyword without letters is refused', () => {
    expect(thrown(parseKeyword, '123')).toMatchObject({ code: 'keyword-letters' });
  });
});

describe('Atbash', () => {
  test('WIZARD becomes DRAZIW', () => {
    expect(atbash('WIZARD')).toBe('DRAZIW');
  });
  test('it is its own inverse', () => {
    expect(atbash('DRAZIW')).toBe('WIZARD');
  });
  test('lower case stays lower case', () => {
    expect(atbash('wizard')).toBe('draziw');
  });
});

describe('Rail fence', () => {
  test('three rails seal the textbook message', () => {
    expect(railFence('WEAREDISCOVEREDRUNATONCE', 3, 'seal')).toBe('WECRUOERDSOEERNTNEAIVDAC');
  });
  test('three rails open it again', () => {
    expect(railFence('WECRUOERDSOEERNTNEAIVDAC', 3, 'open')).toBe('WEAREDISCOVEREDRUNATONCE');
  });
  test('spaces and punctuation travel with the letters', () => {
    expect(railFence('Meet me, 7pm.', 4, 'seal')).toBe('Me.em,me  pt7');
  });
  test('64 rails are accepted', () => {
    expect(parseRails('64')).toBe(64);
  });
  test('more than 64 rails are refused', () => {
    expect(thrown(parseRails, '65')).toMatchObject({ code: 'rails-range' });
  });
  test('the fewest rails, 2, are accepted', () => {
    expect(parseRails('2')).toBe(2);
  });
  test('fewer than two rails is refused', () => {
    expect(thrown(parseRails, '1')).toMatchObject({ code: 'rails-range' });
  });
});

describe('Playfair', () => {
  test('the square for "playfair example" matches the textbook', () => {
    expect(playfairSquare('playfair example').join('')).toBe('PLAYFIREXMBCDGHKNOQSTUVWZ');
  });
  test('it seals the textbook message', () => {
    expect(playfair('Hide the gold in the tree stump', 'playfair example', 'seal')).toBe('BMODZBXDNABEKUDMUIXMMOUVIF');
  });
  test('a doubled X is padded with Q, not X: XQ XQ, both in one column, slide down to GW GW', () => {
    expect(playfair('XX', 'playfair example', 'seal')).toBe('GWGW');
  });
  test('only the letters A to Z count, as in the keyword: ß is dropped, not turned into SS', () => {
    expect(classicalExpected('playfair', 'Maß')).toBe('MA');
  });
  test('Playfair gives back a normalised text', () => {
    expect(normalises('playfair')).toBe(true);
  });
  test('Caesar gives back the text itself', () => {
    expect(normalises('caesar')).toBe(false);
  });
  test('opening gives the normalised text, with the X filler', () => {
    expect(playfair('BMODZBXDNABEKUDMUIXMMOUVIF', 'playfair example', 'open')).toBe('HIDETHEGOLDINTHETREXESTUMP');
  });
});

describe('Playfair reads J as I', () => {
  test('a J in the text is sealed as I: "jump" under "monarchy" is EXOL, worked by hand', () => {
    expect(playfair('jump', 'monarchy', 'seal')).toBe('EXOL');
  });
  test('a J in the keyword is read as I: the square for "jackal"', () => {
    expect(playfairSquare('jackal').join('')).toBe('IACKLBDEFGHMNOPQRSTUVWXYZ');
  });
});
