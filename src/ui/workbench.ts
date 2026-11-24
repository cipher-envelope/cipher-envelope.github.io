// The workbench: controls on the left, the letter in the centre, the envelope and "How it works"
// on the right. On a phone the same parts stack in the order a thumb uses them.
//
// One typed state holds what the page is derived from: the method, the key, the content, the seal,
// the opening and the notes. Handlers change it and call render(), or invalidate() when the last seal
// must be forgotten; render() writes everything that depends on it, so the panels, the buttons and
// the drawings cannot disagree with each other. What the controls hold themselves (typed values,
// the generated key, password visibility, the tabs and the hidden panel) is changed in place.

import { randomBytes, toBase64Url, type Bytes } from '../crypto/bytes';
import { normalises, RAILS_MAX, RAILS_MIN, SHIFT_MAX, SHIFT_MIN } from '../crypto/classical';
import { parse, serialize, type Envelope } from '../crypto/envelope';
import { CipherError } from '../crypto/errors';
import { KEY_BYTES, makeKeyPair, MAX_KEY_FILE_BYTES, MAX_PRIVATE_KEY_FILE_BYTES, supportsX25519 } from '../crypto/keys';
import { aesSpec, DATA_KEY_ORDER, gradeOf, isAes, isDataKey, isMethodId, keysOf, METHOD_IDS, methodSpec, type DataKey, type KeyKind, type MethodId } from '../crypto/methods';
import { assertWithinLimit, contentBytes, MAX_ENVELOPE_BYTES, MAX_INPUT_BYTES, open, seal, type Content } from '../crypto/seal';
import type { OpenSecret, SealSecret } from '../crypto/secrets';
import { DETAIL_TEXT, ERROR_TEXT, GRADE_TEXT, KEY_TEXT, METHOD_TEXT, UI } from './catalog';
import { clear, drawEnvelope, drawHowItWorks, drawTint, type HowState } from './drawings';
import { currentPalette, onSchemeChange } from './palette';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** The words for a failure. One the crypto layer did not foresee is logged, since the user sees only the generic line. */
function message(error: unknown): string {
  if (error instanceof CipherError) return ERROR_TEXT[error.code](error.detail);
  console.error(error);
  return UI.genericError;
}

/** Copies text. False when the browser refuses, or has no clipboard here: it needs a secure page. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Opens the disclosure that holds the element, if any, and selects its text for the user to copy. */
function selectText(target: HTMLElement): void {
  const details = target.closest('details');
  if (details) details.open = true;
  getSelection()?.selectAllChildren(target);
}

// Spellcheck off: a browser's enhanced spellcheck sends a field's text to a server, which no page
// policy can stop. Capitalisation and autocorrect off too, so a phone keyboard cannot change a key.
const PLAIN = 'spellcheck="false" autocapitalize="off" autocorrect="off"';

// ---- every element the workbench uses, checked once at mount ----

const ELEMENTS = {
  seal: HTMLButtonElement,
  open: HTMLButtonElement,
  generate: HTMLButtonElement,
  'key-copy': HTMLButtonElement,
  'pw-toggle': HTMLButtonElement,
  'make-pair': HTMLButtonElement,
  download: HTMLButtonElement,
  copy: HTMLButtonElement,
  'hide-right': HTMLButtonElement,
  'show-right': HTMLButtonElement,
  'save-opened': HTMLButtonElement,
  letter: HTMLTextAreaElement,
  'open-in': HTMLTextAreaElement,
  password: HTMLInputElement,
  generated: HTMLInputElement,
  pubkey: HTMLInputElement,
  shift: HTMLInputElement,
  keyword: HTMLInputElement,
  rails: HTMLInputElement,
  keyfile: HTMLInputElement,
  'own-pub': HTMLInputElement,
  ack: HTMLInputElement,
  gate: HTMLInputElement,
  file: HTMLInputElement,
  'open-file': HTMLInputElement,
  'open-password': HTMLInputElement,
  'open-generated': HTMLInputElement,
  'open-keyfile': HTMLInputElement,
  'open-publickey': HTMLInputElement,
  'open-shift': HTMLInputElement,
  'open-keyword': HTMLInputElement,
  'open-rails': HTMLInputElement,
  'seal-body': HTMLElement,
  'open-source': HTMLElement,
  'data-keys': HTMLElement,
  'x25519-note': HTMLElement,
  'own-pub-row': HTMLElement,
  'pair-status': HTMLElement,
  'd-method': HTMLElement,
  'd-key': HTMLElement,
  'd-nonce': HTMLElement,
  status: HTMLElement,
  drop: HTMLElement,
  'file-name': HTMLElement,
  opened: HTMLElement,
  'opened-note': HTMLElement,
  'open-needs': HTMLElement,
  roundtrip: HTMLElement,
  copied: HTMLElement,
  'envelope-json': HTMLElement,
  centre: HTMLElement,
  right: HTMLElement,
  tint: SVGSVGElement,
  'envelope-art': SVGSVGElement,
  'how-art': SVGSVGElement,
} as const;

type Elements = { readonly [K in keyof typeof ELEMENTS]: InstanceType<(typeof ELEMENTS)[K]> };

function bind(root: HTMLElement): Elements {
  const found: Record<string, Element> = {};
  for (const [name, type] of Object.entries(ELEMENTS)) {
    const el = root.querySelector(`[data-ui="${name}"]`);
    if (!(el instanceof type)) throw new Error(`The workbench has no ${type.name} "${name}".`);
    found[name] = el;
  }
  return found as Elements; // every name was checked against its type above
}

// ---- the kinds of key: markup, and how each is read back ----

/** Reads a chosen file, refusing one over the limit before reading it, and naming a read that fails. */
async function readFile<T>(file: File, limit: number, read: (file: File) => Promise<T>): Promise<T> {
  if (file.size > limit) throw new CipherError('file-too-large', String(limit));
  try {
    return await read(file);
  } catch {
    throw new CipherError('file-unreadable'); // the file moved, or the browser lost access to it
  }
}

