// @vitest-environment jsdom
import { expect, test } from 'vitest';

// jsdom has no matchMedia; the workbench only asks it about phone width, motion and dark mode.
window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

// The page's entry point, loaded as a framed page: its window's top and parent are another window,
// which is its own top. If the entry point mounted the workbench without going through `start`, or
// passed `start` another window than its own, the body would hold the workbench instead.
const FRAMER = {
  get top() {
    return FRAMER;
  },
};
document.body.innerHTML = '<div id="app"></div>';
Object.defineProperty(window, 'top', { value: FRAMER, configurable: true });
Object.defineProperty(window, 'parent', { value: FRAMER, configurable: true });
await import('../src/main');

test('the entry point refuses to run in a frame', () => {
  expect(document.body.innerHTML).toBe(
    '<div id="app"><p>cipher-envelope does not run inside another page, so that page cannot watch or steer what you type into it. To use it, open this address in a tab of its own:</p><p>http://localhost:3000/</p></div>',
  );
});
