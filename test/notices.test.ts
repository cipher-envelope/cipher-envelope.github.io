import { expect, test } from 'vitest';
import { withPolicy } from '../build/csp';
import { bundledPackages, fontNotices, type NoticeFiles, noticesComment, packageNotices, withNotices } from '../build/notices';
import { OUTPUT } from '../build/output';
import { thrown } from './thrown';

// Packages and fonts as they lie on disk, each folder listed out of order: a scoped package with
// every kind of notice file and files named like one but not one; a package whose notice files carry
// other spellings and extensions; one package at two versions, top-level and nested; one that ships
// no licence at all; and the fonts' folder.
const SCOPED = '/repo/node_modules/@scope/lib/';
const PLAIN = '/repo/node_modules/plain/';
const DUP = '/repo/node_modules/dup/';
const NESTED_DUP = '/repo/node_modules/plain/node_modules/dup/';
const BARE = '/repo/node_modules/bare/';
// Three packages whose names sort a, a-b, m, while their folders sort a-b, m, z/…/a.
const M = '/repo/node_modules/m/';
const A_B = '/repo/node_modules/a-b/';
const NESTED_A = '/repo/node_modules/z/node_modules/a/';
const FONTS = '/repo/src/fonts/';
const FOLDERS: Record<string, string[]> = {
  [SCOPED]: ['package.json', 'NOTICE.md', 'index.js', 'THIRD_PARTY_NOTICES.md', 'sublicense.js', 'LICENSE', 'README.md', 'noticeboard.js'],
  [PLAIN]: ['package.json', 'third-party-notices.txt', 'licence.md', 'OFL.txt', 'COPYING', 'LICENSE.txt', 'LICENSE-MIT'],
  [DUP]: ['package.json', 'LICENSE'],
  [NESTED_DUP]: ['package.json', 'LICENSE'],
  [BARE]: ['package.json', 'index.js'],
  [M]: ['package.json', 'LICENSE'],
  [A_B]: ['package.json', 'LICENSE'],
  [NESTED_A]: ['package.json', 'LICENSE'],
  [FONTS]: ['LICENSE-b.txt', 'a.woff2', 'LICENSE-c.md', 'LICENSE-a.txt', 'fonts.css'],
};
const TEXTS: Record<string, string> = {
  [`${SCOPED}package.json`]: '{"name":"@scope/lib","version":"1.2.0"}',
  [`${SCOPED}LICENSE`]: 'MIT\n',
  [`${SCOPED}NOTICE.md`]: 'Ported from elsewhere\n',
  [`${SCOPED}THIRD_PARTY_NOTICES.md`]: 'Bundled from elsewhere\n',
  [`${PLAIN}package.json`]: '{"name":"plain","version":"0.1.0"}',
  [`${PLAIN}COPYING`]: 'GPL text\n',
  [`${PLAIN}LICENSE.txt`]: 'MIT\n',
  [`${PLAIN}LICENSE-MIT`]: 'MIT, named with a suffix\n',
  [`${PLAIN}OFL.txt`]: 'Font licence\n',
  [`${PLAIN}licence.md`]: 'Licence in British spelling\n',
  [`${PLAIN}third-party-notices.txt`]: 'Third-party notices with hyphens\n',
  [`${DUP}package.json`]: '{"name":"dup","version":"1.0.0"}',
  [`${DUP}LICENSE`]: 'Dup one licence\n',
  [`${NESTED_DUP}package.json`]: '{"name":"dup","version":"2.0.0"}',
  [`${NESTED_DUP}LICENSE`]: 'Dup two licence\n',
  [`${BARE}package.json`]: '{"name":"bare","version":"3.0.0"}',
  [`${M}package.json`]: '{"name":"m","version":"1.0.0"}',
  [`${M}LICENSE`]: 'M licence\n',
  [`${A_B}package.json`]: '{"name":"a-b","version":"1.0.0"}',
  [`${A_B}LICENSE`]: 'A-B licence\n',
  [`${NESTED_A}package.json`]: '{"name":"a","version":"1.0.0"}',
  [`${NESTED_A}LICENSE`]: 'A licence\n',
  [`${FONTS}LICENSE-a.txt`]: 'Font A licence\n',
  [`${FONTS}LICENSE-b.txt`]: 'Font B licence\n',
};
// Those files as the build's file access answers for them; any other path is not there.
const FILES: NoticeFiles = {
  readdir: async (path) => FOLDERS[path] ?? Promise.reject(new Error(`${path}: no such folder`)),
  readFile: async (path) => TEXTS[path] ?? Promise.reject(new Error(`${path}: no such file`)),
};