async function keyFile(input: HTMLInputElement): Promise<Bytes> {
  const file = input.files?.[0];
  if (!file) throw new CipherError('keyfile-missing');
  return new Uint8Array(await readFile(file, MAX_KEY_FILE_BYTES, (f) => f.arrayBuffer()));
}

async function privateKeyFile(input: HTMLInputElement): Promise<string> {
  const file = input.files?.[0];
  if (!file) throw new CipherError('private-key-missing');
  return readFile(file, MAX_PRIVATE_KEY_FILE_BYTES, (f) => f.text());
}

const note = (key: KeyKind) => `<p class="note">${esc(KEY_TEXT[key].note)}</p>`;
const field = (inner: string) => `<div class="field">${inner}</div>`;
const numberInput = (name: string, label: string, min: number, max: number, value = '') =>
  `<input type="number" data-ui="${name}" min="${min}" max="${max}"${value ? ` value="${value}"` : ''} aria-label="${esc(label)}">`;

interface KeyPanel {
  readonly seal: string;
  readonly open: string;
  readonly sealSecret: (e: Elements) => Promise<SealSecret>;
  readonly openSecret: (e: Elements) => Promise<OpenSecret>;
  /** The key as typed, for drawing the classical ciphers; empty for data keys. */
  readonly sealText: (e: Elements) => string;
  readonly openText: (e: Elements) => string;
}

const none = () => '';

/** One entry per kind of key, so adding a kind without its panels does not compile. */
const KEY_PANELS: Record<KeyKind, KeyPanel> = {
  password: {
    seal: `${field(`<input type="password" data-ui="password" ${PLAIN} aria-label="${esc(UI.ariaPassword)}" placeholder="${esc(UI.passwordPlaceholder)}" autocomplete="new-password"><button type="button" data-ui="pw-toggle" aria-pressed="false">${esc(UI.show)}</button>`)}${note('password')}`,
    open: field(`<input type="password" data-ui="open-password" ${PLAIN} autocomplete="current-password" aria-label="${esc(UI.ariaPassword)}">`),
    sealSecret: async (e) => ({ kind: 'password', password: e.password.value }),
    openSecret: async (e) => ({ kind: 'password', password: e['open-password'].value }),
    sealText: none,
    openText: none,
  },
  generated: {
    seal: `${field(`<input type="text" class="key" data-ui="generated" readonly ${PLAIN} aria-label="${esc(UI.ariaGeneratedKey)}" placeholder="${esc(UI.noKeyYet)}"><button type="button" data-ui="key-copy">${esc(UI.copy)}</button>`)}
      <div class="actions"><button type="button" data-ui="generate">${esc(UI.generate)}</button></div>
      <label class="gate"><input type="checkbox" data-ui="gate"> ${esc(UI.savedGate)}</label>${note('generated')}`,
    open: field(`<input type="text" class="key" data-ui="open-generated" ${PLAIN} autocomplete="off" aria-label="${esc(UI.ariaKey)}" placeholder="${esc(UI.pasteKey)}">`),
    sealSecret: async (e) => ({ kind: 'generated', key: e.generated.value }),
    openSecret: async (e) => ({ kind: 'generated', key: e['open-generated'].value }),
    sealText: none,
    openText: none,
  },
  keyfile: {
    seal: `${field(`<input type="file" data-ui="keyfile" aria-label="${esc(UI.ariaKeyFile)}">`)}${note('keyfile')}`,
    open: field(`<input type="file" data-ui="open-keyfile" aria-label="${esc(UI.ariaKeyFile)}">`),
    sealSecret: async (e) => ({ kind: 'keyfile', file: await keyFile(e.keyfile) }),
    openSecret: async (e) => ({ kind: 'keyfile', file: await keyFile(e['open-keyfile']) }),
    sealText: none,
    openText: none,
  },
  publickey: {
    seal: `${field(`<input type="text" class="key" data-ui="pubkey" ${PLAIN} autocomplete="off" aria-label="${esc(UI.publicKeyLabel)}" placeholder="${esc(UI.publicKeyPlaceholder)}">`)}${note('publickey')}
      <div class="actions"><button type="button" data-ui="make-pair">${esc(UI.makePair)}</button></div>
      <div class="field" data-ui="own-pub-row" hidden><input type="text" class="key" data-ui="own-pub" readonly ${PLAIN} aria-label="${esc(UI.yourPublicKey)}"></div>
      <p class="note" data-ui="pair-status" aria-live="polite"></p>`,
    open: field(`<input type="file" data-ui="open-publickey" aria-label="${esc(UI.privateKeyFile)}" accept=".json,application/json">`),
    sealSecret: async (e) => ({ kind: 'publickey', publicKey: e.pubkey.value }),
    openSecret: async (e) => ({ kind: 'privatekey', file: await privateKeyFile(e['open-publickey']) }),
    sealText: none,
    openText: none,
  },
  shift: {
    seal: `${field(numberInput('shift', UI.ariaShift, SHIFT_MIN, SHIFT_MAX, '3'))}${note('shift')}`,
    open: field(numberInput('open-shift', UI.ariaShift, SHIFT_MIN, SHIFT_MAX)),
    sealSecret: async (e) => ({ kind: 'shift', shift: e.shift.value }),
    openSecret: async (e) => ({ kind: 'shift', shift: e['open-shift'].value }),
    sealText: (e) => e.shift.value,
    openText: (e) => e['open-shift'].value,
  },
  keyword: {
    seal: `${field(`<input type="text" data-ui="keyword" ${PLAIN} aria-label="${esc(UI.ariaKeyword)}" autocomplete="off">`)}${note('keyword')}`,
    open: field(`<input type="text" data-ui="open-keyword" ${PLAIN} aria-label="${esc(UI.ariaKeyword)}" autocomplete="off">`),
    sealSecret: async (e) => ({ kind: 'keyword', keyword: e.keyword.value }),
    openSecret: async (e) => ({ kind: 'keyword', keyword: e['open-keyword'].value }),
    sealText: (e) => e.keyword.value,
    openText: (e) => e['open-keyword'].value,
  },
  rails: {
    seal: `${field(numberInput('rails', UI.ariaRails, RAILS_MIN, RAILS_MAX, '3'))}${note('rails')}`,
    open: field(numberInput('open-rails', UI.ariaRails, RAILS_MIN, RAILS_MAX)),
    sealSecret: async (e) => ({ kind: 'rails', rails: e.rails.value }),
    openSecret: async (e) => ({ kind: 'rails', rails: e['open-rails'].value }),
    sealText: (e) => e.rails.value,
    openText: (e) => e['open-rails'].value,
  },
  none: {
    seal: note('none'),
    open: note('none'),
    sealSecret: async () => ({ kind: 'none' }),
    openSecret: async () => ({ kind: 'none' }),
    sealText: none,
    openText: none,
  },
};

