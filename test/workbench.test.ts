// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { utf8 } from '../src/crypto/bytes';
import { parse, serialize } from '../src/crypto/envelope';
import { open, seal } from '../src/crypto/seal';
import { mountWorkbench } from '../src/ui/workbench';
import cbcGenerated from './golden/aes-256-cbc-generated.json?raw';
import gcmGeneratedFile from './golden/aes-256-gcm-generated-file.json?raw';
import gcmKeyfile from './golden/aes-256-gcm-keyfile.json?raw';
import gcmPassword from './golden/aes-256-gcm-password.json?raw';
import gcmPublicKey from './golden/aes-256-gcm-publickey.json?raw';
import bobPrivateKey from './golden/aes-256-gcm-publickey.private-key.json?raw';
import playfairEnvelope from './golden/playfair.json?raw';

// jsdom has no matchMedia; the workbench only asks it about phone width, motion and dark mode.
window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
// Nor object URLs, which every download makes.
URL.createObjectURL = () => 'blob:test';
URL.revokeObjectURL = () => undefined;
// Nor scrollIntoView, which a phone-width page calls after sealing and opening.
Element.prototype.scrollIntoView = () => undefined;
// What matchMedia answers to make every query match: a phone width, reduced motion and a dark
// scheme. The workbench reads only `matches`.
const EVERY_QUERY_MATCHES = { matches: true, media: '(max-width: 760px)', addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList;

let root: HTMLElement;
let unmount: () => void;
function el<T extends Element = HTMLElement>(selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`The workbench has no element matching ${selector}.`);
  return found;
}
const pick = (group: string, value: string) => {
  const radio = el<HTMLInputElement>(`input[name="${group}"][value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
};
const typeInto = (name: string, value: string) => {
  const field = el<HTMLInputElement>(`[data-ui="${name}"]`);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};
/** What a field sends on its own, such as the `change` a text field fires when it loses focus. */
const fire = (name: string, type: string) => el(`[data-ui="${name}"]`).dispatchEvent(new Event(type, { bubbles: true }));

/** Mounts the workbench again, for a test that must set something up before the page starts. */
const remount = () => {
  unmount();
  root = document.createElement('div');
  document.body.replaceChildren(root);
  unmount = mountWorkbench(root);
};
const WAIT = { timeout: 5000 };
/** Waits for a seal to be committed, and gives back the envelope text it wrote. */
const sealedEnvelope = async () => {
  await vi.waitFor(() => expect(el('[data-ui="envelope-json"]').textContent).not.toBe(''), WAIT);
  return el('[data-ui="envelope-json"]').textContent;
};
/** Waits for an open to show what the envelope holds, and gives that back. */
const openedText = async () => {
  await vi.waitFor(() => expect(el('[data-ui="opened"]').textContent).not.toBe(''), WAIT);
  return el('[data-ui="opened"]').textContent;
};
/** Waits for an opened file's name to show, in the element of its own it is shown in, and gives it back. */
const openedName = async () => {
  await vi.waitFor(() => expect(root.querySelector('.sender-name')).not.toBeNull(), WAIT);
  return el('.sender-name').textContent;
};
/** The page's own words before an opened file's name. */
const openedLead = () => el('[data-ui="opened"]').firstChild?.textContent;
/** Waits until the element named reads the text given. */
const reads = (name: string, text: string) => vi.waitFor(() => expect(el(`[data-ui="${name}"]`).textContent).toBe(text), WAIT);
/** Waits until something has been scrolled into view. */
const scrolled = (scroll: { mock: { calls: unknown[] } }) => vi.waitFor(() => expect(scroll.mock.calls.length).toBeGreaterThan(0), WAIT);
/** Gives the page a clipboard that accepts, as a secure page has one. Removed after each test. */
const grantClipboard = () => Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
/** Waits until the bottom bar's line reads the text given. */
const statusReads = (text: string) => vi.waitFor(() => expect(el('[data-ui="status"]').textContent).toBe(text), WAIT);
/** Waits until the envelope box holds the text given. */
const envelopeBoxReads = (text: string) => vi.waitFor(() => expect(el<HTMLTextAreaElement>('[data-ui="open-in"]').value).toBe(text), WAIT);
/** Waits until every call a spy has seen has settled, then for the work queued after them. */
const settled = async (spy: { mock: { results: { value: unknown }[] } }) => {
  await vi.waitFor(() => expect(spy.mock.results.length).toBeGreaterThan(0), WAIT);
  await Promise.allSettled(spy.mock.results.map((result) => result.value));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits until exactly one download has been offered. */
const offeredOnce = (download: { mock: { calls: unknown[] } }) => vi.waitFor(() => expect(download.mock.calls).toHaveLength(1), WAIT);
/** Drops a file on an element, as the browser reports a drop (jsdom has no DragEvent). */
const dropFile = (target: Element, file: File) => {
  const event = Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: { types: ['Files'], files: [file] } });
  target.dispatchEvent(event);
  return event;
};
const envelopeFile = (text: string, name = 'sealed.cipher-envelope.json') => new File([text], name, { type: 'application/json' });
/** A file whose text is held back until it is released, as a large file's is while it is read. */
const heldFile = (text: string) => {
  const gate = { release: () => {} };
  const held = new Promise<string>((resolve) => {
    gate.release = () => resolve(text);
  });
  return { file: Object.assign(envelopeFile(text), { text: () => held }), release: () => gate.release() };
};
/** A file the page sees as `size` bytes, without holding them. */
const sizedFile = (size: number, name: string) => Object.defineProperty(new File([''], name), 'size', { value: size });
/** Gives an input the file a user chose, with the events a browser sends: input, then change (jsdom has no file picker). */
const choose = (name: string, file: File) => {
  const input = el<HTMLInputElement>(`[data-ui="${name}"]`);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
/** Makes a drawing fail, as a bug in it would. */
const failing = () => {
  throw new Error('a drawing failed');
};
/** Drags a file over an element, and gives back the drop effect the page chose. */
const dragOver = (target: Element) => {
  const dataTransfer = { types: ['Files'], files: [], dropEffect: 'copy' };
  target.dispatchEvent(Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer }));
  return dataTransfer.dropEffect;
};
/** The text of the file the first download was given. */
const downloaded = async (objectUrl: { mock: { calls: unknown[][] } }) => {
  const blob = objectUrl.mock.calls[0]?.[0];
  return blob instanceof Blob ? blob.text() : '';
};
/** The type of the file the first download was given. */
const downloadedType = (objectUrl: { mock: { calls: unknown[][] } }) => {
  const blob = objectUrl.mock.calls[0]?.[0];
  return blob instanceof Blob ? blob.type : '';
};
/** Drags selected text over an element, and gives back the drop effect the page chose. */
const dragText = (target: Element) => {
  const dataTransfer = { types: ['text/plain'], files: [], dropEffect: 'copy' };
  target.dispatchEvent(Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer }));
  return dataTransfer.dropEffect;
};
/** Presses Ctrl+Enter, as a keyboard sends it. */
const pressCtrlEnter = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
/** Pastes an envelope, gives the key the named field takes, and clicks Open. */
const openEnvelope = (text: string, keyField: string, key: string) => {
  pick('view', 'open');
  typeInto('open-in', text);
  typeInto(keyField, key);
  el<HTMLButtonElement>('[data-ui="open"]').click();
};
/** Types a letter and a password, and clicks Seal. */
const sealLetter = (letter: string, password: string) => {
  typeInto('letter', letter);
  typeInto('password', password);
  el<HTMLButtonElement>('[data-ui="seal"]').click();
};
/** A file the browser can no longer read: it moved, or access was lost. */
const unreadableFile = () => Object.assign(envelopeFile(''), { text: () => Promise.reject(new DOMException('The file is gone.', 'NotReadableError')) });

const GENERATED_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
/** An envelope holding a file of the given name, sealed with GENERATED_KEY. */
const fileEnvelope = async (name: string) => serialize(await seal('aes-256-gcm', { kind: 'file', name, type: 'image/jpeg', bytes: Uint8Array.from([1, 2, 3]) }, { kind: 'generated', key: GENERATED_KEY }));
// A file whose name, as sealed, reads "photo" + U+202E + "gpj.exe": shown raw, it would read "photoexe.jpg".
const SPOOFED_NAME_ENVELOPE = await fileEnvelope(`photo${RIGHT_TO_LEFT_OVERRIDE}gpj.exe`);
const LONG_NAME_ENVELOPE = await fileEnvelope(`${'a'.repeat(130)}.pdf`);
const DOTTED_NAME_ENVELOPE = await fileEnvelope('..hidden');
const INVISIBLE_NAME_ENVELOPE = await fileEnvelope(`report${String.fromCodePoint(0x200b)}.pdf`);
const MARKUP_ENVELOPE = serialize(await seal('aes-256-gcm', { kind: 'text', text: '<b>x</b>' }, { kind: 'generated', key: GENERATED_KEY }));
const MARKUP_METHOD_ENVELOPE = '{"format":"cipher-envelope","version":1,"method":"<i>m</i>","opensWith":"none","ciphertext":"x"}';
const CAESAR_ENVELOPE = '{"format":"cipher-envelope","version":1,"method":"caesar","opensWith":"shift","ciphertext":"KHOOR"}';
const ZERO_WIDTH_NON_JOINER = String.fromCodePoint(0x200c);
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);
const HANGUL_FILLER = String.fromCodePoint(0x3164);
const PATH_NAME_ENVELOPE = await fileEnvelope('../secret/x.txt');
const BACKSLASH_NAME_ENVELOPE = await fileEnvelope('..\\secret\\x.txt');
const DOTS_ONLY_ENVELOPE = await fileEnvelope('...');
const VERY_LONG_NAME_ENVELOPE = await fileEnvelope(`${'a'.repeat(500)}.pdf`);
// Names over 120 characters whose extension, dot included, is 16 and 17 characters long.
const EXTENSION_16_ENVELOPE = await fileEnvelope(`${'a'.repeat(130)}.${'b'.repeat(15)}`);
const EXTENSION_17_ENVELOPE = await fileEnvelope(`${'a'.repeat(130)}.${'b'.repeat(16)}`);
const BLANK_PADDED_ENVELOPE = await fileEnvelope(`invoice.pdf${HANGUL_FILLER.repeat(3)}.exe`);
const NO_BREAK_SPACE_ENVELOPE = await fileEnvelope(`my${NO_BREAK_SPACE}report.pdf`);
const SPACE_ENVELOPE = await fileEnvelope('my report.pdf');
const JOINER_ENVELOPE = await fileEnvelope(`a${ZERO_WIDTH_NON_JOINER}b.pdf`);
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);
const RIGHT_TO_LEFT_ISOLATE = String.fromCodePoint(0x2067);
const BRAILLE_BLANK = String.fromCodePoint(0x2800);
const IDEOGRAPHIC_SPACE = String.fromCodePoint(0x3000);
const EM_SPACE = String.fromCodePoint(0x2003);
const VARIATION_SELECTOR = String.fromCodePoint(0xfe0f);
const HALF_A_PAIR = String.fromCodePoint(0xd83d);
const ISOLATE_NAME_ENVELOPE = await fileEnvelope(`a${RIGHT_TO_LEFT_ISOLATE}b.pdf`);
const BRAILLE_NAME_ENVELOPE = await fileEnvelope(`a${BRAILLE_BLANK}b.pdf`);
const IDEOGRAPHIC_SPACE_ENVELOPE = await fileEnvelope(`a${IDEOGRAPHIC_SPACE}b.pdf`);
const EM_SPACE_ENVELOPE = await fileEnvelope(`a${EM_SPACE}b.pdf`);
const ZWJ_NAME_ENVELOPE = await fileEnvelope(`a${ZERO_WIDTH_JOINER}b.pdf`);
const HALF_PAIR_NAME_ENVELOPE = await fileEnvelope(`a${HALF_A_PAIR}b.pdf`);
const LEADING_SPACES_ENVELOPE = await fileEnvelope('   report.pdf');
const SPACE_RUN_ENVELOPE = await fileEnvelope(`invoice.pdf${' '.repeat(5)}.exe`);
const JOINERS_ONLY_ENVELOPE = await fileEnvelope(`${ZERO_WIDTH_JOINER}${ZERO_WIDTH_NON_JOINER}`);
const LEADING_JOINER_ENVELOPE = await fileEnvelope(`${ZERO_WIDTH_JOINER}.bashrc`);
const MARKS_ONLY_ENVELOPE = await fileEnvelope(`${VARIATION_SELECTOR}${VARIATION_SELECTOR}`);
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
// Unassigned, and default-ignorable: a font shows nothing for it.
const UNASSIGNED_INVISIBLE = String.fromCodePoint(0x2065);
const JOINED_SPACE_RUN_ENVELOPE = await fileEnvelope(`invoice.pdf${` ${ZERO_WIDTH_JOINER}`.repeat(3)}.exe`);
const TWO_SPACES_ENVELOPE = await fileEnvelope('my  report.pdf');
const LINE_SEPARATOR_ENVELOPE = await fileEnvelope(`a${LINE_SEPARATOR}b.pdf`);
const UNASSIGNED_ONLY_ENVELOPE = await fileEnvelope(`${UNASSIGNED_INVISIBLE}${UNASSIGNED_INVISIBLE}`);
const TWO_INVISIBLES_RUN_ENVELOPE = await fileEnvelope(`invoice.pdf${` ${ZERO_WIDTH_JOINER}${ZERO_WIDTH_NON_JOINER}`.repeat(3)}.exe`);
// A name that would be an element if it were written as markup. Its "/" would become "_", so it has none.
const MARKUP_NAME_ENVELOPE = await fileEnvelope('<b>x.txt');
const GCM_PASSWORD_TEXT = gcmPassword.trim();
// "HELLO" with a shift of 5, worked by hand: the Seal side's own shift starts at 3.
const CAESAR_SHIFT_5_ENVELOPE = '{"format":"cipher-envelope","version":1,"method":"caesar","opensWith":"shift","ciphertext":"MJQQT"}';
// "Meet me, 7pm." on 4 rails, worked by hand: the Seal side's own rails start at 3.
const RAILS_4_ENVELOPE = '{"format":"cipher-envelope","version":1,"method":"rail-fence","opensWith":"rails","ciphertext":"Me.em,me  pt7"}';
// The key file the golden key-file samples were sealed with (scripts/golden-envelopes.mjs).
const GOLDEN_KEY_FILE = 'the key file for the sample envelope';
const GOLDEN_TEXT = 'Meet me at the north gate at seven.';
const NO_WEB_CRYPTO = 'This browser offers no Web Crypto here, so nothing can be sealed or opened. Open the page over https, or as a file saved on this device.';
const CONTROL = String.fromCodePoint(1);
const NEXT_LINE = String.fromCodePoint(0x85);
const LONE_SURROGATE = String.fromCodePoint(0xd800);
const ATBASH_ENVELOPE = '{"format":"cipher-envelope","version":1,"method":"atbash","opensWith":"none","ciphertext":"DRAZIW"}';
const GCM_ENVELOPE = '{"format":"cipher-envelope","version":1,"method":"aes-256-gcm","opensWith":"generated","nonce":"oKGio6Slpqeoqaqr","ciphertext":"AAAAAAAAAAAAAAAAAAAAAA"}';
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
const PHOTO = Uint8Array.from([1, 2, 3]);
const KEY_FILE_TEXT = 'a throwaway key file';
const WRONG_SECRET = 'Wrong secret, or the envelope was changed.';
// The RFC 7748 recipient's public key, as the golden private-key file gives it.
const BOB_PUBLIC_KEY = '3p7bfXt9wbTTW2HC7OQ1Nz-DQ8hbeGdNrfx-FG-IK08';

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  unmount = mountWorkbench(root);
});

afterEach(() => {
  unmount();
  Reflect.deleteProperty(navigator, 'clipboard'); // a test may have granted one
});

describe('the insecure state', () => {
  test('choosing a learning cipher marks the page insecure', () => {
    pick('method', 'caesar');
    expect(root.dataset.grade).toBe('insecure');
  });
  test('Seal stays locked until the acknowledgment is ticked', () => {
    pick('method', 'caesar');
    expect(el<HTMLButtonElement>('[data-ui="seal"]').disabled).toBe(true);
  });
  test('ticking the acknowledgment unlocks Seal', () => {
    pick('method', 'caesar');
    el<HTMLInputElement>('[data-ui="ack"]').click();
    expect(el<HTMLButtonElement>('[data-ui="seal"]').disabled).toBe(false);
  });
});

describe('keys follow the method', () => {
  test('a look at a Learn method keeps the chosen key for when the Strong lock is chosen again', () => {
    pick('key', 'keyfile');
    pick('method', 'caesar');
    pick('method', 'aes-256-gcm');
    expect(el<HTMLInputElement>('input[name="key"][value="keyfile"]').checked).toBe(true);
  });
  test('the Strong lock shows the data-key control', () => {
    expect(el('[data-ui="data-keys"]').hidden).toBe(false);
  });
  test('the Strong lock offers the public-key option once the browser shows it can do X25519', async () => {
    const check = vi.spyOn(crypto.subtle, 'generateKey');
    remount();
    await settled(check);
    expect(el<HTMLInputElement>('input[name="key"][value="publickey"]').disabled).toBe(false);
  });
  test('a learning cipher hides the data-key control', () => {
    pick('method', 'vigenere');
    expect(el('[data-ui="data-keys"]').hidden).toBe(true);
  });
  test('Caesar shows its shift field', () => {
    pick('method', 'caesar');
    expect(el('[data-panel="shift"]').hidden).toBe(false);
  });
  test('the Old lock does not offer the public-key option', () => {
    pick('method', 'aes-256-cbc');
    expect(el<HTMLInputElement>('input[name="key"][value="publickey"]').disabled).toBe(true);
  });
  test('a generated key locks Seal until it is marked as saved', () => {
    pick('key', 'generated');
    expect(el<HTMLButtonElement>('[data-ui="seal"]').disabled).toBe(true);
  });
  test('marking a generated key as saved unlocks Seal', () => {
    pick('key', 'generated');
    el<HTMLButtonElement>('[data-ui="generate"]').click();
    el<HTMLInputElement>('[data-ui="gate"]').click();
    expect(el<HTMLButtonElement>('[data-ui="seal"]').disabled).toBe(false);
  });
  test('a learning cipher with "File or photo" chosen locks Seal', () => {
    pick('kind', 'file');
    pick('method', 'atbash');
    el<HTMLInputElement>('[data-ui="ack"]').click();
    expect(el<HTMLButtonElement>('[data-ui="seal"]').disabled).toBe(true);
  });
});

describe('pasting an envelope', () => {
  test('a pasted envelope with an unknown method is refused by name', () => {
    pick('view', 'open');
    typeInto('open-in', '{"format":"cipher-envelope","version":1,"method":"rot13","opensWith":"none","ciphertext":"x"}');
    expect(el('[data-ui="open-needs"]').textContent).toBe('This page does not know the method "rot13", so it cannot open the envelope.');
  });
  test('a pasted Learn envelope raises the open-side alarm', () => {
    pick('view', 'open');
    typeInto('open-in', '{"format":"cipher-envelope","version":1,"method":"atbash","opensWith":"none","ciphertext":"DRAZIW"}');
    expect(root.dataset.grade).toBe('insecure');
  });
});

describe('the right panel shows the envelope being opened', () => {
  test('opening an Atbash envelope draws Atbash in "How it works"', () => {
    pick('view', 'open');
    typeInto('open-in', ATBASH_ENVELOPE);
    expect(el('[data-ui="how-art"]').textContent).toContain('The alphabet folded in half');
  });
  test('with the seal side on Caesar, an AES envelope being opened is not marked insecure', () => {
    pick('method', 'caesar');
    pick('view', 'open');
    typeInto('open-in', GCM_ENVELOPE);
    expect(root.dataset.grade).toBe('recommended');
  });
});

describe('a seal is never committed from inputs that changed while it ran', () => {
  test('editing the password during sealing leaves nothing sealed', async () => {
    typeInto('letter', 'Meet me at seven.');
    typeInto('password', 'the first password');
    const selfCheck = vi.spyOn(crypto.subtle, 'decrypt');
    el<HTMLButtonElement>('[data-ui="seal"]').click();
    typeInto('password', 'a different password');
    await settled(selfCheck);
    expect(el('[data-ui="envelope-json"]').textContent).toBe('');
  });
});

describe('a finished seal stays until something that went into it changes', () => {
  test('the password field losing focus after sealing keeps the envelope', async () => {
    typeInto('letter', 'Meet me at seven.');
    typeInto('password', 'a throwaway sentence for the tests');
    el<HTMLButtonElement>('[data-ui="seal"]').click();
    await sealedEnvelope();
    fire('password', 'change');
    expect(el('[data-ui="envelope-json"]').textContent).toContain('"method": "aes-256-gcm"');
  });
  test('editing the password after sealing clears the envelope', async () => {
    typeInto('letter', 'Meet me at seven.');
    typeInto('password', 'a throwaway sentence for the tests');
    el<HTMLButtonElement>('[data-ui="seal"]').click();
    await sealedEnvelope();
    typeInto('password', 'a different password');
    expect(el('[data-ui="envelope-json"]').textContent).toBe('');
  });
});

describe('the drawings never stop the page', () => {
  test('a control character in the letter still seals with Rail fence', async () => {
    pick('method', 'rail-fence');
    el<HTMLInputElement>('[data-ui="ack"]').click();
    typeInto('letter', 'Meet\u0001 me');
    el<HTMLButtonElement>('[data-ui="seal"]').click();
    expect(await sealedEnvelope()).toContain('"method": "rail-fence"');
  });
});

describe('without X25519', () => {
  test('the public-key option is withdrawn', async () => {
    const check = vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValue(new DOMException('Unrecognized name', 'NotSupportedError'));
    remount();
    await settled(check);
    expect(el<HTMLInputElement>('input[name="key"][value="publickey"]').disabled).toBe(true);
  });
  test('the note shows for the Strong lock', async () => {
    const check = vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValue(new DOMException('Unrecognized name', 'NotSupportedError'));
    remount();
    await settled(check);
    expect(el('[data-ui="x25519-note"]').hidden).toBe(false);
  });
  test('the note does not show for the Old lock, which never offers a public key', async () => {
    const check = vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValue(new DOMException('Unrecognized name', 'NotSupportedError'));
    remount();
    await settled(check);
    pick('method', 'aes-256-cbc');
    expect(el('[data-ui="x25519-note"]').hidden).toBe(true);
  });
});

describe('the seal controls', () => {
  test('leaving the Learn ciphers unticks the acknowledgment', () => {
    pick('method', 'caesar');
    el<HTMLInputElement>('[data-ui="ack"]').click();
    pick('method', 'aes-256-gcm');
    pick('method', 'caesar');
    expect(el<HTMLInputElement>('[data-ui="ack"]').checked).toBe(false);
  });
  test('a new generated key unticks "I saved this key"', () => {
    pick('key', 'generated');
    el<HTMLInputElement>('[data-ui="gate"]').click();
    el<HTMLButtonElement>('[data-ui="generate"]').click();
    expect(el<HTMLInputElement>('[data-ui="gate"]').checked).toBe(false);
  });
  test('Show reveals the password', () => {
    el<HTMLButtonElement>('[data-ui="pw-toggle"]').click();
    expect(el<HTMLInputElement>('[data-ui="password"]').type).toBe('text');
  });
  test('making a key pair offers its private-key file', async () => {
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    el<HTMLButtonElement>('[data-ui="make-pair"]').click();
    await offeredOnce(download);
    expect(download.mock.contexts[0]).toHaveProperty('download', 'cipher-envelope-private-key.json');
  });
  test('Playfair says the round trip gives back letters, not the text', async () => {
    pick('method', 'playfair');
    el<HTMLInputElement>('[data-ui="ack"]').click();
    typeInto('keyword', 'playfair example');
    typeInto('letter', 'Hide the gold');
    el<HTMLButtonElement>('[data-ui="seal"]').click();
    await sealedEnvelope();
    expect(el('[data-ui="roundtrip"]').textContent).toBe('Round trip checked: it opens back to its letters, in capitals, as Playfair gives them.');
  });
  test('a seal finishing while Open is shown leaves the Open line alone', async () => {
    typeInto('letter', 'Meet me at seven.');
    typeInto('password', 'a throwaway sentence for the tests');
    el<HTMLButtonElement>('[data-ui="seal"]').click();
    pick('view', 'open');
    await sealedEnvelope();
    expect(el('[data-ui="status"]').textContent).toBe('');
  });
});

describe('"How it works" for a key that does not parse', () => {
  test('a Caesar shift of 0 is drawn with the textbook shift of 3', () => {
    pick('method', 'caesar');
    typeInto('shift', '0');
    expect(el('[data-ui="how-art"]').textContent).toContain('shift 3');
  });
  test('more rails than the zigzag can show are named in the caption', () => {
    pick('method', 'rail-fence');
    typeInto('rails', '20');
    expect(el('[data-ui="how-art"]').textContent).toContain('Written on 20 rails (the drawing shows 12), then read row by row.');
  });
});

describe('opening', () => {
  test('an Atbash envelope opens to what it holds', async () => {
    pick('view', 'open');
    typeInto('open-in', ATBASH_ENVELOPE);
    el<HTMLButtonElement>('[data-ui="open"]').click();
    expect(await openedText()).toBe('WIZARD');
  });
  test('Open waits, and says so, while it runs', async () => {
    pick('view', 'open');
    typeInto('open-in', gcmPassword);
    typeInto('open-password', 'correct horse battery staple');
    el<HTMLButtonElement>('[data-ui="open"]').click();
    expect(el('[data-ui="status"]').textContent).toBe('Opening…');
    expect(el<HTMLButtonElement>('[data-ui="open"]').disabled).toBe(true);
    expect(await openedText()).toBe('Meet me at the north gate at seven.');
  });
  test('the same text entered again keeps an open that is running', async () => {
    pick('view', 'open');
    typeInto('open-in', ATBASH_ENVELOPE);
    el<HTMLButtonElement>('[data-ui="open"]').click();
    typeInto('open-in', ATBASH_ENVELOPE);
    expect(await openedText()).toBe('WIZARD');
  });
  test('an open still running for an envelope that was replaced shows nothing', async () => {
    pick('view', 'open');
    typeInto('open-in', gcmPassword);
    typeInto('open-password', 'a wrong password');
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt');
    el<HTMLButtonElement>('[data-ui="open"]').click();
    typeInto('open-in', ATBASH_ENVELOPE);
    await settled(decrypt);
    expect(el('[data-ui="status"]').textContent).toBe('');
  });
  test('an opened file is saved as plain bytes, whatever type the envelope names', async () => {
    pick('view', 'open');
    typeInto('open-in', gcmGeneratedFile);
    typeInto('open-generated', GENERATED_KEY);
    el<HTMLButtonElement>('[data-ui="open"]').click();
    await openedText();
    const objectUrl = vi.spyOn(URL, 'createObjectURL');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    el<HTMLButtonElement>('[data-ui="save-opened"]').click();
    expect(downloadedType(objectUrl)).toBe('application/octet-stream');
  });
  test('a password envelope shows the password field', () => {
    pick('view', 'open');
    typeInto('open-in', gcmPassword);
    expect(el('[data-open-panel="password"]').hidden).toBe(false);
  });
  test('a password envelope hides the generated-key field', () => {
    pick('view', 'open');
    typeInto('open-in', gcmPassword);
    expect(el('[data-open-panel="generated"]').hidden).toBe(true);
  });
  test('Ctrl+Enter opens on the Open side', async () => {
    pick('view', 'open');
    typeInto('open-in', ATBASH_ENVELOPE);
    pressCtrlEnter();
    expect(await openedText()).toBe('WIZARD');
  });
  test('a pasted envelope with a byte order mark and a line break around it is read', () => {
    pick('view', 'open');
    typeInto('open-in', `${BYTE_ORDER_MARK}${ATBASH_ENVELOPE}\n`);
    expect(el('[data-ui="open-needs"]').textContent).toBe('Mirror lock (Atbash), not secure. It opens with: no key.');
  });
  test('a file name with a right-to-left override is shown with the override replaced', async () => {
    pick('view', 'open');
    typeInto('open-in', SPOOFED_NAME_ENVELOPE);
    typeInto('open-generated', GENERATED_KEY);
    el<HTMLButtonElement>('[data-ui="open"]').click();
    expect(await openedName()).toBe('photo_gpj.exe');
  });
  test('a file name with a right-to-left override is saved with the override replaced', async () => {
    pick('view', 'open');
    typeInto('open-in', SPOOFED_NAME_ENVELOPE);
    typeInto('open-generated', GENERATED_KEY);
    el<HTMLButtonElement>('[data-ui="open"]').click();
    await openedText();
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    el<HTMLButtonElement>('[data-ui="save-opened"]').click();
    expect(download.mock.contexts[0]).toHaveProperty('download', 'photo_gpj.exe');
  });
});

describe('dropped and chosen envelope files', () => {
  test('a file dropped on the letter is refused, so the browser does not leave the page', () => {
    expect(dropFile(el('[data-ui="letter"]'), envelopeFile(ATBASH_ENVELOPE)).defaultPrevented).toBe(true);
  });
  test('an envelope dropped on "Envelope to open" is read into the box', async () => {
    pick('view', 'open');
    dropFile(el('[data-ui="open-source"]'), envelopeFile(ATBASH_ENVELOPE));
    await envelopeBoxReads(ATBASH_ENVELOPE);
    expect(el('[data-ui="open-needs"]').textContent).toBe('Mirror lock (Atbash), not secure. It opens with: no key.');
  });
  test('a file dropped elsewhere on the Open side is not read', () => {
    pick('view', 'open');
    const read = vi.spyOn(Blob.prototype, 'text');
    dropFile(el('[data-ui="opened"]'), envelopeFile(ATBASH_ENVELOPE));
    expect(read).not.toHaveBeenCalled();
  });
  test('a private-key file dropped as an envelope is refused without being shown', async () => {
    pick('view', 'open');
    dropFile(el('[data-ui="open-source"]'), envelopeFile(bobPrivateKey, 'cipher-envelope-private-key.json'));
    await statusReads('That is not an envelope. Paste the whole file.');
    expect(el<HTMLTextAreaElement>('[data-ui="open-in"]').value).toBe('');
  });
  test('a file the browser cannot read says so', async () => {
    pick('view', 'open');
    dropFile(el('[data-ui="open-source"]'), unreadableFile());
    await statusReads('That file could not be read. It may have moved, or the browser lost access to it.');
  });
  test('the envelope dropped last wins, even when an earlier one finishes reading after it', async () => {
    pick('view', 'open');
    const earlier = heldFile(gcmPassword);
    dropFile(el('[data-ui="open-source"]'), earlier.file);
    dropFile(el('[data-ui="open-source"]'), envelopeFile(ATBASH_ENVELOPE));
    await envelopeBoxReads(ATBASH_ENVELOPE);
    earlier.release();
    await pause(0);
    expect(el<HTMLTextAreaElement>('[data-ui="open-in"]').value).toBe(ATBASH_ENVELOPE);
  });
  test('pasting the envelope already in the box lets a file still being read finish', async () => {
    pick('view', 'open');
    typeInto('open-in', ATBASH_ENVELOPE);
    const later = heldFile(gcmPassword);
    dropFile(el('[data-ui="open-source"]'), later.file);
    typeInto('open-in', ATBASH_ENVELOPE);
    later.release();
    await envelopeBoxReads(GCM_PASSWORD_TEXT);
  });
  test('a paste replaces an envelope file still being read', async () => {
    pick('view', 'open');
    const earlier = heldFile(gcmPassword);
    dropFile(el('[data-ui="open-source"]'), earlier.file);
    typeInto('open-in', ATBASH_ENVELOPE);
    earlier.release();
    await pause(0);
    expect(el<HTMLTextAreaElement>('[data-ui="open-in"]').value).toBe(ATBASH_ENVELOPE);
  });
  test('the same envelope dropped again keeps an open that is running', async () => {
    pick('view', 'open');
    typeInto('open-in', ATBASH_ENVELOPE);
    el<HTMLButtonElement>('[data-ui="open"]').click();
    dropFile(el('[data-ui="open-source"]'), envelopeFile(ATBASH_ENVELOPE));
    expect(await openedText()).toBe('WIZARD');
  });
  test('an envelope file is put in the box without the line break it ends with', async () => {
    pick('view', 'open');
    dropFile(el('[data-ui="open-source"]'), envelopeFile(`${ATBASH_ENVELOPE}\n`));
    await envelopeBoxReads(ATBASH_ENVELOPE);
  });
  test('selected text dragged over the letter is left to the browser', () => {
    expect(dragText(el('[data-ui="letter"]'))).toBe('copy');
  });
  test('a file dragged outside "Envelope to open" on the Open side is shown as refused', () => {
    pick('view', 'open');
    expect(dragOver(el('[data-ui="opened"]'))).toBe('none');
  });
  test('a file dragged over "Envelope to open" is accepted', () => {
    pick('view', 'open');
    expect(dragOver(el('[data-ui="open-source"]'))).toBe('copy');
  });
  test('an envelope file over its limit is refused before it is read', async () => {
    pick('view', 'open');
    const read = vi.spyOn(Blob.prototype, 'text');
    dropFile(el('[data-ui="open-source"]'), sizedFile(89_631_404, 'huge.json'));
    await statusReads('That file is larger than 85.4 MiB, the most this page reads for it.');
    expect(read).not.toHaveBeenCalled();
  });
  test('a refused envelope file names an unknown method as text, never as markup', async () => {
    pick('view', 'open');
    dropFile(el('[data-ui="open-source"]'), envelopeFile(MARKUP_METHOD_ENVELOPE));
    await statusReads('This page does not know the method "<i>m</i>", so it cannot open the envelope.');
  });
});

describe('the drawings never stop the page, whatever is typed', () => {
  test('a control character is drawn as "?"', () => {
    pick('method', 'rail-fence');
    typeInto('letter', `Meet${CONTROL} me`);
    expect(el('[data-ui="how-art"]').textContent).toContain('?');
  });
  test('a next-line character is drawn as "?"', () => {
    pick('method', 'rail-fence');
    typeInto('letter', `Meet${NEXT_LINE} me`);
    expect(el('[data-ui="how-art"]').textContent).toContain('?');
  });
  test('a lone surrogate is drawn as "?"', () => {
    pick('method', 'rail-fence');
    typeInto('letter', `Meet${LONE_SURROGATE} me`);
    expect(el('[data-ui="how-art"]').textContent).toContain('?');
  });
  test('a one-character letter is drawn with the example', () => {
    pick('method', 'rail-fence');
    typeInto('letter', 'A');
    expect(el('[data-ui="how-art"]').textContent).toContain('Written on 3 rails, then read row by row.');
  });
  test('a one-character letter seals with Rail fence', async () => {
    pick('method', 'rail-fence');
    el<HTMLInputElement>('[data-ui="ack"]').click();
    typeInto('letter', 'A');
    el<HTMLButtonElement>('[data-ui="seal"]').click();
    expect(await sealedEnvelope()).toContain('"method": "rail-fence"');
  });
  test('the envelope of a learning cipher is stamped "Not secure"', () => {
    pick('method', 'caesar');
    expect(el('[data-ui="envelope-art"]').textContent).toContain('Not secure');
  });
  test('the envelope of the Old lock is not stamped "Not secure"', () => {
    pick('method', 'aes-256-cbc');
    expect(el('[data-ui="envelope-art"]').textContent).not.toContain('Not secure');
  });
  test('"How it works" for a generated key says it is used as the key directly', () => {
    pick('key', 'generated');
    expect(el('[data-ui="how-art"]').textContent).toContain('used as the key directly');
  });
  test('"How it works" for the Old lock says it has no tamper check', () => {
    pick('method', 'aes-256-cbc');
    expect(el('[data-ui="how-art"]').textContent).toContain('no tamper check');
  });
});

describe('sealing', () => {
  test('Seal waits while a seal runs', async () => {
    sealLetter('Meet me at seven.', 'a throwaway sentence for the tests');
    expect(el<HTMLButtonElement>('[data-ui="seal"]').disabled).toBe(true);
    await sealedEnvelope(); // the seal ends in this test, not in the next one
  });
  test('Ctrl+Enter seals', async () => {
    typeInto('letter', 'Meet me at seven.');
    typeInto('password', 'a throwaway sentence for the tests');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    expect(await sealedEnvelope()).toContain('"method": "aes-256-gcm"');
  });
  test('a finished seal says so', async () => {
    sealLetter('Meet me at seven.', 'a throwaway sentence for the tests');
    await sealedEnvelope();
    expect(el('[data-ui="status"]').textContent).toBe('Sealed, and the round trip checked out.');
  });
  test('Seal with no password says what is missing', async () => {
    sealLetter('Meet me at seven.', '');
    await statusReads('Enter the password.');
  });
  test('the Seal line is still there after a visit to Open', async () => {
    sealLetter('Meet me at seven.', '');
    await statusReads('Enter the password.');
    pick('view', 'open');
    pick('view', 'seal');
    expect(el('[data-ui="status"]').textContent).toBe('Enter the password.');
  });
  test('a seal that fails after its inputs changed shows nothing', async () => {
    sealLetter('Meet me at seven.', '');
    typeInto('letter', 'Meet me at eight.');
    await pause(20);
    expect(el('[data-ui="status"]').textContent).toBe('');
  });
  test('editing the letter after sealing clears the envelope', async () => {
    sealLetter('Meet me at seven.', 'a throwaway sentence for the tests');
    await sealedEnvelope();
    typeInto('letter', 'Meet me at eight.');
    expect(el('[data-ui="envelope-json"]').textContent).toBe('');
  });
  test('Download saves the envelope exactly as shown', async () => {
    sealLetter('Meet me at seven.', 'a throwaway sentence for the tests');
    const shown = await sealedEnvelope();
    const objectUrl = vi.spyOn(URL, 'createObjectURL');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    el<HTMLButtonElement>('[data-ui="download"]').click();
    expect(await downloaded(objectUrl)).toBe(shown);
  });
  test('Download names the file sealed.cipher-envelope.json', async () => {
    sealLetter('Meet me at seven.', 'a throwaway sentence for the tests');
    await sealedEnvelope();
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    el<HTMLButtonElement>('[data-ui="download"]').click();
    expect(download.mock.contexts[0]).toHaveProperty('download', 'sealed.cipher-envelope.json');
  });
  test('a learning cipher refuses more than 1 MiB, saying the Strong lock seals more', async () => {
    pick('method', 'caesar');
    el<HTMLInputElement>('[data-ui="ack"]').click();
    typeInto('letter', 'A'.repeat(1_048_577));
    el<HTMLButtonElement>('[data-ui="seal"]').click();
    await statusReads('That is larger than 1 MiB, the most a learning cipher seals. The Strong lock seals more.');
  });
  test('a file over 64 MiB is refused before Seal can run', () => {
    pick('kind', 'file');
    dropFile(el('[data-ui="drop"]'), sizedFile(67_108_865, 'big.bin'));
    expect(el('[data-ui="status"]').textContent).toBe('That is larger than 64 MiB, the most this version seals in one go.');
  });
  test('a key file over 64 MiB is refused', async () => {
    pick('key', 'keyfile');
    choose('keyfile', sizedFile(67_108_865, 'key.bin'));
    typeInto('letter', 'Meet me at seven.');
    el<HTMLButtonElement>('[data-ui="seal"]').click();
    await statusReads('That file is larger than 64 MiB, the most this page reads for it.');
  });
  test('a public-key choice made before the check falls back to a password when X25519 is missing', async () => {
    const check = vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValue(new DOMException('Unrecognized name', 'NotSupportedError'));
    remount();
    pick('key', 'publickey');
    await settled(check);
    expect(el<HTMLInputElement>('input[name="key"][value="password"]').checked).toBe(true);
  });
  test('a key pair finished after the page is removed offers no file', async () => {
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    const exported = vi.spyOn(crypto.subtle, 'exportKey');
    el<HTMLButtonElement>('[data-ui="make-pair"]').click();
    unmount();
    await settled(exported);
    expect(download).not.toHaveBeenCalled();
  });
  test('"Make my key pair" waits while a pair is made, so one click makes one file', async () => {
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    el<HTMLButtonElement>('[data-ui="make-pair"]').click();
    expect(el<HTMLButtonElement>('[data-ui="make-pair"]').disabled).toBe(true);
    await offeredOnce(download); // the pair ends in this test, not in the next one
  });
  test('the public key is shown once its private-key file is offered', async () => {
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    el<HTMLButtonElement>('[data-ui="make-pair"]').click();
    await offeredOnce(download);
    expect(el('[data-ui="own-pub-row"]').hidden).toBe(false);
  });
  test('an empty file seals from the page', async () => {
    pick('kind', 'file');
    typeInto('password', 'a throwaway sentence for the tests');
    choose('file', new File([], 'empty.txt', { type: 'text/plain' }));
    el<HTMLButtonElement>('[data-ui="seal"]').click();
    await reads('roundtrip', 'Round trip checked: it opens back to the same 0 bytes.');
  });
  test('a sealed file opens to the same name, type and bytes', async () => {
    pick('key', 'keyfile');
    choose('keyfile', new File([KEY_FILE_TEXT], 'key.bin'));
    pick('kind', 'file');
    dropFile(el('[data-ui="drop"]'), new File([PHOTO], 'photo.jpg', { type: 'image/jpeg' }));
    el<HTMLButtonElement>('[data-ui="seal"]').click();
    const sealed = await sealedEnvelope();
    expect(await open(parse(sealed), { kind: 'keyfile', file: utf8(KEY_FILE_TEXT) })).toEqual({ kind: 'file', name: 'photo.jpg', type: 'image/jpeg', bytes: PHOTO });
  });
  test('a seal to a public key says the round trip was checked from this side only', async () => {
    pick('key', 'publickey');
    typeInto('pubkey', BOB_PUBLIC_KEY);
    typeInto('letter', 'Meet me at seven.');
    el<HTMLButtonElement>('[data-ui="seal"]').click();
    await sealedEnvelope();
    expect(el('[data-ui="roundtrip"]').textContent).toBe('Round trip checked from your side. Only the recipient can open it.');
  });
  test('the envelope text is not rewritten by a render that changes nothing it shows', async () => {
    sealLetter('Meet me at seven.', 'a throwaway sentence for the tests');
    await sealedEnvelope();
    const shown = el('[data-ui="envelope-json"]').firstChild;
    pick('view', 'open');
    expect(el('[data-ui="envelope-json"]').firstChild).toBe(shown);
  });
});

describe('fields that hold secrets', () => {
  test('the password is never sent to a spellchecking service', () => {
    expect(el('[data-ui="password"]').getAttribute('spellcheck')).toBe('false');
  });
  test('the letter is never sent to a spellchecking service', () => {
    expect(el('[data-ui="letter"]').getAttribute('spellcheck')).toBe('false');
  });
  test('the envelope box is never sent to a spellchecking service', () => {
    expect(el('[data-ui="open-in"]').getAttribute('spellcheck')).toBe('false');
  });
  test('the open-side password lets a password manager fill a saved password', () => {
    expect(el('[data-ui="open-password"]').getAttribute('autocomplete')).toBe('current-password');
  });
});

describe('what an opened envelope shows', () => {
  test('a new attempt clears what the last one opened', async () => {
    pick('view', 'open');
    typeInto('open-in', ATBASH_ENVELOPE);
    el<HTMLButtonElement>('[data-ui="open"]').click();
    await openedText();
    el<HTMLButtonElement>('[data-ui="open"]').click();
    expect(el('[data-ui="opened"]').textContent).toBe('');
  });
  test('changing the key clears what the old key opened', async () => {
    openEnvelope(CAESAR_ENVELOPE, 'open-shift', '3');
    await openedText();
    typeInto('open-shift', '5');
    expect(el('[data-ui="opened"]').textContent).toBe('');
  });
  test('an open that succeeds for an envelope that was replaced shows nothing', async () => {
    openEnvelope(gcmPassword, 'open-password', 'correct horse battery staple');
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt');
    typeInto('open-in', ATBASH_ENVELOPE);
    await settled(decrypt);
    expect(el('[data-ui="opened"]').textContent).toBe('');
  });
  test('a file refused while an open runs is still shown after the open ends', async () => {
    openEnvelope(gcmPassword, 'open-password', 'correct horse battery staple');
    dropFile(el('[data-ui="open-source"]'), envelopeFile(bobPrivateKey, 'cipher-envelope-private-key.json'));
    await openedText();
    await statusReads('That is not an envelope. Paste the whole file.');
  });
  test('opened text that looks like markup is shown as text', async () => {
    openEnvelope(MARKUP_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedText()).toBe('<b>x</b>');
  });
  test('an unknown method is quoted as text, never as markup', () => {
    pick('view', 'open');
    typeInto('open-in', MARKUP_METHOD_ENVELOPE);
    expect(el('[data-ui="open-needs"]').textContent).toBe('This page does not know the method "<i>m</i>", so it cannot open the envelope.');
  });
  test('a long file name keeps its extension when it is cut', async () => {
    openEnvelope(LONG_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe(`${'a'.repeat(116)}.pdf`);
  });
  test('leading dots are dropped from a file name', async () => {
    openEnvelope(DOTTED_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('hidden');
  });
  test('an invisible character in a file name is replaced', async () => {
    openEnvelope(INVISIBLE_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('report_.pdf');
  });
  test('the Save button does not repeat the name from the envelope', async () => {
    openEnvelope(SPOOFED_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    await openedText();
    expect(el('[data-ui="save-opened"]').textContent).toBe('Save the file');
  });
  test('a private-key file over 64 KiB is refused', async () => {
    pick('view', 'open');
    typeInto('open-in', gcmPublicKey);
    choose('open-publickey', sizedFile(65_537, 'cipher-envelope-private-key.json'));
    el<HTMLButtonElement>('[data-ui="open"]').click();
    await statusReads('That file is larger than 64 KiB, the most this page reads for it.');
  });
});

describe('on a phone', () => {
  test('an open that finishes after switching to Seal does not scroll', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(EVERY_QUERY_MATCHES);
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    pick('view', 'open');
    typeInto('open-in', ATBASH_ENVELOPE);
    el<HTMLButtonElement>('[data-ui="open"]').click();
    pick('view', 'seal');
    await pause(50);
    expect(scroll).not.toHaveBeenCalled();
  });
  test('an open that finishes after the page is removed does not scroll', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(EVERY_QUERY_MATCHES);
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    pick('view', 'open');
    typeInto('open-in', ATBASH_ENVELOPE);
    el<HTMLButtonElement>('[data-ui="open"]').click();
    unmount();
    await pause(50);
    expect(scroll).not.toHaveBeenCalled();
  });
  test('a seal that finishes while Open is shown leaves the tabs alone', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(EVERY_QUERY_MATCHES);
    el<HTMLButtonElement>('[data-tab="how"]').click();
    sealLetter('Meet me at seven.', 'a throwaway sentence for the tests');
    pick('view', 'open');
    await sealedEnvelope();
    expect(el('[data-tab="how"]').getAttribute('aria-selected')).toBe('true');
  });
});

describe('file names from an envelope', () => {
  test('a slash in a file name is replaced', async () => {
    openEnvelope(PATH_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('_secret_x.txt');
  });
  test('a backslash in a file name is replaced', async () => {
    openEnvelope(BACKSLASH_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('_secret_x.txt');
  });
  test('a name of dots only falls back to opened-file', async () => {
    openEnvelope(DOTS_ONLY_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('opened-file');
  });
  test('a name longer than 480 characters is cut to 120, losing its extension', async () => {
    openEnvelope(VERY_LONG_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe(`${'a'.repeat(120)}`);
  });
  test('an extension of 16 characters, dot included, is kept when a long name is cut', async () => {
    openEnvelope(EXTENSION_16_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe(`${'a'.repeat(104)}.${'b'.repeat(15)}`);
  });
  test('an extension of 17 characters is not kept', async () => {
    openEnvelope(EXTENSION_17_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe(`${'a'.repeat(120)}`);
  });
  test('blank letters that could push the real extension out of sight are replaced', async () => {
    openEnvelope(BLANK_PADDED_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('invoice.pdf___.exe');
  });
  test('a no-break space is replaced', async () => {
    openEnvelope(NO_BREAK_SPACE_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('my_report.pdf');
  });
  test('a plain space is kept', async () => {
    openEnvelope(SPACE_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('my report.pdf');
  });
  test('a zero-width non-joiner, which some scripts spell with, is kept', async () => {
    openEnvelope(JOINER_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe(`a${ZERO_WIDTH_NON_JOINER}b.pdf`);
  });
  test('a zero-width joiner inside a name is kept', async () => {
    openEnvelope(ZWJ_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe(`a${ZERO_WIDTH_JOINER}b.pdf`);
  });
  test('a right-to-left isolate is replaced', async () => {
    openEnvelope(ISOLATE_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('a_b.pdf');
  });
  test('a braille blank is replaced', async () => {
    openEnvelope(BRAILLE_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('a_b.pdf');
  });
  test('an ideographic space is replaced', async () => {
    openEnvelope(IDEOGRAPHIC_SPACE_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('a_b.pdf');
  });
  test('an em space is replaced', async () => {
    openEnvelope(EM_SPACE_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('a_b.pdf');
  });
  test('half of a surrogate pair is replaced', async () => {
    openEnvelope(HALF_PAIR_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('a_b.pdf');
  });
  test('leading spaces are dropped', async () => {
    openEnvelope(LEADING_SPACES_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('report.pdf');
  });
  test('a run of spaces, which could push the real extension out of sight, becomes one', async () => {
    openEnvelope(SPACE_RUN_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('invoice.pdf .exe');
  });
  test('a run of spaces becomes one in the saved name too', async () => {
    openEnvelope(SPACE_RUN_ENVELOPE, 'open-generated', GENERATED_KEY);
    await openedText();
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    el<HTMLButtonElement>('[data-ui="save-opened"]').click();
    expect(download.mock.contexts[0]).toHaveProperty('download', 'invoice.pdf .exe');
  });
  test('a name of joiners only falls back to opened-file', async () => {
    openEnvelope(JOINERS_ONLY_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('opened-file');
  });
  test('a leading joiner is dropped with the dot after it', async () => {
    openEnvelope(LEADING_JOINER_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('bashrc');
  });
  test('a name of combining marks only falls back to opened-file', async () => {
    openEnvelope(MARKS_ONLY_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('opened-file');
  });
  test('a run of spaces with invisible characters between them becomes one', async () => {
    openEnvelope(JOINED_SPACE_RUN_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe(`invoice.pdf ${ZERO_WIDTH_JOINER}.exe`);
  });
  test('a run of exactly two spaces becomes one', async () => {
    openEnvelope(TWO_SPACES_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('my report.pdf');
  });
  test('a line separator in a file name is replaced', async () => {
    openEnvelope(LINE_SEPARATOR_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('a_b.pdf');
  });
  test('a name of unassigned invisible characters only falls back to opened-file', async () => {
    openEnvelope(UNASSIGNED_ONLY_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('opened-file');
  });
  test('a run of spaces with two invisible characters between each becomes one', async () => {
    openEnvelope(TWO_INVISIBLES_RUN_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe(`invoice.pdf ${ZERO_WIDTH_JOINER}${ZERO_WIDTH_NON_JOINER}.exe`);
  });
  test('a file name that looks like markup is shown as text', async () => {
    openEnvelope(MARKUP_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    expect(await openedName()).toBe('<b>x.txt');
  });
});

describe('without Web Crypto', () => {
  afterEach(() => vi.unstubAllGlobals());
  test('Seal says why it cannot run', () => {
    vi.stubGlobal('crypto', {});
    remount();
    expect(el('[data-ui="status"]').textContent).toBe(NO_WEB_CRYPTO);
  });
  test('an AES envelope to open says why it cannot be opened', () => {
    vi.stubGlobal('crypto', {});
    remount();
    pick('view', 'open');
    typeInto('open-in', GCM_ENVELOPE);
    expect(el('[data-ui="open-needs"]').textContent).toBe(NO_WEB_CRYPTO);
  });
});

describe('lines and limits', () => {
  test('the round-trip line counts UTF-8 bytes', async () => {
    sealLetter('Café at seven.', 'a throwaway sentence for the tests');
    await sealedEnvelope();
    expect(el('[data-ui="roundtrip"]').textContent).toBe('Round trip checked: it opens back to the same 15 bytes.');
  });
  test('choosing another key file after sealing clears the envelope', async () => {
    pick('key', 'keyfile');
    choose('keyfile', new File(['a throwaway key file'], 'key.bin'));
    typeInto('letter', 'Meet me at seven.');
    el<HTMLButtonElement>('[data-ui="seal"]').click();
    await sealedEnvelope();
    choose('keyfile', new File(['another throwaway key file'], 'other.bin'));
    expect(el('[data-ui="envelope-json"]').textContent).toBe('');
  });
  test('a file dropped on a key-file input is left to the input', () => {
    expect(dropFile(el('[data-ui="keyfile"]'), envelopeFile(ATBASH_ENVELOPE)).defaultPrevented).toBe(false);
  });
  test('a file of exactly 64 MiB is not blocked', () => {
    pick('kind', 'file');
    dropFile(el('[data-ui="drop"]'), sizedFile(67_108_864, 'exact.bin'));
    expect(el('[data-ui="status"]').textContent).toBe('');
  });
  test('a private-key file of exactly 64 KiB is read', async () => {
    pick('view', 'open');
    typeInto('open-in', gcmPublicKey);
    choose('open-publickey', sizedFile(65_536, 'cipher-envelope-private-key.json'));
    el<HTMLButtonElement>('[data-ui="open"]').click();
    await statusReads('That is not a private-key file made here.');
  });
  test('an opened Learn envelope says a wrong key gives nonsense', async () => {
    openEnvelope(CAESAR_ENVELOPE, 'open-shift', '3');
    await openedText();
    expect(el('[data-ui="opened-note"]').textContent).toBe('A learning cipher opens with any key: a wrong key gives nonsense, not an error.');
  });
  test('an opened Playfair envelope also says what Playfair gives back', async () => {
    openEnvelope(playfairEnvelope, 'open-keyword', 'playfair example');
    await openedText();
    expect(el('[data-ui="opened-note"]').textContent).toBe('A learning cipher opens with any key: a wrong key gives nonsense, not an error. Playfair gives back letters only, in capitals, with J as I, and an X added between doubled letters and after an odd last letter, or a Q where that letter is X.');
  });
  test('an opened Old-lock envelope says the lock cannot tell whether it was changed', async () => {
    openEnvelope(cbcGenerated, 'open-generated', GENERATED_KEY);
    await openedText();
    expect(el('[data-ui="opened-note"]').textContent).toBe('This lock cannot tell whether the envelope was changed after it was sealed, so what it opened may differ from what was sealed.');
  });
  test('an opened Strong-lock envelope has no such note', async () => {
    openEnvelope(gcmGeneratedFile, 'open-generated', GENERATED_KEY);
    await openedText();
    expect(el('[data-ui="opened-note"]').textContent).toBe('');
  });
  test('a held-down Ctrl+Enter does not seal again', () => {
    typeInto('letter', 'Meet me at seven.');
    typeInto('password', 'a throwaway sentence for the tests');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, repeat: true, bubbles: true }));
    expect(el<HTMLButtonElement>('[data-ui="seal"]').disabled).toBe(false);
  });
});

describe('Learn drawings', () => {
  test('a typed Caesar shift is drawn', () => {
    pick('method', 'caesar');
    typeInto('shift', '5');
    expect(el('[data-ui="how-art"]').textContent).toContain('shift 5');
  });
  test('the Caesar wheel pairs each letter with the one three on', () => {
    pick('method', 'caesar');
    expect(el('[data-ui="how-art"]').textContent).toContain('ADBECF');
  });
  test('the Vigenère table seals ATTACKATDAWN with LEMON as in the textbook', () => {
    pick('method', 'vigenere');
    typeInto('keyword', 'LEMON');
    typeInto('letter', 'ATTACKATDAWN');
    expect(el('[data-ui="how-art"]').textContent).toContain('ALLTEXTMFAOOCNP');
  });
  test('the Playfair square is built from the typed keyword', () => {
    pick('method', 'playfair');
    typeInto('keyword', 'MONARCHY');
    expect(el('[data-ui="how-art"]').textContent).toContain('MONARCHYBDEFGIKLPQSTUVWXZ');
  });
  test('a drawing that fails leaves Seal working', async () => {
    vi.spyOn(SVGSVGElement.prototype, 'setAttribute').mockImplementation(failing);
    sealLetter('Meet me at seven.', 'a throwaway sentence for the tests');
    expect(await sealedEnvelope()).toContain('"method": "aes-256-gcm"');
  });
});

describe('the Open side keeps up with what changed', () => {
  test('dropping the envelope already in the box clears an earlier refusal', async () => {
    pick('view', 'open');
    typeInto('open-in', ATBASH_ENVELOPE);
    dropFile(el('[data-ui="open-source"]'), envelopeFile(bobPrivateKey, 'cipher-envelope-private-key.json'));
    await statusReads('That is not an envelope. Paste the whole file.');
    dropFile(el('[data-ui="open-source"]'), envelopeFile(ATBASH_ENVELOPE));
    await statusReads('');
  });
  test('pasting the envelope already in the box clears an earlier refusal', async () => {
    pick('view', 'open');
    typeInto('open-in', ATBASH_ENVELOPE);
    dropFile(el('[data-ui="open-source"]'), envelopeFile(bobPrivateKey, 'cipher-envelope-private-key.json'));
    await statusReads('That is not an envelope. Paste the whole file.');
    typeInto('open-in', ATBASH_ENVELOPE);
    expect(el('[data-ui="status"]').textContent).toBe('');
  });
  test("pasting the envelope already in the box keeps the last open's failure", async () => {
    openEnvelope(GCM_ENVELOPE, 'open-generated', GENERATED_KEY);
    await statusReads(WRONG_SECRET);
    typeInto('open-in', GCM_ENVELOPE);
    expect(el('[data-ui="status"]').textContent).toBe(WRONG_SECRET);
  });
  test('a re-read of the same envelope file that ends after a failed open keeps the failure', async () => {
    pick('view', 'open');
    typeInto('open-in', GCM_ENVELOPE);
    const again = heldFile(GCM_ENVELOPE);
    dropFile(el('[data-ui="open-source"]'), again.file);
    typeInto('open-generated', GENERATED_KEY);
    el<HTMLButtonElement>('[data-ui="open"]').click();
    await statusReads(WRONG_SECRET);
    again.release();
    await pause(0);
    expect(el('[data-ui="status"]').textContent).toBe(WRONG_SECRET);
  });
  test('a new envelope clears an earlier refusal', async () => {
    pick('view', 'open');
    dropFile(el('[data-ui="open-source"]'), envelopeFile(bobPrivateKey, 'cipher-envelope-private-key.json'));
    await statusReads('That is not an envelope. Paste the whole file.');
    typeInto('open-in', ATBASH_ENVELOPE);
    expect(el('[data-ui="status"]').textContent).toBe('');
  });
  test('changing the key while an open runs lets Open run again', () => {
    openEnvelope(gcmPassword, 'open-password', 'a wrong password');
    typeInto('open-password', 'correct horse battery staple');
    expect(el<HTMLButtonElement>('[data-ui="open"]').disabled).toBe(false);
  });
  test('changing the key clears the last failure', async () => {
    openEnvelope(gcmPassword, 'open-password', 'a wrong password');
    await statusReads('Wrong secret, or the envelope was changed.');
    typeInto('open-password', 'correct horse battery staple');
    expect(el('[data-ui="status"]').textContent).toBe('');
  });
  test('opened text is not rewritten by a render that changes nothing it shows', async () => {
    pick('view', 'open');
    typeInto('open-in', ATBASH_ENVELOPE);
    el<HTMLButtonElement>('[data-ui="open"]').click();
    await openedText();
    const shown = el('[data-ui="opened"]').firstChild;
    pick('view', 'seal');
    expect(el('[data-ui="opened"]').firstChild).toBe(shown);
  });
  test('on a phone, a seal that finishes before switching to Open does not scroll there afterwards', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(EVERY_QUERY_MATCHES);
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    sealLetter('Meet me at seven.', 'a throwaway sentence for the tests');
    await sealedEnvelope();
    pick('view', 'open');
    await pause(400); // the scroll is due 300 ms after the seal, with reduced motion
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('the Open side reads its own key fields', () => {
  test('a Caesar envelope opens with the shift given on the Open side', async () => {
    openEnvelope(CAESAR_SHIFT_5_ENVELOPE, 'open-shift', '5');
    expect(await openedText()).toBe('HELLO');
  });
  test('a rail-fence envelope opens with the rails given on the Open side', async () => {
    openEnvelope(RAILS_4_ENVELOPE, 'open-rails', '4');
    expect(await openedText()).toBe('Meet me, 7pm.');
  });
  test('a key-file envelope opens with the key file chosen on the Open side', async () => {
    pick('view', 'open');
    typeInto('open-in', gcmKeyfile);
    choose('open-keyfile', new File([GOLDEN_KEY_FILE], 'key.bin'));
    el<HTMLButtonElement>('[data-ui="open"]').click();
    expect(await openedText()).toBe(GOLDEN_TEXT);
  });
  test('a public-key envelope opens with the private-key file chosen on the Open side', async () => {
    pick('view', 'open');
    typeInto('open-in', gcmPublicKey);
    choose('open-publickey', new File([bobPrivateKey], 'cipher-envelope-private-key.json'));
    el<HTMLButtonElement>('[data-ui="open"]').click();
    expect(await openedText()).toBe(GOLDEN_TEXT);
  });
  test('an envelope file chosen with the file chooser goes into the box', async () => {
    pick('view', 'open');
    choose('open-file', envelopeFile(ATBASH_ENVELOPE));
    await envelopeBoxReads(ATBASH_ENVELOPE);
  });
});

describe('what an opened envelope says about itself', () => {
  test('an opened public-key envelope says anyone with the public key could have sealed it', async () => {
    pick('view', 'open');
    typeInto('open-in', gcmPublicKey);
    choose('open-publickey', new File([bobPrivateKey], 'cipher-envelope-private-key.json'));
    el<HTMLButtonElement>('[data-ui="open"]').click();
    await openedText();
    expect(el('[data-ui="opened-note"]').textContent).toBe('Anyone who has your public key could have sealed this envelope, so it does not show who sent it.');
  });
  test('a pasted Old-lock envelope shows no note until it is opened', () => {
    pick('view', 'open');
    typeInto('open-in', cbcGenerated);
    expect(el('[data-ui="opened-note"]').textContent).toBe('');
  });
  test('opened text is marked for the browser not to translate', () => {
    expect(el('[data-ui="opened"]').getAttribute('translate')).toBe('no');
  });
  test("an opened file's name is set apart from the page's own words", async () => {
    openEnvelope(SPOOFED_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    await openedName();
    expect(openedLead()).toBe('Opened a file. The name it was sealed with:');
  });
  test("an opened file's name is isolated from the direction of the text around it", async () => {
    openEnvelope(SPOOFED_NAME_ENVELOPE, 'open-generated', GENERATED_KEY);
    await openedName();
    expect(el('.sender-name').tagName).toBe('BDI');
  });
});

describe('generated keys', () => {
  test('each generated key is new', () => {
    pick('key', 'generated');
    el<HTMLButtonElement>('[data-ui="generate"]').click();
    const first = el<HTMLInputElement>('[data-ui="generated"]').value;
    el<HTMLButtonElement>('[data-ui="generate"]').click();
    expect(el<HTMLInputElement>('[data-ui="generated"]').value).not.toBe(first);
  });
  test('a generated key is 43 characters: 32 bytes in base64url', () => {
    pick('key', 'generated');
    el<HTMLButtonElement>('[data-ui="generate"]').click();
    expect(el<HTMLInputElement>('[data-ui="generated"]').value).toHaveLength(43);
  });
  test('ticking "I saved this key" before a key exists does not unlock Seal', () => {
    pick('key', 'generated');
    typeInto('letter', 'Meet me at seven.');
    el<HTMLInputElement>('[data-ui="gate"]').click();
    expect(el<HTMLButtonElement>('[data-ui="seal"]').disabled).toBe(true);
  });
});

describe('copying', () => {
  test('a generated key copied to the clipboard says Copied', async () => {
    grantClipboard();
    pick('key', 'generated');
    el<HTMLButtonElement>('[data-ui="generate"]').click();
    el<HTMLButtonElement>('[data-ui="key-copy"]').click();
    await reads('key-copy', 'Copied');
  });
  test('a generated key the browser will not copy says so', async () => {
    pick('key', 'generated');
    el<HTMLButtonElement>('[data-ui="generate"]').click();
    el<HTMLButtonElement>('[data-ui="key-copy"]').click();
    await reads('key-copy', 'Copying was blocked. It is selected for you to copy.');
  });
  test('a new key takes back the Copied of the old one', async () => {
    grantClipboard();
    pick('key', 'generated');
    el<HTMLButtonElement>('[data-ui="generate"]').click();
    el<HTMLButtonElement>('[data-ui="key-copy"]').click();
    await reads('key-copy', 'Copied');
    el<HTMLButtonElement>('[data-ui="generate"]').click();
    expect(el('[data-ui="key-copy"]').textContent).toBe('Copy');
  });
  test('a copied envelope says Copied', async () => {
    grantClipboard();
    sealLetter('Meet me at seven.', 'a throwaway sentence for the tests');
    await sealedEnvelope();
    el<HTMLButtonElement>('[data-ui="copy"]').click();
    await reads('copied', 'Copied');
  });
});

describe('on a phone, the page shows what is new', () => {
  test('an opened envelope is scrolled into view', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(EVERY_QUERY_MATCHES);
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    pick('view', 'open');
    typeInto('open-in', ATBASH_ENVELOPE);
    el<HTMLButtonElement>('[data-ui="open"]').click();
    await scrolled(scroll);
  });
  test('a finished seal is scrolled into view', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(EVERY_QUERY_MATCHES);
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    sealLetter('Meet me at seven.', 'a throwaway sentence for the tests');
    await sealedEnvelope();
    await scrolled(scroll);
  });
  test('a seal that finishes after the page is removed does not scroll', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(EVERY_QUERY_MATCHES);
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt');
    sealLetter('Meet me at seven.', 'a throwaway sentence for the tests');
    unmount();
    await settled(decrypt);
    await pause(400); // the scroll would be due 300 ms after the seal, with reduced motion
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('the panel and its Details', () => {
  test('Details names how a key file becomes a key', () => {
    pick('key', 'keyfile');
    expect(el('[data-ui="d-key"]').textContent).toBe('HKDF-SHA256 over the file, 16-byte random salt');
  });
  test('Hide panel hides the right panel', () => {
    el<HTMLButtonElement>('[data-ui="hide-right"]').click();
    expect(root.dataset.right).toBe('hidden');
  });
  test('Show panel brings it back', () => {
    el<HTMLButtonElement>('[data-ui="hide-right"]').click();
    el<HTMLButtonElement>('[data-ui="show-right"]').click();
    expect(root.dataset.right).toBeUndefined();
  });
});
