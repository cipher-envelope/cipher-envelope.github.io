// Adds a Content-Security-Policy to the single-file build. The policy allows exactly the inline
// scripts the build produced, by hash, and no network connection, so the browser itself blocks the
// page's fetches and other connections, its sub-resources and its form submissions. A policy cannot
// stop a page navigating away or using WebRTC; the app has no code that does either. Nor does it
// cover other pages on the same origin, so the hosted app needs an origin it does not share.

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
/**
 * How every page must start, exactly as `index.html` does; the policy goes straight after it.
 * Anything else first, even one character that HTML does not count as white space, can make the
 * browser close the head before the policy and ignore it. Written out rather than matched, so nothing
 * can match loosely: a change to the start of `index.html` is made here and in `build/output.ts`.
 */
const PAGE_START = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">';

/** A script tag in a page, in any letter case. */
export interface Script {
  readonly attributes: string;
  readonly body: string;
}

/** The page's script tags, in order. The build and the check of its output both read them here. */
export function scriptTags(html: string): Script[] {
  return Array.from(html.matchAll(SCRIPT), (m) => ({ attributes: m[1] ?? '', body: m[2] ?? '' }));
}

/**
 * Whether a script is loaded from a file rather than written into the page: whether it has a `src`
 * attribute with a value. In HTML an attribute name follows white space, a `/` or the closing quote of the value
 * before it, so `src` counts only there. `\bsrc` also took `data-src` for a source, and white space
 * alone missed `<script/src=…>` and `type="module"src=…`.
 */
export const loadsFromFile = (script: Script): boolean => /[\t\n\f\r "'/]src[\t\n\f\r ]*=/i.test(script.attributes);

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The policy that allows exactly these scripts, each by the hash of its body. */
async function policyForScripts(scripts: readonly Script[]): Promise<string> {
  return policyFor(await Promise.all(scripts.map((s) => sha256Base64(s.body))));
}

/**
 * The policy the page carries. The check of the published page writes the same policy out again,
 * in `build/output.ts`, so a change here is made there too.
 */
export function policyFor(scriptHashes: readonly string[]): string {
  const scripts = scriptHashes.map((h) => `'sha256-${h}'`).join(' ');
  return [
    "default-src 'none'",
    `script-src ${scripts}`,
    // Styles are inline in a single file; the handwriting font's face is added at runtime.
    "style-src 'unsafe-inline'",
    'font-src data:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * Returns the page with the policy straight after its start (`PAGE_START`). Nothing can then come
 * before the policy, and the charset ends well within the first 1,024 bytes, where the browser
 * looks for it. A page that starts any other way is refused. `file` names the page in a refusal.
 */
export async function withPolicy(html: string, file: string): Promise<{ html: string; policy: string }> {
  const scripts = scriptTags(html);
  if (scripts.length === 0) throw new Error(`${file}: no inline script to allow`);
  // A script still loaded by src, or an empty one, means inlining has not happened yet: hashing it
  // would allow nothing and block the app, so refuse rather than publish a page that cannot run.
  if (scripts.some((s) => loadsFromFile(s) || s.body.trim() === '')) throw new Error(`${file}: a script is not inlined`);
  if (!html.startsWith(PAGE_START)) {
    throw new Error(
      `${file}: does not start as PAGE_START in build/csp.ts says: <!doctype html>, <html lang="en">, <head> and <meta charset="utf-8">, one per line with LF endings. If index.html now starts differently on purpose, change PAGE_START in build/csp.ts and build/output.ts`,
    );
  }
  const policy = await policyForScripts(scripts);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  return { html: `${PAGE_START}\n${meta}${html.slice(PAGE_START.length)}`, policy };
}