// Object.keys is typed string[]; KEY_PANELS is a Record<KeyKind, …>, so its keys are exactly the kinds.
const KEY_KINDS = Object.keys(KEY_PANELS) as KeyKind[];

// ---- markup ----

function methodOption(id: MethodId, checked: boolean): string {
  const grade = gradeOf(id);
  const text = METHOD_TEXT[id];
  return `<label class="opt"><input type="radio" name="method" value="${id}"${checked ? ' checked' : ''}><b>${esc(text.plain)}</b><span class="badge ${grade}">${esc(GRADE_TEXT[grade])}</span><small>${esc(text.name)}: ${esc(text.about)}</small></label>`;
}

function markup(initial: MethodId): string {
  const real = METHOD_IDS.filter((id) => gradeOf(id) !== 'insecure');
  const learn = METHOD_IDS.filter((id) => gradeOf(id) === 'insecure');
  return `
<div class="bar">
  <h1 class="brand">${esc(UI.brand)}</h1>
  <div class="seg" role="radiogroup" aria-label="${esc(UI.ariaView)}">
    <label><input type="radio" name="view" value="seal" checked>${esc(UI.viewSeal)}</label>
    <label><input type="radio" name="view" value="open">${esc(UI.viewOpen)}</label>
  </div>
  <span class="fine">${esc(UI.noWarranty)}</span>
</div>
<div class="alarm seal-only" role="alert"><strong>${esc(UI.alarmTitle)}</strong><span>${esc(UI.alarmSeal)}</span></div>
<div class="alarm open-only" role="alert"><strong>${esc(UI.alarmTitle)}</strong><span>${esc(UI.alarmOpen)}</span></div>
<div class="frame">
  <aside class="left" aria-label="${esc(UI.ariaControls)}">
    <div class="body seal-only" data-ui="seal-body">
      <div class="sec">
        <h3>${esc(UI.lock)}</h3>
        ${real.map((id) => methodOption(id, id === initial)).join('')}
        <div class="learn-rule">${esc(UI.learnRule)}</div>
        ${learn.map((id) => methodOption(id, id === initial)).join('')}
      </div>
      <div class="sec">
        <h3>${esc(UI.whoOpens)}</h3>
        <div class="seg full" role="radiogroup" aria-label="${esc(UI.whoOpens)}" data-ui="data-keys">
          ${DATA_KEY_ORDER.map((k) => `<label><input type="radio" name="key" value="${k}">${esc(KEY_TEXT[k].short)}</label>`).join('')}
        </div>
        <p class="note" data-ui="x25519-note" hidden>${esc(UI.x25519Missing)}</p>
        ${KEY_KINDS.map((k) => `<div data-panel="${k}" hidden>${KEY_PANELS[k].seal}</div>`).join('')}
      </div>
      <div class="sec">
        <details class="more"><summary>${esc(UI.details)}</summary>
          <dl><dt>${esc(UI.detailMethod)}</dt><dd data-ui="d-method"></dd><dt>${esc(UI.detailKey)}</dt><dd data-ui="d-key"></dd><dt>${esc(UI.detailNonce)}</dt><dd data-ui="d-nonce"></dd></dl>
        </details>
      </div>
    </div>
    <div class="body open-only">
      <div class="sec" data-ui="open-source">
        <h3>${esc(UI.envelopeToOpen)}</h3>
        <textarea rows="7" data-ui="open-in" ${PLAIN} aria-label="${esc(UI.envelopeToOpen)}" placeholder="${esc(UI.pasteEnvelope)}"></textarea>
        <div class="field"><input type="file" data-ui="open-file" aria-label="${esc(UI.chooseEnvelope)}" accept=".json,application/json"></div>
        <p class="note" data-ui="open-needs" aria-live="polite"></p>
      </div>
      <div class="sec">
        <h3>${esc(UI.itsSecret)}</h3>
        ${KEY_KINDS.map((k) => `<div data-open-panel="${k}" hidden>${KEY_PANELS[k].open}</div>`).join('')}
      </div>
    </div>
    <div class="foot">
      <label class="ack seal-only"><input type="checkbox" data-ui="ack"> ${esc(UI.ack)}</label>
      <button type="button" class="primary seal-only" data-ui="seal">${esc(UI.seal)}</button>
      <button type="button" class="primary open-only" data-ui="open" disabled>${esc(UI.open)}</button>
      <span class="kbd">${esc(UI.shortcut)}</span>
      <p class="note" data-ui="status" aria-live="polite"></p>
    </div>
  </aside>
  <main class="centre" data-ui="centre">
    <button type="button" class="show-right" data-ui="show-right">${esc(UI.showPanel)}</button>
    <section class="seal-only">
      <div class="head">
        <h2>${esc(UI.whatToSeal)}</h2>
        <div class="seg" role="radiogroup" aria-label="${esc(UI.whatToSeal)}">
          <label><input type="radio" name="kind" value="text" checked>${esc(UI.kindText)}</label>
          <label><input type="radio" name="kind" value="file">${esc(UI.kindFile)}</label>
        </div>
      </div>
      <div class="sheet seal-sheet">
        <textarea data-ui="letter" spellcheck="false" aria-label="${esc(UI.letterLabel)}" placeholder="${esc(UI.letterPlaceholder)}"></textarea>
        <div class="dropzone" data-ui="drop" hidden>
          <div><b>${esc(UI.dropTitle)}</b>${esc(UI.dropOr)} <label for="ce-file">${esc(UI.dropChoose)}</label><input id="ce-file" type="file" data-ui="file">
            <div class="filecard" data-ui="file-name"></div></div>
        </div>
        <svg class="tint" data-ui="tint" aria-hidden="true"></svg>
      </div>
    </section>
    <section class="open-only">
      <h2>${esc(UI.whatHolds)}</h2>
      <div class="sheet">
        <pre class="opened" data-ui="opened" translate="no" data-empty="${esc(UI.openedEmpty)}"></pre>
        <div class="actions"><button type="button" data-ui="save-opened" hidden></button></div>
        <p class="note" data-ui="opened-note"></p>
      </div>
    </section>
  </main>
  <aside class="right" data-ui="right" aria-label="${esc(UI.tabEnvelope)}">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected="true" data-tab="envelope">${esc(UI.tabEnvelope)}</button>
      <button type="button" role="tab" aria-selected="false" data-tab="how">${esc(UI.tabHow)}</button>
      <button type="button" class="hide" data-ui="hide-right">${esc(UI.hidePanel)}</button>
    </div>
    <div data-view-pane="envelope">
      <svg class="art" data-ui="envelope-art" viewBox="0 0 400 290" role="img" aria-label="${esc(UI.tabEnvelope)}"></svg>
      <p data-ui="roundtrip" aria-live="polite" class="seal-only"></p>
      <div class="actions seal-only">
        <button type="button" data-ui="download" disabled>${esc(UI.download)}</button>
        <button type="button" data-ui="copy" disabled>${esc(UI.copyText)}</button>
        <span class="note" data-ui="copied"></span>
      </div>
      <details class="json seal-only"><summary>${esc(UI.holds)}</summary><p class="note">${esc(UI.holdsNote)}</p><pre class="json" data-ui="envelope-json"></pre></details>
    </div>
    <div data-view-pane="how" hidden>
      <div class="shout">${esc(UI.shout)}<small>${esc(UI.shoutSmall)}</small></div>
      <svg class="art" data-ui="how-art" viewBox="0 0 460 470" role="img" aria-label="${esc(UI.tabHow)}"></svg>
    </div>
  </aside>
  <p class="phone-fine">${esc(UI.noWarrantyLong)}</p>
</div>`;
}

