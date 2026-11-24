// Starts the app, unless the page is inside a frame. GitHub Pages sends no header that could refuse
// framing, and a `<meta>` policy cannot, so the page itself declines: it mounts nothing another
// page could overlay or steer, and says why (docs/standards.md, the page's policy).

import { UI } from './catalog';
import { mountWorkbench } from './workbench';

/** What the start reads from the window: its top window, and its own address. */
export interface PageWindow {
  readonly top: unknown;
  readonly location: { readonly href: string };
}

/**
 * Mounts the workbench in `root` when `win` is the top window. `win.top === win` holds only there,
 * and neither side can be overwritten by another page, unlike `self`. Inside a frame, replaces
 * whatever is in `root` with a notice and the app's own address, without the framing page's query
 * or fragment, for the reader to open in a tab of their own. It is not a link: a tab opened from a
 * sandboxed frame inherits the sandbox, where saving a file fails without a word.
 */
export function start(root: HTMLElement, win: PageWindow): void {
  if (win.top === win) {
    mountWorkbench(root);
    return;
  }
  const address = new URL(win.location.href);
  address.search = '';
  address.hash = '';
  // The address on a line of its own, so the sentence's wrapping does not split the hosted address.
  // A long `file:` address can still wrap, or overflow, inside a narrow frame.
  root.replaceChildren(
    Object.assign(document.createElement('p'), { textContent: `${UI.framed} ${UI.framedOpen}` }),
    Object.assign(document.createElement('p'), { textContent: address.href }),
  );
}
