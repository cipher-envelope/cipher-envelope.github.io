// @vitest-environment jsdom
import { expect, test } from 'vitest';

// jsdom has no matchMedia; the workbench only asks it about phone width, motion and dark mode.
window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

// The page's entry point, loaded as the top window. If it passed `start` anything but its own
// window, the check would take it for a frame and show only the notice.
document.body.innerHTML = '<div id="app"></div>';
await import('../src/main');

test('the entry point mounts the workbench in the top window', () => {
  expect(document.getElementById('app')?.textContent).toContain('Seal the envelope');
});