// ---- state ----

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sealing' }
  | { readonly kind: 'sealed'; readonly envelope: Envelope; readonly bytes: number; readonly revealed: boolean };

/** The envelope to open, with the text it was read from, so the same text is never read twice. */
type Opening =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid'; readonly text: string; readonly message: string }
  | { readonly kind: 'ready'; readonly text: string; readonly envelope: Envelope; readonly opened: Content | null; readonly busy: boolean };

interface Note {
  readonly text: string;
  readonly kind: 'ok' | 'fail' | 'busy';
}

/** The open side's line. A refusal says a chosen or dropped file was not taken; any other is an open's own. */
interface OpenNote extends Note {
  readonly refusal: boolean;
}

interface State {
  view: 'seal' | 'open';
  method: MethodId;
  dataKey: DataKey;
  contentKind: 'text' | 'file';
  file: File | null;
  phase: Phase;
  /** Bumped whenever anything that went into a seal changes: a seal from an older run is dropped. */
  run: number;
  opening: Opening;
  /** Bumped whenever the envelope to open changes: a file read that finishes after a later paste or choice is dropped. */
  source: number;
  /** Each side's own line in the bottom bar, shown while that side is in view. */
  sealNote: Note | null;
  openNote: OpenNote | null;
  pair: Note | null;
  /** A key pair is being made: the button waits, so one click makes one pair and one file. */
  pairing: boolean;
  keyCopy: { readonly value: string; readonly ok: boolean } | null;
  envelopeCopy: { readonly envelope: Envelope; readonly ok: boolean } | null;
  x25519: boolean;
}

/** What the right-hand panel shows: the seal side's method, its sealed envelope, or the envelope being opened. */
interface Subject {
  readonly method: MethodId;
  readonly key: KeyKind;
  readonly closed: boolean;
  readonly how: HowState;
}

/** The longest file name shown or saved, in characters. */
const NAME_CHARACTERS = 120;
/** An extension this short or shorter is kept when a long name is cut. */
const EXTENSION_CHARACTERS = 16;

/** What a file name from an envelope may not keep: see safeFileName. */
const UNSAFE_NAME_CHARACTERS = /(?![\u200C\u200D])[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u115F\u1160\u3164\uFFA0\u2800/\\]/gu;

/**
 * A file name from inside an envelope, made safe to show and to save: whoever sealed the envelope
 * chose it. Control and invisible format characters (a right-to-left override can make "gpj.exe"
 * read as ".jpg"), blank characters other than the plain space, line separators and path
 * separators become "_". A run of spaces becomes one, even with invisible characters between them,
 * since spaces too can push an extension out of sight. The zero-width joiners stay inside a name:
 * Persian and other scripts spell with them. Leading dots, spaces, combining marks and invisible
 * characters go, so a name with nothing visible left is saved as "opened-file". A name over 120 characters is cut before its extension, so the saved
 * file keeps its type. The name is first cut to 480 code units, since it can be megabytes long; a
 * longer name, which only a crafted envelope has, may lose its extension or keep only part of it.
 */
function safeFileName(name: string): string {
  const cleaned = Array.from(
    name
      .slice(0, 4 * NAME_CHARACTERS)
      .replace(UNSAFE_NAME_CHARACTERS, '_')
      .replace(/ (?:\p{Default_Ignorable_Code_Point}* )+/gu, ' ')
      .replace(/^[.\s\p{M}\p{Default_Ignorable_Code_Point}]+/u, ''),
  );
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= EXTENSION_CHARACTERS ? cleaned.slice(dot) : [];
  const stem = cleaned.slice(0, cleaned.length - extension.length);
  const kept = cleaned.length > NAME_CHARACTERS ? [...stem.slice(0, NAME_CHARACTERS - extension.length), ...extension] : cleaned;
  return kept.join('') || 'opened-file';
}