// Module ids as the bundler reports them: the app's own, a virtual one, and packages reached
// directly, behind a query that names another package's file, inside another package's
// node_modules, and one package at two versions.
const MODULE_IDS = [
  '/repo/src/main.ts',
  '\0vite/modulepreload-polyfill.js',
  '/repo/node_modules/@scope/lib/dist/index.js',
  '/repo/node_modules/@scope/lib/dist/other.js',
  '\0/repo/node_modules/plain/index.js?from=/repo/node_modules/elsewhere/x.js',
  '/repo/node_modules/plain/node_modules/inner/index.js',
  '/repo/node_modules/dup/index.js',
  '/repo/node_modules/plain/node_modules/dup/index.js',
];
const PAGE = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>t</title>\n</head>\n<body><script type="module">console.log(1)</script></body>\n</html>\n';
const BREAKS = 'cipher-envelope.html: a notice holds';

test('the bundled packages are found by their node_modules folder: scoped, nested, at two versions, or behind a query', () => {
  expect(bundledPackages(MODULE_IDS)).toEqual(
    new Map([
      ['/repo/node_modules/@scope/lib/', '@scope/lib'],
      ['/repo/node_modules/plain/', 'plain'],
      ['/repo/node_modules/plain/node_modules/inner/', 'inner'],
      ['/repo/node_modules/dup/', 'dup'],
      ['/repo/node_modules/plain/node_modules/dup/', 'dup'],
    ]),
  );
});
test("each package's licence and notice files are read, packages and files in order, other files left out", async () => {
  expect(await packageNotices(FILES, new Map([[PLAIN, 'plain'], [SCOPED, '@scope/lib']]))).toEqual([
    { source: '@scope/lib 1.2.0: LICENSE', text: 'MIT\n' },
    { source: '@scope/lib 1.2.0: NOTICE.md', text: 'Ported from elsewhere\n' },
    { source: '@scope/lib 1.2.0: THIRD_PARTY_NOTICES.md', text: 'Bundled from elsewhere\n' },
    { source: 'plain 0.1.0: COPYING', text: 'GPL text\n' },
    { source: 'plain 0.1.0: LICENSE-MIT', text: 'MIT, named with a suffix\n' },
    { source: 'plain 0.1.0: LICENSE.txt', text: 'MIT\n' },
    { source: 'plain 0.1.0: OFL.txt', text: 'Font licence\n' },
    { source: 'plain 0.1.0: licence.md', text: 'Licence in British spelling\n' },
    { source: 'plain 0.1.0: third-party-notices.txt', text: 'Third-party notices with hyphens\n' },
  ]);
});
test('one package at two versions gives the notices of both, in order of folder', async () => {
  expect(await packageNotices(FILES, new Map([[NESTED_DUP, 'dup'], [DUP, 'dup']]))).toEqual([
    { source: 'dup 1.0.0: LICENSE', text: 'Dup one licence\n' },
    { source: 'dup 2.0.0: LICENSE', text: 'Dup two licence\n' },
  ]);
});
test('packages go in order of name, not of folder', async () => {
  expect(await packageNotices(FILES, new Map([[M, 'm'], [A_B, 'a-b'], [NESTED_A, 'a']]))).toEqual([
    { source: 'a 1.0.0: LICENSE', text: 'A licence\n' },
    { source: 'a-b 1.0.0: LICENSE', text: 'A-B licence\n' },
    { source: 'm 1.0.0: LICENSE', text: 'M licence\n' },
  ]);
});
test('a bundled package that ships no licence or notice fails the build, naming it', async () => {
  await expect(packageNotices(FILES, new Map([[BARE, 'bare']]))).rejects.toThrow('cipher-envelope.html: bundles bare, which ships no licence or notice file');
});
test("the fonts' licences are every LICENSE-*.txt in their folder, in order", async () => {
  expect(await fontNotices(FILES, FONTS, 'src/fonts')).toEqual([
    { source: 'src/fonts/LICENSE-a.txt', text: 'Font A licence\n' },
    { source: 'src/fonts/LICENSE-b.txt', text: 'Font B licence\n' },
  ]);
});
test('the comment holds each text once, under every source that ships it, in order', () => {
  expect(
    noticesComment([
      { source: 'a 1.0.0: LICENSE', text: 'MIT\n' },
      { source: 'src/fonts/LICENSE-x.txt', text: 'OFL\n\n' },
      { source: 'b 1.0.0: LICENSE', text: 'MIT\n' },
    ]),
  ).toBe(
    '<!--\nThird-party notices\n\nThis page carries code and fonts from other projects. Their notices and licences follow, each\nas its source ships it.\n\n== a 1.0.0: LICENSE; b 1.0.0: LICENSE ==\n\nMIT\n\n== src/fonts/LICENSE-x.txt ==\n\nOFL\n-->',
  );
});
test('a notice that would end the comment fails the build', () => {
  expect(thrown(noticesComment, [{ source: 'a', text: 'x --> y' }])).toHaveProperty('message', `${BREAKS} "-->", which would break the notices comment`);
});
test('a notice that would end the comment the other way the browser accepts fails the build', () => {
  expect(thrown(noticesComment, [{ source: 'a', text: 'x --!> y' }])).toHaveProperty('message', `${BREAKS} "--!>", which would break the notices comment`);
});
test('a source that would end the comment fails the build too, since a package names its own version', () => {
  expect(thrown(noticesComment, [{ source: 'x 1.0.0 --> <img src=x>: LICENSE', text: 'MIT\n' }])).toHaveProperty('message', `${BREAKS} "-->", which would break the notices comment`);
});
test('a notice that opens another comment fails the build', () => {
  expect(thrown(noticesComment, [{ source: 'a', text: 'x <!-- y' }])).toHaveProperty('message', `${BREAKS} "<!--", which would break the notices comment`);
});
test('a notice holding a script tag, in any case, fails the build, since the build and the check would hash it', () => {
  expect(thrown(noticesComment, [{ source: 'a', text: 'x <SCRIPT> y' }])).toHaveProperty('message', `${BREAKS} "<SCRIPT", which would break the notices comment`);
});
test('a notice holding a closing script tag fails the build', () => {
  expect(thrown(noticesComment, [{ source: 'a', text: 'x </script> y' }])).toHaveProperty('message', `${BREAKS} "</script", which would break the notices comment`);
});
test('a notice holding a meta tag fails the build, since the check counts content policies in the text', () => {
  expect(thrown(noticesComment, [{ source: 'a', text: 'x <meta http-equiv> y' }])).toHaveProperty('message', `${BREAKS} "<meta", which would break the notices comment`);
});
test('the notices go straight after the start of the page', () => {
  expect(withNotices(PAGE, '<!--\nN\n-->')).toBe(
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<!--\nN\n-->\n<title>t</title>\n</head>\n<body><script type="module">console.log(1)</script></body>\n</html>\n',
  );
});
// The script's hash from openssl: printf 'console.log(1)' | openssl dgst -sha256 -binary | openssl base64
test('the content policy then goes in before the notices, so nothing comes before it', async () => {
  expect((await withPolicy(withNotices(PAGE, '<!--\nN\n-->'), OUTPUT)).html).toBe(
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">\n<!--\nN\n-->\n<title>t</title>\n</head>\n<body><script type="module">console.log(1)</script></body>\n</html>\n`,
  );
});
test('a page that starts any other way gets no notices', () => {
  expect(thrown(withNotices, `<!-- first -->${PAGE}`, '<!--\nN\n-->')).toHaveProperty('message', 'cipher-envelope.html: does not start as PAGE_START in build/csp.ts says, so the notices have no place');
});
