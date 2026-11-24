// Every word the interface shows, in English, keyed by stable IDs. Methods, key kinds and error
// codes are keyed by their own types, so adding one without its words does not compile.

import { RAILS_MAX, RAILS_MIN, SHIFT_MAX, SHIFT_MIN } from '../crypto/classical';
import type { ErrorCode } from '../crypto/errors';
import { KEY_BYTES, PBKDF2_ITERATIONS, SALT_BYTES } from '../crypto/keys';
import type { DataKey, Grade, KeyKind, MethodId } from '../crypto/methods';

// Numbers the text states are read from the code that enforces them, so the two cannot disagree.
const count = (n: number) => n.toLocaleString('en');
const MIB = 1024 * 1024;
/** A limit in binary units, rounded down so it is never overstated: 64 MiB is 67,108,864 bytes. */
const size = (bytes: number) => (bytes >= MIB ? `${count(Math.floor((bytes / MIB) * 10) / 10)} MiB` : `${count(Math.floor(bytes / 1024))} KiB`);
/**
 * A value read from an envelope, as a sentence quotes it: whoever made the envelope chose it, so
 * control and format characters are removed and it is cut to 32 characters.
 */
function quoted(detail: string | undefined): string {
  // Cut to a bounded length first: the value can be megabytes long. A cut there is marked too, even
  // when removed characters leave fewer than 32 behind.
  const text = detail ?? '';
  const chars = Array.from(text.slice(0, 128).replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, ''));
  return chars.length > 32 || text.length > 128 ? `${chars.slice(0, 32).join('')}…` : chars.join('');
}
/** The limit an error names, which the crypto layer passes as its detail. */
const limit = (detail: string | undefined) => (detail === undefined ? 'the limit' : size(Number(detail)));

export const METHOD_TEXT: Record<MethodId, { readonly plain: string; readonly name: string; readonly about: string }> = {
  'aes-256-gcm': { plain: 'Strong lock', name: 'AES-256-GCM', about: 'Only the secret opens it, and tampering is detected.' },
  'aes-256-cbc': { plain: 'Old lock', name: 'AES-256-CBC', about: 'Hides it, but cannot tell if the envelope was changed.' },
  vigenere: { plain: 'Puzzle lock', name: 'Vigenère', about: 'A keyword shifts each letter. Solved by hand since 1863.' },
  caesar: { plain: 'Toy lock', name: 'Caesar', about: 'Every letter moves the same distance. Anyone can try all 25.' },
  atbash: { plain: 'Mirror lock', name: 'Atbash', about: 'A becomes Z, B becomes Y. There is no key at all.' },
  'rail-fence': { plain: 'Zigzag lock', name: 'Rail fence', about: 'The letters are written in a zigzag and read off row by row.' },
  playfair: { plain: 'Square lock', name: 'Playfair', about: 'Pairs of letters swap places in a 5 × 5 square. Drops spaces and case.' },
};

export const GRADE_TEXT: Record<Grade, string> = {
  recommended: 'Recommended',
  legacy: 'Legacy',
  insecure: 'Not secure',
};

export const KEY_TEXT: Record<KeyKind, { readonly short: string; readonly note: string }> = {
  password: { short: 'Password', note: 'Anyone who knows it can open the envelope. It is never stored: forget it and nobody can open it.' },
  generated: { short: 'Key', note: 'A random key, shown once. Save it before you seal: the envelope does not keep it. A copied key stays on the clipboard, and in any clipboard history, after you seal.' },
  keyfile: { short: 'File', note: 'Any file. It must stay byte-for-byte the same: a re-saved photo will not open the envelope.' },
  publickey: { short: 'Person', note: 'Only the person whose public key this is can open it. Not even you.' },
  shift: { short: 'Shift', note: `How far each letter moves along the alphabet, from ${SHIFT_MIN} to ${SHIFT_MAX}.` },
  keyword: { short: 'Keyword', note: 'A word. Only its letters A to Z count.' },
  rails: { short: 'Rails', note: `How many rows the zigzag uses, from ${RAILS_MIN} to ${RAILS_MAX}.` },
  none: { short: 'No key', note: 'Atbash has no key: anyone who knows the trick can open it.' },
};

