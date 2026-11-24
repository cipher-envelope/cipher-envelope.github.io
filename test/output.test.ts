import { expect, test } from 'vitest';
import { sha256Hex, withPolicy } from '../build/csp';
import { checkOutput, OUTPUT } from '../build/output';

// Pages built the way the build builds them, by withPolicy, then broken one rule at a time.
const built = async (head: string, body: string) => (await withPolicy(`<!doctype html>\n<html lang="en">\n<head>${head}</head>\n<body>${body}</body>\n</html>\n`, OUTPUT)).html;
const hashLineOf = async (page: string) => `${await sha256Hex(new TextEncoder().encode(page))}  ${OUTPUT}\n`;

const NOT_THE_START =
  'cipher-envelope.html: does not start as PAGE_START in build/output.ts says: <!doctype html>, <html lang="en">, <head>, <meta charset="utf-8"> and the content policy, one per line with LF endings';
const WRONG_POLICY = 'cipher-envelope.html: the content policy at the start is not the one written out in build/output.ts';
// Written in parts, so this file holds no home-folder path written out whole.
const MAC_HOME = ['', 'Users', 'someone'].join('/');

const PAGE = await built('\n<meta charset="utf-8">\n<title>t</title>\n', '<script type="module">console.log(1)</script>');
const POLICY_TAG = /<meta http-equiv="Content-Security-Policy"[^>]*>/.exec(PAGE)?.[0] ?? '';
const PAGE_HEX = await sha256Hex(new TextEncoder().encode(PAGE));
const UNHASHED_SCRIPT = PAGE.replace('</body>', '<script>alert(1)</script></body>');
const UPPER_CASE_SCRIPT = PAGE.replace('</body>', '<SCRIPT>alert(1)</SCRIPT></body>');
const SPACED_END_TAG = PAGE.replace('</body>', '<script>alert(1)</script ></body>');
const LOADED_SCRIPT = PAGE.replace('</body>', '<script src="app.js"></script></body>');
const NO_POLICY = PAGE.replace(POLICY_TAG, '');
const TWO_POLICIES = PAGE.replace(POLICY_TAG, POLICY_TAG + POLICY_TAG);
const UPPER_CASE_SECOND_POLICY = PAGE.replace(POLICY_TAG, POLICY_TAG + POLICY_TAG.replace('<meta http-equiv', '<META HTTP-EQUIV'));
const POLICY_IN_BODY = NO_POLICY.replace('<body>', `<body>${POLICY_TAG}`);
const SCRIPT_FIRST = PAGE.replace('<head>', '<head><script>console.log(2)</script>');
const COMMENT_FIRST = PAGE.replace('<head>', '<head><!-- note -->');
const TEXT_FIRST = PAGE.replace('<head>', '<head>cipher-envelope');
const OTHER_CHARSET_FIRST = PAGE.replace('<head>', '<head><meta charset="windows-1252">');
const SINGLE_QUOTED_CHARSET = PAGE.replace('<meta charset="utf-8">', "<meta charset='utf-8'>");
const SPACE_HTML_DOES_NOT_COUNT = PAGE.replace('<head>\n', '<head>\u00a0');
const OTHER_ELEMENT = PAGE.replace('<html lang="en">', '<htmlx lang="en">');
const COMMENT_BEFORE_DOCTYPE = `<!-- note -->${PAGE}`;
const OUTSIDE_ADDRESS = PAGE.replace('</body>', '<a href="https://example.org/x">x</a></body>');
const UPPER_CASE_ADDRESS = PAGE.replace('</body>', '<a href="HTTPS://EXAMPLE.ORG/X">x</a></body>');
const SCHEMELESS_ADDRESS = PAGE.replace('</head>', '<link rel="dns-prefetch" href="//example.org"></head>');
const SOCKET_ADDRESS = PAGE.replace('</body>', '<!-- wss://example.org/x --></body>');
const SOURCE_MAP = PAGE.replace('</body>', '<!-- //# sourceMappingURL=app.js.map --></body>');
const UPPER_CASE_SOURCE_MAP = PAGE.replace('</body>', '<!-- //# SOURCEMAPPINGURL=app.js.map --></body>');
const MACHINE_PATH = PAGE.replace('</body>', '<!-- /home/someone/build --></body>');
const MAC_MACHINE_PATH = PAGE.replace('</body>', `<!-- ${MAC_HOME}/build --></body>`);
const CONNECTIONS_ALLOWED = PAGE.replace("connect-src 'none'", 'connect-src *');
const DEFAULT_ALLOWED = PAGE.replace("default-src 'none'", 'default-src *');
const EXTRA_DIRECTIVE = PAGE.replace("form-action 'none'", "form-action 'none'; img-src *");
const EXTRA_SCRIPT_SOURCE = PAGE.replace('; style-src', " 'unsafe-inline'; style-src");
// The policy the browser applies is the tag at the start; a correct copy elsewhere must not pass it.
const EMPTY_POLICY_WITH_COPY = PAGE.replace(POLICY_TAG, '<meta http-equiv="Content-Security-Policy" content=""/>').replace('</body>', `<!-- ${POLICY_TAG} --></body>`);
const LOOSE_POLICY_HIDING_COPY = PAGE.replace(POLICY_TAG, `<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'; connect-src *" data-x='${POLICY_TAG}'>`);
const CARRIAGE_RETURN = await built('\n<meta charset="utf-8">\n', '<script>console.log(1)\r\n</script>');
const NUL = await built('\n<meta charset="utf-8">\n', '<script>console.log("\0")</script>');

