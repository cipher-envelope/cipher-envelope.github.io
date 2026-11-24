import { expect, test } from 'vitest';
import { policyFor, sha256Hex, withPolicy } from '../build/csp';

// The hashes were computed with openssl (sha256, base64) from the same script text.

test('the policy allows each inline script by its hash and nothing else', async () => {
  const { policy } = await withPolicy('<html><head></head><body><script>console.log(1)</script><script type="module">console.log(2)</script></body></html>', 'page.html');
  expect(policy).toBe(
    "default-src 'none'; script-src 'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M=' 'sha256-8q5r0Gb3oV+3DObfp/Z4GOXgHcQVy/ejxH8MgPcPxTI='; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'",
  );
});

test('the policy is placed first in the head', async () => {
  const { html } = await withPolicy('<html><head><title>x</title></head><body><script>console.log(1)</script></body></html>', 'page.html');
  expect(html.startsWith('<html><head>\n<meta http-equiv="Content-Security-Policy"')).toBe(true);
});

test('a page without an inline script is refused, naming the page', async () => {
  await expect(withPolicy('<html><head></head><body></body></html>', 'page.html')).rejects.toThrow('page.html: no inline script to allow');
});

test('a script still loaded from a file is refused, not hashed', async () => {
  await expect(withPolicy('<html><head></head><body><script type="module" src="/assets/index.js"></script></body></html>', 'page.html')).rejects.toThrow('page.html: a script is not inlined');
});

test('no network connection is ever allowed', () => {
  expect(policyFor(['x'])).toContain("connect-src 'none'");
});

test('a script with a source and a body is refused, not hashed', async () => {
  await expect(withPolicy('<html><head></head><body><script src="/a.js">x()</script></body></html>', 'page.html')).rejects.toThrow('page.html: a script is not inlined');
});

test('an empty inline script is refused', async () => {
  await expect(withPolicy('<html><head></head><body><script> </script></body></html>', 'page.html')).rejects.toThrow('page.html: a script is not inlined');
});

test('a page without a head is refused, rather than published without a policy', async () => {
  await expect(withPolicy('<html><body><script>x()</script></body></html>', 'page.html')).rejects.toThrow('page.html: no <head> to put the policy in');
});

test('the published hash is SHA-256 in hex: the FIPS 180-2 "abc" vector', async () => {
  expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('a script body is hashed exactly as written, with its surrounding newlines', async () => {
  const { policy } = await withPolicy('<html><head></head><body><script>\nconsole.log(1)\n</script></body></html>', 'page.html');
  expect(policy).toContain("'sha256-yktKiAsZWmc8WpOyhnmhQoDf9G2dAZvuBBC+V0LGQhg='");
});

test('a script loaded by a src written with spaces around its equals sign is refused, not hashed', async () => {
  await expect(withPolicy('<html><head></head><body><script src = "/a.js">x()</script></body></html>', 'page.html')).rejects.toThrow('page.html: a script is not inlined');
});