export const ERROR_TEXT: Record<ErrorCode, (detail?: string) => string> = {
  'empty-input': () => 'There is nothing to seal yet.',
  'too-large': (max) => `That is larger than ${limit(max)}, the most this version seals in one go.`,
  'learn-too-large': (max) => `That is larger than ${limit(max)}, the most a learning cipher seals. The ${METHOD_TEXT['aes-256-gcm'].plain} seals more.`,
  'text-only': () => 'This lock works on typed text only, not on files.',
  'key-kind-unsupported': () => 'This lock cannot be opened that way.',
  'password-empty': () => 'Enter the password.',
  'generated-key-invalid': () => 'That is not a key made here: it must be 43 characters from this page.',
  'keyfile-missing': () => 'Choose the key file. An empty file cannot be a key.',
  'file-too-large': (max) => `That file is larger than ${limit(max)}, the most this page reads for it.`,
  'file-unreadable': () => 'That file could not be read. It may have moved, or the browser lost access to it.',
  'public-key-invalid': () => 'That is not a public key made here: it must be 43 characters.',
  'private-key-missing': () => 'Choose your private-key file.',
  'private-key-invalid': () => 'That is not a private-key file made here.',
  'x25519-unsupported': () => 'This browser cannot do public-key locking. Use a recent Chrome, Firefox or Safari.',
  'shift-range': () => `The shift must be a whole number from ${SHIFT_MIN} to ${SHIFT_MAX}.`,
  'keyword-letters': () => 'The keyword needs at least one letter from A to Z.',
  'rails-range': () => `The rails must be a whole number from ${RAILS_MIN} to ${RAILS_MAX}.`,
  'not-envelope': () => 'That is not an envelope. Paste the whole file.',
  'version-newer': (v) => `This envelope is version ${quoted(v)}, newer than this page understands. Open it with a newer copy of the page.`,
  'version-invalid': () => 'That envelope has no version this page understands.',
  'method-unknown': (m) => `This page does not know the method "${quoted(m)}", so it cannot open the envelope.`,
  'field-unknown': (f) => `That envelope has a field this page does not know: "${quoted(f)}". It was not opened.`,
  'field-invalid': (f) => `That envelope's "${quoted(f)}" is damaged.`,
  'kdf-unknown': (k) => `This page does not know the key derivation "${quoted(k)}", so it cannot open the envelope.`,
  'iterations-range': () => 'That envelope asks for a weaker or unreasonably slow password stretch. It was not opened.',
  'wrong-secret': () => 'Wrong secret, or the envelope was changed.',
  'unauthenticated-failed': () => 'Could not open it. The secret is wrong or the envelope was changed: this lock cannot tell which.',
  garbled: () => 'Opened, but the content is garbled: the secret is probably wrong.',
  'round-trip-failed': () => 'The envelope did not open back to what you sealed, so it was not offered.',
};

export const UI = {
  brand: 'cipher-envelope',
  framed: 'cipher-envelope does not run inside another page, so that page cannot watch or steer what you type into it.',
  framedOpen: 'To use it, open this address in a tab of its own:',
  viewSeal: 'Seal',
  viewOpen: 'Open',
  noWarranty: 'No warranty: you use this at your own risk.',
  noWarrantyLong: 'No warranty: you use this at your own risk, and nobody behind it takes responsibility for what you seal or lose.',
  alarmTitle: 'Not secure',
  alarmSeal: 'This is a learning cipher. Anyone can read what it seals. Never use it to protect anything.',
  alarmOpen: 'This envelope was sealed with a learning cipher. Anyone could have read it.',
  whatToSeal: 'What to seal',
  kindText: 'Text',
  kindFile: 'File or photo',
  letterLabel: 'Text to seal',
  letterPlaceholder: 'Write what you want to seal…',
  dropTitle: 'Drop a file or a photo here',
  dropOr: 'or',
  dropChoose: 'choose one',
  lock: 'Lock',
  learnRule: 'Learn: not secure',
  whoOpens: 'Who opens it',
  show: 'Show',
  hide: 'Hide',
  copy: 'Copy',
  copied: 'Copied',
  copyBlocked: 'Copying was blocked. It is selected for you to copy.',
  generate: 'Generate a key',
  savedGate: 'I saved this key somewhere safe',
  publicKeyLabel: 'Their public key',
  publicKeyPlaceholder: 'Paste their public key',
  makePair: 'Make my key pair',
  pairMade: (file: string) =>
    `Your key pair is ready, and the browser was asked to save ${file}. Check that it is in your downloads before you share the public key below. Keep that file safe: only it opens envelopes made for you.`,
  yourPublicKey: 'Your public key',
  details: 'Details',
  detailMethod: 'Method',
  detailKey: 'Key',
  detailNonce: 'Nonce',
  ack: 'I understand this protects nothing.',
  seal: 'Seal the envelope',
  open: 'Open the envelope',
  shortcut: 'or press Ctrl/⌘ + Enter',
  sealing: 'Sealing…',
  opening: 'Opening…',
  sealedStatus: 'Sealed, and the round trip checked out.',
  roundTrip: (bytes: number) => `Round trip checked: it opens back to the same ${bytes.toLocaleString('en')} bytes.`,
  roundTripNormalised: 'Round trip checked: it opens back to its letters, in capitals, as Playfair gives them.',
  roundTripPublicKey: 'Round trip checked from your side. Only the recipient can open it.',
  tabEnvelope: 'Envelope',
  tabHow: 'How it works',
  hidePanel: 'Hide panel',
  showPanel: 'Show panel',
  download: 'Download',
  copyText: 'Copy as text',
  holds: 'What the envelope holds',
  holdsNote: 'The method and what it needs to open again. Never your password or key.',
  envelopeToOpen: 'Envelope to open',
  pasteEnvelope: 'Paste an envelope here',
  chooseEnvelope: 'Or choose an envelope file',
  itsSecret: 'Its secret',
  privateKeyFile: 'Your private-key file',
  opensWith: (name: string, grade: string, kind: string) => `${name}, ${grade.toLowerCase()}. It opens with: ${kind.toLowerCase()}.`,
  openedEmpty: 'Paste or drop an envelope on the left, give its secret, and open it. What it holds appears here.',
  openedFile: 'Opened a file. The name it was sealed with:',
  fileCard: (name: string, bytes: number) => `${name} (${count(bytes)} bytes)`,
  saveFile: 'Save the file',
  learnGarbled: 'A learning cipher opens with any key: a wrong key gives nonsense, not an error.',
  learnNormalised: 'Playfair gives back letters only, in capitals, with J as I, and an X added between doubled letters and after an odd last letter, or a Q where that letter is X.',
  openedUnchecked: 'This lock cannot tell whether the envelope was changed after it was sealed, so what it opened may differ from what was sealed.',
  openedAnySender: 'Anyone who has your public key could have sealed this envelope, so it does not show who sent it.',
  whatHolds: 'What the envelope holds',
  shout: 'Not secure',
  shoutSmall: 'anyone can read this without the key',
  x25519Missing: ERROR_TEXT['x25519-unsupported'](),
  ariaView: 'View',
  ariaControls: 'Controls',
  ariaPassword: 'Password',
  ariaGeneratedKey: 'Generated key',
  ariaKey: 'Key',
  ariaKeyFile: 'Key file',
  ariaShift: 'Shift',
  ariaKeyword: 'Keyword',
  ariaRails: 'Rails',
  passwordPlaceholder: 'A long sentence works best',
  noKeyYet: 'No key yet',
  pasteKey: 'Paste the key',
  nonceDetail: (bytes: number) => `${bytes} random bytes, new every time`,
  noNonce: 'none',
  genericError: 'Something went wrong. Nothing was saved.',
  noWebCrypto: 'This browser offers no Web Crypto here, so nothing can be sealed or opened. Open the page over https, or as a file saved on this device.',
} as const;

