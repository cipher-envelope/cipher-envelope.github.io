// Adds a Content-Security-Policy to the single-file build. The policy allows exactly the inline
// scripts the build produced, by hash, and no network connection, so the browser itself blocks the
// page's fetches and other connections, its sub-resources and its form submissions. A policy cannot
// stop a page navigating away or using WebRTC; the app has no code that does either. Nor does it
// cover other pages on the same origin, so the hosted app needs an origin it does not share.

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

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

/** Returns the page with the policy as the first element of `<head>`, before any script. `file` names the page in a refusal. */
export async function withPolicy(html: string, file: string): Promise<{ html: string; policy: string }> {
  const scripts = Array.from(html.matchAll(SCRIPT), (m) => ({ attributes: m[1] ?? '', body: m[2] ?? '' }));
  if (scripts.length === 0) throw new Error(`${file}: no inline script to allow`);
  // A script still loaded by src, or an empty one, means inlining has not happened yet: hashing it
  // would allow nothing and block the app, so refuse rather than publish a page that cannot run.
  if (scripts.some((s) => /\bsrc\s*=/.test(s.attributes) || s.body.trim() === '')) throw new Error(`${file}: a script is not inlined`);
  const bodies = scripts.map((s) => s.body);
  const policy = policyFor(await Promise.all(bodies.map(sha256Base64)));
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  if (!/<head>/i.test(html)) throw new Error(`${file}: no <head> to put the policy in`);
  return { html: html.replace(/<head>/i, `<head>\n${meta}`), policy };
}
