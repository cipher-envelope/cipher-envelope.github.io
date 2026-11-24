// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { type PageWindow, start } from '../src/ui/start';

// jsdom has no matchMedia; the workbench only asks it about phone width, motion and dark mode.
window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

// The address as a framing page may load it, with a query and a fragment of its choosing, and an
// `&amp;` in its path that must reach the page as text, never as markup.
const ADDRESS = 'https://example.org/a&amp;b/cipher-envelope.html?q=1#h';
const NOTICE = '<p>cipher-envelope does not run inside another page, so that page cannot watch or steer what you type into it. To use it, open this address in a tab of its own:</p>';
// A window is the top window when its `top` is the window itself.
const TOP_WINDOW: PageWindow = {
  get top() {
    return TOP_WINDOW;
  },
  location: { href: ADDRESS },
};
const FRAMED_WINDOW: PageWindow = { top: {}, location: { href: ADDRESS } };
// A framed window whose `self` another page overwrote to look like its top: still framed.
const OTHER = {};
const SELF_OVERWRITTEN = { top: OTHER, self: OTHER, location: { href: ADDRESS } };
// The offline file, opened from disk inside another page.
const FRAMED_FILE: PageWindow = { top: {}, location: { href: 'file:///tmp/cipher-envelope.html?q=1#h' } };

// Filled with a control first, to show that the notice replaces whatever the root held.
const FRAMED = Object.assign(document.createElement('div'), { innerHTML: '<button>left over</button>' });
start(FRAMED, FRAMED_WINDOW);
const ON_TOP = document.createElement('div');
start(ON_TOP, TOP_WINDOW);
const SPOOFED = document.createElement('div');
start(SPOOFED, SELF_OVERWRITTEN);
const FILE = document.createElement('div');
start(FILE, FRAMED_FILE);

test('inside a frame, the root holds only the notice and, on its own line, the address to open', () => {
  expect(FRAMED.outerHTML).toBe(`<div>${NOTICE}<p>https://example.org/a&amp;amp;b/cipher-envelope.html</p></div>`);
});
test('inside a frame, there is nothing to type into, press or follow', () => {
  expect(FRAMED.querySelectorAll('input, textarea, select, button, a, [contenteditable], [tabindex]').length).toBe(0);
});
test('as the top window, the workbench mounts', () => {
  expect(ON_TOP.textContent).toContain('Seal the envelope');
});
test('a framed window whose self was overwritten to match its top still refuses', () => {
  expect(SPOOFED.outerHTML).toBe(`<div>${NOTICE}<p>https://example.org/a&amp;amp;b/cipher-envelope.html</p></div>`);
});
test('the offline file opened inside another page refuses too, showing its own path', () => {
  expect(FILE.outerHTML).toBe(`<div>${NOTICE}<p>file:///tmp/cipher-envelope.html</p></div>`);
});