/** The "Key" line of the Details disclosure, for each kind of key. */
export const DETAIL_TEXT: Record<KeyKind, string> = {
  password: `PBKDF2-SHA256, ${count(PBKDF2_ITERATIONS)} iterations, ${SALT_BYTES}-byte random salt`,
  generated: `${KEY_BYTES} random bytes, used directly`,
  keyfile: `HKDF-SHA256 over the file, ${SALT_BYTES}-byte random salt`,
  publickey: 'X25519 with a fresh key pair, then HKDF-SHA256',
  shift: `a shift of ${SHIFT_MIN} to ${SHIFT_MAX}`,
  keyword: 'the letters of the keyword',
  rails: 'the number of rails',
  none: 'none',
};

/** Words drawn inside the pictures. */
export const DRAWING_TEXT = {
  notSecure: 'Not secure',
  opensWith: {
    password: 'opens with a password',
    generated: 'opens with a generated key',
    keyfile: 'opens with a key file',
    publickey: 'opens with their private key',
    shift: 'opens with a shift',
    keyword: 'opens with a keyword',
    rails: 'opens with a rail count',
    none: 'opens with no key at all',
  } satisfies Record<KeyKind, string>,
  firstBox: { password: 'your password', generated: 'a generated key', keyfile: 'your key file', publickey: 'their public key' } satisfies Record<DataKey, string>,
  /** How each kind of key becomes an AES key; null when it is used as it is. */
  stretch: { password: `stretched ${count(PBKDF2_ITERATIONS)} times (PBKDF2)`, generated: null, keyfile: 'mixed into a key (HKDF)', publickey: 'agreed with X25519, then HKDF' } satisfies Record<DataKey, string | null>,
  usedDirectly: 'used as the key directly',
  randomSalt: 'random salt',
  aesKey: '256-bit key',
  randomNonce: 'random nonce',
  locks: (algorithm: string) => `${algorithm} locks it`,
  envelopeBox: 'envelope: method, salt, nonce, ciphertext',
  noTamperCheck: 'no tamper check',
  shift: (n: number) => `shift ${n}`,
  becomes: (letter: string) => `A becomes ${letter}`,
  rowMessage: 'message',
  rowKeyword: 'keyword',
  rowSealed: 'sealed',
  vigenereRepeats: 'The keyword repeats, so the pattern repeats.',
  vigenereBreaks: 'Find the repeat length and it falls apart.',
  atbashFold: 'The alphabet folded in half: A and Z swap, B and Y swap…',
  atbashNoKey: 'There is no key, so nothing is secret.',
  rails: (n: number) => `Written on ${n} rails, then read row by row.`,
  railsClamped: (n: number, shown: number) => `Written on ${n} rails (the drawing shows ${shown}), then read row by row.`,
  playfairFill: 'The keyword fills the square first. Pairs of letters',
  playfairMoves: 'swap corners, slide along a row, or slide down a column.',
} as const;