/** A file name from an envelope, set apart from the page's own words, since its sender chose it. */
function senderName(name: string): HTMLElement {
  const element = document.createElement('bdi');
  element.className = 'sender-name';
  element.textContent = name;
  return element;
}

function saveFile(name: string, contents: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const INITIAL_METHOD: MethodId = 'aes-256-gcm';
const PRIVATE_KEY_FILE = 'cipher-envelope-private-key.json';

/**
 * Builds the workbench in root and returns a function that removes its document-level listeners.
 * A page mounts it only through `start` (`./start.ts`), which refuses to run in a frame.
 */
export function mountWorkbench(root: HTMLElement): () => void {
  root.classList.add('app');
  root.innerHTML = markup(INITIAL_METHOD);
  const e = bind(root);
  const listeners = new AbortController();
  // Missing outside a secure page (plain http). The learning ciphers do not need it.
  const webCrypto = Boolean(globalThis.crypto?.subtle);
  const phone = () => matchMedia('(max-width: 760px)').matches;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const say = (target: HTMLElement, note: Note | null) => {
    target.textContent = note?.text ?? '';
    target.dataset.kind = note?.kind ?? '';
  };

  const state: State = {
    view: 'seal',
    method: INITIAL_METHOD,
    dataKey: 'password',
    contentKind: 'text',
    file: null,
    phase: { kind: 'idle' },
    run: 0,
    opening: { kind: 'none' },
    source: 0,
    sealNote: null,
    openNote: null,
    pair: null,
    pairing: false,
    keyCopy: null,
    envelopeCopy: null,
    x25519: true,
  };

  const available = (k: KeyKind) => keysOf(state.method).includes(k) && (k !== 'publickey' || state.x25519);

  /** The kind of key the seal side uses: the chosen data key, or the classical cipher's own. */
  function sealKey(): KeyKind {
    const spec = methodSpec(state.method);
    return spec.family === 'aes' ? state.dataKey : spec.key;
  }

  /** Points the data key at one the method takes, without doing anything else. */
  function keepKeyAvailable(): void {
    // A Learn method takes no data key: the choice is kept for when an AES method is chosen again.
    if (isAes(state.method) && !available(state.dataKey)) state.dataKey = DATA_KEY_ORDER.find(available) ?? 'password';
  }

  function subject(): Subject | null {
    if (state.view === 'open') {
      if (state.opening.kind !== 'ready') return null;
      const envelope = state.opening.envelope;
      const keyText = KEY_PANELS[envelope.opensWith].openText(e);
      return { method: envelope.method, key: envelope.opensWith, closed: true, how: { method: envelope.method, key: envelope.opensWith, text: '', keyText, envelope } };
    }
    const key = sealKey();
    const sealed = state.phase.kind === 'sealed' ? state.phase : null;
    const how = { method: state.method, key, text: e.letter.value, keyText: KEY_PANELS[key].sealText(e), envelope: sealed?.envelope };
    return { method: state.method, key, closed: sealed?.revealed ?? false, how };
  }

  /** Why Seal cannot run, when it is something the user should be told. */
  function sealBlocked(): string | null {
    if (isAes(state.method) && !webCrypto) return UI.noWebCrypto;
    if (methodSpec(state.method).family === 'classical' && state.contentKind === 'file') return ERROR_TEXT['text-only']();
    if (state.contentKind === 'file' && state.file && state.file.size > MAX_INPUT_BYTES) return ERROR_TEXT['too-large'](String(MAX_INPUT_BYTES));
    return null;
  }

  // The drawings only illustrate. One that fails is logged and left blank: it never stops render(),
  // so it can never leave Seal or Open stuck.
  function paint(s: Subject | null): void {
    const p = currentPalette();
    try {
      drawTint(e.tint, p);
      if (!s) {
        clear(e['envelope-art']);
        clear(e['how-art']);
        return;
      }
      drawEnvelope(e['envelope-art'], p, s.method, s.key, s.closed);
      drawHowItWorks(e['how-art'], p, s.how);
    } catch (error) {
      console.error(error);
      clear(e['envelope-art']);
      clear(e['how-art']);
    }
  }

  /** The line under the envelope once it is sealed: what the round trip checked. */
  function roundTripText(sealed: Extract<Phase, { kind: 'sealed' }>): string {
    const method = sealed.envelope.method;
    if (sealed.envelope.opensWith === 'publickey') return UI.roundTripPublicKey;
    return !isAes(method) && normalises(method) ? UI.roundTripNormalised : UI.roundTrip(sealed.bytes);
  }

  // Serialising a large envelope is costly, so its text is written only when the envelope changes.
  let shownEnvelope: Envelope | undefined;
  // The same for opened content: it can be tens of megabytes, and its file name is the sender's.
  let shownOpened: Content | null = null;

  /** The bottom bar's one line: the side in view's own note, or what that side is waiting on. */
  function statusLine(): Note | null {
    if (state.view === 'open') return state.opening.kind === 'ready' && state.opening.busy ? { text: UI.opening, kind: 'busy' } : state.openNote;
    const blocked = sealBlocked();
    return state.sealNote ?? (blocked ? { text: blocked, kind: 'fail' } : null);
  }

  function renderSeal(): void {
    const spec = methodSpec(state.method);
    const key = sealKey();
    const sealed = state.phase.kind === 'sealed' ? state.phase : null;
    root.querySelectorAll<HTMLInputElement>('input[name="view"]').forEach((r) => (r.checked = r.value === state.view));
    root.querySelectorAll<HTMLInputElement>('input[name="method"]').forEach((r) => (r.checked = r.value === state.method));
    root.querySelectorAll<HTMLInputElement>('input[name="kind"]').forEach((r) => (r.checked = r.value === state.contentKind));
    root.querySelectorAll<HTMLInputElement>('input[name="key"]').forEach((r) => {
      r.checked = r.value === state.dataKey;
      r.disabled = !(isDataKey(r.value) && available(r.value));
    });
    e['data-keys'].hidden = spec.family !== 'aes';
    e['x25519-note'].hidden = state.x25519 || !keysOf(state.method).includes('publickey');
    root.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => (panel.hidden = panel.dataset.panel !== key));
    e['d-method'].textContent = METHOD_TEXT[state.method].name;
    e['d-key'].textContent = DETAIL_TEXT[key];
    e['d-nonce'].textContent = spec.family === 'aes' ? UI.nonceDetail(spec.cipher.nonceBytes) : UI.noNonce;
    e.letter.hidden = state.contentKind === 'file';
    e.drop.hidden = state.contentKind !== 'file';
    e['file-name'].textContent = state.file ? UI.fileCard(state.file.name, state.file.size) : '';
    const blocked = sealBlocked();
    e.seal.disabled =
      state.phase.kind === 'sealing' || blocked !== null || (spec.grade === 'insecure' && !e.ack.checked) || (key === 'generated' && (!e.gate.checked || e.generated.value === '')) || (key === 'publickey' && !state.x25519);
    e['key-copy'].textContent = state.keyCopy && state.keyCopy.value === e.generated.value ? (state.keyCopy.ok ? UI.copied : UI.copyBlocked) : UI.copy;
    e['make-pair'].disabled = state.pairing;
    e['own-pub-row'].hidden = e['own-pub'].value === '';
    say(e['pair-status'], state.pair);
    say(e.roundtrip, sealed ? { text: roundTripText(sealed), kind: 'ok' } : null);
    if (sealed?.envelope !== shownEnvelope) {
      shownEnvelope = sealed?.envelope;
      e['envelope-json'].textContent = sealed ? serialize(sealed.envelope) : '';
    }
    e.download.disabled = !sealed;
    e.copy.disabled = !sealed;
    e.copied.textContent = sealed && state.envelopeCopy?.envelope === sealed.envelope ? (state.envelopeCopy.ok ? UI.copied : UI.copyBlocked) : '';
  }

  /** The line under what was opened: what its method and its key cannot check. */
  function openedNote(envelope: Envelope): string {
    const method = envelope.method;
    if (!isAes(method)) return normalises(method) ? `${UI.learnGarbled} ${UI.learnNormalised}` : UI.learnGarbled;
    if (envelope.opensWith === 'publickey') return UI.openedAnySender;
    return aesSpec(method).cipher.authenticated ? '' : UI.openedUnchecked;
  }

  function renderOpen(): void {
    const opening = state.opening;
    const ready = opening.kind === 'ready' ? opening : null;
    say(
      e['open-needs'],
      opening.kind === 'invalid'
        ? { text: opening.message, kind: 'fail' }
        : ready
          ? { text: UI.opensWith(`${METHOD_TEXT[ready.envelope.method].plain} (${METHOD_TEXT[ready.envelope.method].name})`, GRADE_TEXT[gradeOf(ready.envelope.method)], KEY_TEXT[ready.envelope.opensWith].short), kind: 'ok' }
          : null,
    );
    root.querySelectorAll<HTMLElement>('[data-open-panel]').forEach((panel) => (panel.hidden = panel.dataset.openPanel !== ready?.envelope.opensWith));
    e.open.disabled = !ready || ready.busy;
    const opened = ready?.opened ?? null;
    if (opened !== shownOpened) {
      shownOpened = opened;
      const name = opened?.kind === 'file' ? safeFileName(opened.name) : '';
      e.opened.replaceChildren(...(opened === null ? [] : opened.kind === 'text' ? [opened.text] : [UI.openedFile, senderName(name)]));
      e['save-opened'].hidden = opened?.kind !== 'file';
      e['save-opened'].textContent = opened?.kind === 'file' ? UI.saveFile : '';
    }
    e['opened-note'].textContent = ready && opened ? openedNote(ready.envelope) : '';
  }

  function render(): void {
    if (listeners.signal.aborted) return; // unmounted: a timer or a late result has nothing to draw on
    const s = subject();
    root.dataset.view = state.view;
    root.dataset.state = state.phase.kind;
    if (s) root.dataset.grade = gradeOf(s.method);
    else delete root.dataset.grade;
    renderSeal();
    renderOpen();
    say(e.status, statusLine());
    paint(s);
  }

  /** Forgets the last seal: something that went into it changed. Never clears what the user typed. */
  function invalidate(): void {
    state.run += 1;
    state.phase = { kind: 'idle' };
    state.sealNote = null;
    state.envelopeCopy = null;
    render();
  }

  // ---- sealing ----

  async function sealContent(): Promise<Content> {
    if (state.contentKind === 'text') return { kind: 'text', text: e.letter.value };
    const file = state.file;
    if (!file) throw new CipherError('empty-input');
    assertWithinLimit(file.size); // before reading it into memory
    const bytes = new Uint8Array(await readFile(file, MAX_INPUT_BYTES, (f) => f.arrayBuffer()));
    return { kind: 'file', name: file.name, type: file.type || 'application/octet-stream', bytes };
  }

  async function sealNow(): Promise<void> {
    const run = ++state.run;
    state.phase = { kind: 'sealing' };
    state.sealNote = { text: UI.sealing, kind: 'busy' };
    render();
    try {
      const secret = await KEY_PANELS[sealKey()].sealSecret(e);
      const content = await sealContent();
      const envelope = await seal(state.method, content, secret);
      if (run !== state.run) return; // its inputs changed while it ran
      state.phase = { kind: 'sealed', envelope, bytes: contentBytes(content), revealed: reduced() };
      state.sealNote = { text: UI.sealedStatus, kind: 'ok' };
      render();
      const wait = reduced() ? 0 : 900;
      // The flap closes once the tint has swept the letter, unless something changed meanwhile.
      setTimeout(() => {
        if (run === state.run && state.phase.kind === 'sealed') {
          state.phase = { ...state.phase, revealed: true };
          render();
        }
      }, wait);
      if (phone() && state.view === 'seal') {
        selectTab('envelope');
        setTimeout(() => run === state.run && state.view === 'seal' && e.right.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }), wait + 300);
      }
    } catch (error) {
      if (run !== state.run) return;
      state.phase = { kind: 'idle' };
      state.sealNote = { text: message(error), kind: 'fail' };
      render();
    }
  }

  // ---- opening ----

  function openingFrom(text: string): Opening {
    if (!text) return { kind: 'none' };
    try {
      const envelope = parse(text);
      return isAes(envelope.method) && !webCrypto ? { kind: 'invalid', text, message: UI.noWebCrypto } : { kind: 'ready', text, envelope, opened: null, busy: false };
    } catch (error) {
      return { kind: 'invalid', text, message: message(error) };
    }
  }

  /** A new envelope to open: an open still running for the old one is dropped, and so is its note. */
  function setOpening(opening: Opening): void {
    state.opening = opening;
    state.openNote = null;
    render();
  }

  const openingText = () => (state.opening.kind === 'none' ? '' : state.opening.text);

  /**
   * The box was given what it already holds: the same envelope again, by drop, choice or paste, or
   * an edit that changed nothing. It stays, and so does any open running. A paste or an edit also
   * lets a different file still being read finish; a drop or a choice is a newer choice, and has
   * already replaced that file. A refused file's note goes, since the user has moved on from that
   * file; an open's own note stays.
   */
  function sameEnvelopeAgain(): void {
    if (!state.openNote?.refusal) return;
    state.openNote = null;
    render();
  }

  /** The envelope box changed: a different envelope typed or pasted replaces any file still being read. */
  function readOpening(): void {
    const text = e['open-in'].value.trim();
    if (text === openingText()) return sameEnvelopeAgain();
    state.source += 1;
    setOpening(openingFrom(text));
  }

  /** A key on the open side changed: what an older key opened, or is opening, no longer applies. */
  function openKeyChanged(): void {
    if (state.opening.kind === 'ready') state.opening = { ...state.opening, opened: null, busy: false };
    state.openNote = null;
    render();
  }

  async function openNow(): Promise<void> {
    if (state.opening.kind !== 'ready' || state.opening.busy) return;
    // Opening can take seconds (an envelope may ask for 10,000,000 iterations), so Open waits while
    // one runs; a changed key or envelope abandons it rather than waiting for it. A new attempt clears
    // the last one's result and note, so nothing shown belongs to an older attempt.
    const opening = { ...state.opening, opened: null, busy: true };
    state.opening = opening;
    state.openNote = null;
    render();
    try {
      const opened = await open(opening.envelope, await KEY_PANELS[opening.envelope.opensWith].openSecret(e));
      if (state.opening !== opening) return; // a different envelope or key was given meanwhile
      state.opening = { ...opening, opened, busy: false };
      render();
      if (phone() && state.view === 'open' && !listeners.signal.aborted) e.centre.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    } catch (error) {
      if (state.opening !== opening) return;
      state.opening = { ...opening, busy: false };
      state.openNote = { text: message(error), kind: 'fail', refusal: false };
      render();
    }
  }

  /**
   * Reads a chosen or dropped file as the envelope to open. Only an envelope goes into the box: any
   * other file (a private-key file dropped beside its own input, say) is refused without being shown,
   * and the envelope already there stays.
   */
  async function readEnvelopeFile(file: File): Promise<void> {
    const source = ++state.source;
    let opening: Opening;
    try {
      opening = openingFrom((await readFile(file, MAX_ENVELOPE_BYTES, (f) => f.text())).trim());
    } catch (error) {
      opening = { kind: 'invalid', text: '', message: message(error) };
    }
    if (source !== state.source) return; // a later paste or file replaced it while it was read
    if (opening.kind !== 'ready') {
      state.openNote = { text: opening.kind === 'invalid' ? opening.message : ERROR_TEXT['not-envelope'](), kind: 'fail', refusal: true };
      return render();
    }
    if (opening.text === openingText()) return sameEnvelopeAgain();
    e['open-in'].value = opening.text;
    setOpening(opening);
  }

  // ---- events ----

  // The cast is safe: an event named K is dispatched as HTMLElementEventMap[K], which is what the handler takes.
  const on = <K extends keyof HTMLElementEventMap>(target: EventTarget, type: K, handler: (event: HTMLElementEventMap[K]) => void) =>
    target.addEventListener(type, handler as EventListener, { signal: listeners.signal });

  // Everything in the seal controls: a choice of method or key changes the state, the saved-key
  // checkbox only unlocks Seal, and any other edit means the last seal no longer matches.
  const sealControl = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type === 'radio') {
      if (event.type !== 'change') return;
      if (target.name === 'method' && isMethodId(target.value)) {
        state.method = target.value;
        if (gradeOf(state.method) !== 'insecure') e.ack.checked = false;
        keepKeyAvailable();
      }
      if (target.name === 'key' && isDataKey(target.value)) state.dataKey = target.value;
      invalidate();
      return;
    }
    if (target === e.gate) return render();
    // Checkboxes and file pickers report a choice as `change`. A typed field reports every edit as
    // `input`; its `change` on losing focus repeats one already handled, and acting on it would throw
    // away a seal made since (with Ctrl/⌘+Enter, the next click anywhere would).
    if (event.type === 'change' && target.type !== 'checkbox' && target.type !== 'file') return;
    invalidate();
  };
  on(e['seal-body'], 'input', sealControl);
  on(e['seal-body'], 'change', sealControl);
  // The acknowledgment sits in the bottom bar, outside the seal controls: it only unlocks Seal.
  on(e.ack, 'change', render);
  on(e.letter, 'input', invalidate);
  root.querySelectorAll<HTMLInputElement>('input[name="kind"]').forEach((r) =>
    on(r, 'change', () => {
      state.contentKind = r.value === 'file' ? 'file' : 'text';
      invalidate();
    }),
  );
  const chooseFile = (file: File | null) => {
    state.file = file;
    invalidate();
  };
  on(e.file, 'change', () => {
    const file = e.file.files?.[0] ?? null;
    e.file.value = ''; // so that choosing the same file again is a change
    chooseFile(file);
  });
  on(e.drop, 'dragover', (event) => {
    event.preventDefault();
    e.drop.dataset.over = '1';
  });
  on(e.drop, 'dragleave', () => delete e.drop.dataset.over);
  on(e.drop, 'drop', (event) => {
    event.preventDefault();
    delete e.drop.dataset.over;
    const dropped = event.dataTransfer?.files[0];
    if (dropped) chooseFile(dropped);
  });
  // A file dropped where nothing takes it makes the browser open it, leaving the page and everything
  // typed into it. The seal drop zone and file inputs take their own drops; on the open side, the
  // "Envelope to open" section reads a dropped file as the envelope; anywhere else a file drop is
  // refused. Text drags are left alone.
  const carriesFile = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  const takesOwnDrop = (target: EventTarget | null) => target instanceof HTMLInputElement && target.type === 'file';
  const onEnvelopeSource = (target: EventTarget | null) => state.view === 'open' && target instanceof Node && e['open-source'].contains(target);
  on(document, 'dragover', (event) => {
    if (!carriesFile(event) || event.defaultPrevented || takesOwnDrop(event.target)) return;
    event.preventDefault();
    if (event.dataTransfer && !onEnvelopeSource(event.target)) event.dataTransfer.dropEffect = 'none';
  });
  on(document, 'drop', (event) => {
    if (!carriesFile(event) || event.defaultPrevented || takesOwnDrop(event.target)) return;
    event.preventDefault();
    const dropped = event.dataTransfer?.files[0];
    if (dropped && onEnvelopeSource(event.target)) void readEnvelopeFile(dropped);
  });

  on(e.seal, 'click', () => void sealNow());
  on(e.download, 'click', () => state.phase.kind === 'sealed' && saveFile('sealed.cipher-envelope.json', serialize(state.phase.envelope), 'application/json'));
  on(e.copy, 'click', async () => {
    if (state.phase.kind !== 'sealed') return;
    const envelope = state.phase.envelope;
    const ok = await copyText(serialize(envelope));
    if (!ok) selectText(e['envelope-json']);
    state.envelopeCopy = { envelope, ok };
    render();
  });
  on(e.generate, 'click', () => {
    e.generated.value = toBase64Url(randomBytes(KEY_BYTES));
    e.gate.checked = false;
    state.keyCopy = null;
    invalidate();
  });
  on(e['key-copy'], 'click', async () => {
    const value = e.generated.value;
    const ok = await copyText(value);
    if (!ok) e.generated.select();
    state.keyCopy = { value, ok };
    render();
  });
  on(e['pw-toggle'], 'click', () => {
    const show = e.password.type === 'password';
    e.password.type = show ? 'text' : 'password';
    e['pw-toggle'].textContent = show ? UI.hide : UI.show;
    e['pw-toggle'].setAttribute('aria-pressed', String(show));
  });
  on(e['make-pair'], 'click', async () => {
    if (state.pairing) return;
    state.pairing = true;
    render();
    try {
      const pair = await makeKeyPair();
      if (listeners.signal.aborted) return; // unmounted while it was made: offer nothing
      // The file first: the public key is shown only once its private key has been offered.
      saveFile(PRIVATE_KEY_FILE, JSON.stringify(pair.privateKeyFile, null, 2) + '\n', 'application/json');
      e['own-pub'].value = pair.publicKey;
      state.pair = { text: UI.pairMade(PRIVATE_KEY_FILE), kind: 'ok' };
    } catch (error) {
      state.pair = { text: message(error), kind: 'fail' };
    }
    state.pairing = false;
    render();
  });

  on(e['open-in'], 'input', readOpening);
  on(e['open-file'], 'change', () => {
    const file = e['open-file'].files?.[0];
    e['open-file'].value = ''; // so that choosing the same file again is a change
    if (file) void readEnvelopeFile(file);
  });
  // The open side's key fields also feed the "How it works" drawing for classical envelopes.
  root.querySelectorAll<HTMLElement>('[data-open-panel]').forEach((panel) => on(panel, 'input', openKeyChanged));
  on(e.open, 'click', () => void openNow());
  on(e['save-opened'], 'click', () => {
    const opened = state.opening.kind === 'ready' ? state.opening.opened : null;
    // Saved as plain bytes, not with the type the envelope names: that type comes from whoever
    // sealed the envelope, and a crafted one should not decide how the browser treats the file.
    if (opened?.kind === 'file') saveFile(safeFileName(opened.name), opened.bytes, 'application/octet-stream');
  });

  root.querySelectorAll<HTMLInputElement>('input[name="view"]').forEach((r) =>
    on(r, 'change', () => {
      state.view = r.value === 'open' ? 'open' : 'seal';
      render();
    }),
  );
  function selectTab(tab: string): void {
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    root.querySelectorAll<HTMLElement>('[data-view-pane]').forEach((pane) => (pane.hidden = pane.dataset.viewPane !== tab));
  }
  root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => on(b, 'click', () => selectTab(b.dataset.tab ?? 'envelope')));
  on(e['hide-right'], 'click', () => (root.dataset.right = 'hidden'));
  on(e['show-right'], 'click', () => delete root.dataset.right);
  on(document, 'keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.repeat) {
      const button = state.view === 'open' ? e.open : e.seal;
      if (!button.disabled) {
        event.preventDefault();
        button.click();
      }
    }
  });
  const stopScheme = onSchemeChange(render);

  render();
  void supportsX25519().then((ok) => {
    state.x25519 = ok;
    keepKeyAvailable();
    render();
  });

  return () => {
    listeners.abort();
    stopScheme();
    state.run += 1; // a seal still running is dropped, and its timers find a different run
  };
}