test('a page as the build makes it, with its hash, passes', async () => {
  expect(await checkOutput(OUTPUT, PAGE, await hashLineOf(PAGE))).toEqual([]);
});
test('a script the policy does not allow fails', async () => {
  expect(await checkOutput(OUTPUT, UNHASHED_SCRIPT, await hashLineOf(UNHASHED_SCRIPT))).toEqual([WRONG_POLICY]);
});
test('a script tag in upper case is still checked against the policy', async () => {
  expect(await checkOutput(OUTPUT, UPPER_CASE_SCRIPT, await hashLineOf(UPPER_CASE_SCRIPT))).toEqual([WRONG_POLICY]);
});
test('a script closed by </script > is still checked against the policy', async () => {
  expect(await checkOutput(OUTPUT, SPACED_END_TAG, await hashLineOf(SPACED_END_TAG))).toEqual([WRONG_POLICY]);
});
test('a script loaded from a file fails', async () => {
  expect(await checkOutput(OUTPUT, LOADED_SCRIPT, await hashLineOf(LOADED_SCRIPT))).toEqual(['cipher-envelope.html: a script is loaded from a file', WRONG_POLICY]);
});
test('a page without a content policy fails', async () => {
  expect(await checkOutput(OUTPUT, NO_POLICY, await hashLineOf(NO_POLICY))).toEqual([NOT_THE_START, 'cipher-envelope.html: 0 content policies, not one']);
});
test('a page with two content policies fails', async () => {
  expect(await checkOutput(OUTPUT, TWO_POLICIES, await hashLineOf(TWO_POLICIES))).toEqual(['cipher-envelope.html: 2 content policies, not one']);
});
test('a second content policy in upper case is counted', async () => {
  expect(await checkOutput(OUTPUT, UPPER_CASE_SECOND_POLICY, await hashLineOf(UPPER_CASE_SECOND_POLICY))).toEqual(['cipher-envelope.html: 2 content policies, not one']);
});
test('a content policy outside the head fails, since the browser ignores it there', async () => {
  expect(await checkOutput(OUTPUT, POLICY_IN_BODY, await hashLineOf(POLICY_IN_BODY))).toEqual([NOT_THE_START]);
});
test('a script before the content policy fails', async () => {
  expect(await checkOutput(OUTPUT, SCRIPT_FIRST, await hashLineOf(SCRIPT_FIRST))).toEqual([NOT_THE_START]);
});
test('a comment before the charset fails, since it can hide the policy', async () => {
  expect(await checkOutput(OUTPUT, COMMENT_FIRST, await hashLineOf(COMMENT_FIRST))).toEqual([NOT_THE_START]);
});
test('text before the charset fails, since it closes the head before the policy', async () => {
  expect(await checkOutput(OUTPUT, TEXT_FIRST, await hashLineOf(TEXT_FIRST))).toEqual([NOT_THE_START]);
});
test('another charset before the utf-8 one fails', async () => {
  expect(await checkOutput(OUTPUT, OTHER_CHARSET_FIRST, await hashLineOf(OTHER_CHARSET_FIRST))).toEqual([NOT_THE_START]);
});
test('a charset in single quotes fails, since the page must start exactly as index.html does', async () => {
  expect(await checkOutput(OUTPUT, SINGLE_QUOTED_CHARSET, await hashLineOf(SINGLE_QUOTED_CHARSET))).toEqual([NOT_THE_START]);
});
test('a space that HTML does not count as white space fails, since it closes the head before the policy', async () => {
  expect(await checkOutput(OUTPUT, SPACE_HTML_DOES_NOT_COUNT, await hashLineOf(SPACE_HTML_DOES_NOT_COUNT))).toEqual([NOT_THE_START]);
});
test('an element named like html fails', async () => {
  expect(await checkOutput(OUTPUT, OTHER_ELEMENT, await hashLineOf(OTHER_ELEMENT))).toEqual([NOT_THE_START]);
});
test('anything before the doctype fails, since the page must start exactly as index.html does', async () => {
  expect(await checkOutput(OUTPUT, COMMENT_BEFORE_DOCTYPE, await hashLineOf(COMMENT_BEFORE_DOCTYPE))).toEqual([NOT_THE_START]);
});
test('an outside address in the page fails, naming it', async () => {
  expect(await checkOutput(OUTPUT, OUTSIDE_ADDRESS, await hashLineOf(OUTSIDE_ADDRESS))).toEqual(['cipher-envelope.html: names an outside address, https://example.org/x']);
});
test('an outside address in upper case fails, naming it', async () => {
  expect(await checkOutput(OUTPUT, UPPER_CASE_ADDRESS, await hashLineOf(UPPER_CASE_ADDRESS))).toEqual(['cipher-envelope.html: names an outside address, HTTPS://EXAMPLE.ORG/X']);
});
test('an outside address without a scheme fails, naming it', async () => {
  expect(await checkOutput(OUTPUT, SCHEMELESS_ADDRESS, await hashLineOf(SCHEMELESS_ADDRESS))).toEqual(['cipher-envelope.html: names an outside address, //example.org']);
});
test('a socket address fails, naming it', async () => {
  expect(await checkOutput(OUTPUT, SOCKET_ADDRESS, await hashLineOf(SOCKET_ADDRESS))).toEqual(['cipher-envelope.html: names an outside address, wss://example.org/x']);
});
test('a source map reference fails', async () => {
  expect(await checkOutput(OUTPUT, SOURCE_MAP, await hashLineOf(SOURCE_MAP))).toEqual(['cipher-envelope.html: refers to a source map']);
});
test('a source map reference in upper case fails', async () => {
  expect(await checkOutput(OUTPUT, UPPER_CASE_SOURCE_MAP, await hashLineOf(UPPER_CASE_SOURCE_MAP))).toEqual(['cipher-envelope.html: refers to a source map']);
});
test('a machine path fails, naming it', async () => {
  expect(await checkOutput(OUTPUT, MACHINE_PATH, await hashLineOf(MACHINE_PATH))).toEqual(['cipher-envelope.html: names a machine path, /home/someone']);
});
test('a macOS machine path fails, naming it', async () => {
  expect(await checkOutput(OUTPUT, MAC_MACHINE_PATH, await hashLineOf(MAC_MACHINE_PATH))).toEqual([`cipher-envelope.html: names a machine path, ${MAC_HOME}`]);
});
test('a policy that allows network connections fails', async () => {
  expect(await checkOutput(OUTPUT, CONNECTIONS_ALLOWED, await hashLineOf(CONNECTIONS_ALLOWED))).toEqual([WRONG_POLICY]);
});
test('a policy that allows other sources by default fails', async () => {
  expect(await checkOutput(OUTPUT, DEFAULT_ALLOWED, await hashLineOf(DEFAULT_ALLOWED))).toEqual([WRONG_POLICY]);
});
test('a policy with a directive the build does not write fails', async () => {
  expect(await checkOutput(OUTPUT, EXTRA_DIRECTIVE, await hashLineOf(EXTRA_DIRECTIVE))).toEqual([WRONG_POLICY]);
});
test('a policy with a script source the build does not write fails', async () => {
  expect(await checkOutput(OUTPUT, EXTRA_SCRIPT_SOURCE, await hashLineOf(EXTRA_SCRIPT_SOURCE))).toEqual([WRONG_POLICY]);
});
test('an empty policy at the start fails, even with the right policy copied further on', async () => {
  expect(await checkOutput(OUTPUT, EMPTY_POLICY_WITH_COPY, await hashLineOf(EMPTY_POLICY_WITH_COPY))).toEqual([WRONG_POLICY]);
});
test('a loose policy at the start fails, even with the right policy hidden in its attributes', async () => {
  expect(await checkOutput(OUTPUT, LOOSE_POLICY_HIDING_COPY, await hashLineOf(LOOSE_POLICY_HIDING_COPY))).toEqual([WRONG_POLICY]);
});
test('a script holding a carriage return fails, since the browser hashes it differently', async () => {
  expect(await checkOutput(OUTPUT, CARRIAGE_RETURN, await hashLineOf(CARRIAGE_RETURN))).toEqual(['cipher-envelope.html: a script holds a carriage return or NUL, which the browser hashes differently']);
});
test('a script holding a NUL fails, since the browser hashes it differently', async () => {
  expect(await checkOutput(OUTPUT, NUL, await hashLineOf(NUL))).toEqual(['cipher-envelope.html: a script holds a carriage return or NUL, which the browser hashes differently']);
});
test("a hash that is not the page's fails", async () => {
  expect(await checkOutput(OUTPUT, PAGE, await hashLineOf(UNHASHED_SCRIPT))).toEqual(['cipher-envelope.html.sha256: does not match the page']);
});
test('a hash file that names another file fails', async () => {
  expect(await checkOutput(OUTPUT, PAGE, `${'0'.repeat(64)}  other.html\n`)).toEqual(['cipher-envelope.html.sha256: is not "<SHA-256>  cipher-envelope.html"']);
});
test('a hash line with one space before the name fails', async () => {
  expect(await checkOutput(OUTPUT, PAGE, `${PAGE_HEX} ${OUTPUT}\n`)).toEqual(['cipher-envelope.html.sha256: is not "<SHA-256>  cipher-envelope.html"']);
});
test('a hash line without its final newline fails', async () => {
  expect(await checkOutput(OUTPUT, PAGE, `${PAGE_HEX}  ${OUTPUT}`)).toEqual(['cipher-envelope.html.sha256: is not "<SHA-256>  cipher-envelope.html"']);
});
test('a hash written in upper-case hex fails', async () => {
  expect(await checkOutput(OUTPUT, PAGE, `${PAGE_HEX.toUpperCase()}  ${OUTPUT}\n`)).toEqual(['cipher-envelope.html.sha256: is not "<SHA-256>  cipher-envelope.html"']);
});
