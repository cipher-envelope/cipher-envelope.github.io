import { expect, test } from 'vitest';
import { policyFor, sha256Hex, withPolicy } from '../build/csp';

// The hashes were computed with openssl (sha256, base64) from the same script text.

// How every page the build accepts starts, as index.html does: the policy goes straight after it.
const HEAD = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8"></head>';
const NOT_THE_START =
  'page.html: does not start as PAGE_START in build/csp.ts says: <!doctype html>, <html lang="en">, <head> and <meta charset="utf-8">, one per line with LF endings. If index.html now starts differently on purpose, change PAGE_START in build/csp.ts and build/output.ts';

test('the policy allows each inline script by its hash and nothing else', async () => {
  const { policy } = await withPolicy(`${HEAD}<body><script>console.log(1)</script><script type="module">console.log(2)</script></body></html>`, 'page.html');
  expect(policy).toBe(
    "default-src 'none'; script-src 'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M=' 'sha256-8q5r0Gb3oV+3DObfp/Z4GOXgHcQVy/ejxH8MgPcPxTI='; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'",
  );
});

test('a page whose head does not start with the utf-8 charset is refused', async () => {
  await expect(withPolicy(`${HEAD.replace('<meta charset="utf-8">', '<title>x</title>')}<body><script>console.log(1)</script></body></html>`, 'page.html')).rejects.toThrow(
    NOT_THE_START,
  );
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
  await expect(withPolicy('<!doctype html>\n<html lang="en">\n<body><script>x()</script></body></html>', 'page.html')).rejects.toThrow(
    NOT_THE_START,
  );
});

test('the published hash is SHA-256 in hex: the FIPS 180-2 "abc" vector', async () => {
  expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('a script body is hashed exactly as written, with its surrounding newlines', async () => {
  const { policy } = await withPolicy(`${HEAD}<body><script>\nconsole.log(1)\n</script></body></html>`, 'page.html');
  expect(policy).toContain("'sha256-yktKiAsZWmc8WpOyhnmhQoDf9G2dAZvuBBC+V0LGQhg='");
});

test('a script loaded by a src written with spaces around its equals sign is refused, not hashed', async () => {
  await expect(withPolicy('<html><head></head><body><script src = "/a.js">x()</script></body></html>', 'page.html')).rejects.toThrow('page.html: a script is not inlined');
});

test('the policy is placed straight after the charset at the start of the head', async () => {
  const { html } = await withPolicy('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>x</title></head><body><script>console.log(1)</script></body></html>', 'page.html');
  expect(html.startsWith('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy"')).toBe(true);
});

test('a script tag in upper case is hashed like any other', async () => {
  const { policy } = await withPolicy(`${HEAD}<body><SCRIPT>console.log(1)</SCRIPT></body></html>`, 'page.html');
  expect(policy).toContain("'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='");
});

test('a script loaded by a src written in upper case is refused, not hashed', async () => {
  await expect(withPolicy('<html><head></head><body><SCRIPT SRC="/a.js">x()</SCRIPT></body></html>', 'page.html')).rejects.toThrow('page.html: a script is not inlined');
});

test('a charset inside a comment is not taken for the start of the head', async () => {
  await expect(withPolicy(`${HEAD.replace('<head>\n', '<head>\n<!-- <meta charset="utf-8"> -->')}<body><script>console.log(1)</script></body></html>`, 'page.html')).rejects.toThrow(
    NOT_THE_START,
  );
});

test('a script closed by </script > is hashed like any other', async () => {
  const { policy } = await withPolicy(`${HEAD}<body><script>console.log(1)</script ></body></html>`, 'page.html');
  expect(policy).toContain("'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='");
});

test('a space that HTML does not count as white space after <head> is refused', async () => {
  await expect(withPolicy(`${HEAD.replace('<head>\n', '<head>\u00a0')}<body><script>console.log(1)</script></body></html>`, 'page.html')).rejects.toThrow(NOT_THE_START);
});

test('anything before the doctype is refused', async () => {
  await expect(withPolicy(`<!-- x -->${HEAD}<body><script>console.log(1)</script></body></html>`, 'page.html')).rejects.toThrow(NOT_THE_START);
});

test('an element named like html is refused', async () => {
  await expect(withPolicy(`${HEAD.replace('<html lang="en">', '<htmlx lang="en">')}<body><script>console.log(1)</script></body></html>`, 'page.html')).rejects.toThrow(NOT_THE_START);
});

test('the build writes the policy straight after the start and keeps the rest of the page as it was', async () => {
  expect((await withPolicy(`${HEAD}<body><script>console.log(1)</script></body></html>`, 'page.html')).html).toBe(
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"></head><body><script>console.log(1)</script></body></html>`,
  );
});

test('a data-src attribute is not taken for a source, so its script is hashed', async () => {
  const { policy } = await withPolicy(`${HEAD}<body><script data-src="a.js">console.log(1)</script></body></html>`, 'page.html');
  expect(policy).toContain("'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='");
});

test('a src written straight after a slash is refused, not hashed', async () => {
  await expect(withPolicy(`${HEAD}<body><script/src="/a.js">x()</script></body></html>`, 'page.html')).rejects.toThrow('page.html: a script is not inlined');
});

test('a src written straight after a quoted value is refused, not hashed', async () => {
  await expect(withPolicy(`${HEAD}<body><script type="module"src="/a.js">x()</script></body></html>`, 'page.html')).rejects.toThrow('page.html: a script is not inlined');
});
