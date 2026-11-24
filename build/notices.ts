// The third-party notices the built page carries (docs/third-party-notices.md). The build reads them
// where they ship, from the packages it bundles and from src/fonts/, and writes them into a comment
// near the start of the page, so the hosted app and the offline file carry them as one file.

import { PAGE_START } from './csp.ts';
import { OUTPUT } from './output.ts';

/** A notice or a licence, as its source ships it. */
export interface Notice {
  /** Where it comes from, as the page names it: `@borrowdale/core 0.8.0: LICENSE`. */
  readonly source: string;
  readonly text: string;
}

/** The file access the notices need. The build passes the bundler's own (`this.fs`). */
export interface NoticeFiles {
  readdir(path: string): Promise<string[]>;
  readFile(path: string, options: { encoding: 'utf8' }): Promise<string>;
}

/** The files a package ships its licence or its notices in: `LICENSE`, `NOTICE.md`, `OFL.txt`, … */
const NOTICE_FILE = /^(?:licen[cs]e|copying|notice|third[-_]party[-_]notices|ofl)(?:[-.][\w.-]*)?$/i;
/**
 * Text that would end the comment early (`-->`, `--!>`), open another (`<!--`), or look like a
 * script or a content policy to the build and to the check of the published page, which read the
 * page as text.
 */
const BREAKS_THE_COMMENT = /-->|--!>|<!--|<\/?script\b|<meta\b/i;
const IN_NODE_MODULES = '/node_modules/';
const UTF8 = { encoding: 'utf8' } as const;

/**
 * The packages among the build's module ids: each folder their files were read from, with the name
 * of the package in it. A package inside another's `node_modules` is named by its own folder, and
 * two copies of one package, at two versions, are two folders.
 */
export function bundledPackages(moduleIds: Iterable<string>): Map<string, string> {
  const packages = new Map<string, string>();
  for (const id of moduleIds) {
    const path = id.replace(/^\0/, '').replace(/\?.*$/, '');
    const at = path.lastIndexOf(IN_NODE_MODULES);
    if (at === -1) continue;
    const [scope = '', name = ''] = path.slice(at + IN_NODE_MODULES.length).split('/');
    const packageName = scope.startsWith('@') ? `${scope}/${name}` : scope;
    packages.set(`${path.slice(0, at + IN_NODE_MODULES.length)}${packageName}/`, packageName);
  }
  return packages;
}

/**
 * Each bundled package's notices, read from its folder, in order of name, then of folder. A package
 * that ships none fails the build.
 */
export async function packageNotices(files: NoticeFiles, packages: ReadonlyMap<string, string>): Promise<Notice[]> {
  // A name holds no line feed, which sorts before every character a name or a path can hold.
  const order = ([folder, name]: [string, string]) => `${name}\n${folder}`;
  const sorted = [...packages].sort((a, b) => (order(a) < order(b) ? -1 : 1));
  const each = await Promise.all(
    sorted.map(async ([folder, name]) => {
      const { version } = JSON.parse(await files.readFile(`${folder}package.json`, UTF8)) as { version: string };
      const names = (await files.readdir(folder)).filter((file) => NOTICE_FILE.test(file)).sort();
      if (names.length === 0) throw new Error(`${OUTPUT}: bundles ${name}, which ships no licence or notice file`);
      return Promise.all(names.map(async (file) => ({ source: `${name} ${version}: ${file}`, text: await files.readFile(`${folder}${file}`, UTF8) })));
    }),
  );
  return each.flat();
}

/** The licences of the fonts the repository ships itself: every `LICENSE-*.txt` in `folder`, named under `label`. */
export async function fontNotices(files: NoticeFiles, folder: string, label: string): Promise<Notice[]> {
  const names = (await files.readdir(folder)).filter((file) => /^LICENSE-.+\.txt$/.test(file)).sort();
  return Promise.all(names.map(async (file) => ({ source: `${label}/${file}`, text: await files.readFile(`${folder}${file}`, UTF8) })));
}

/**
 * The comment that carries the notices, in order: each text once, under every source that ships it,
 * since the three borrowdale packages ship the same licence and Excalifont's is also in src/fonts/.
 * A notice holding text that would break the comment fails the build.
 */
export function noticesComment(notices: readonly Notice[]): string {
  const sources = new Map<string, string[]>();
  for (const { source, text } of notices) sources.set(text, [...(sources.get(text) ?? []), source]);
  const parts = Array.from(sources, ([text, from]) => `== ${from.join('; ')} ==\n\n${text.trimEnd()}\n`);
  const body = `Third-party notices\n\nThis page carries code and fonts from other projects. Their notices and licences follow, each\nas its source ships it.\n\n${parts.join('\n')}`;
  const breaker = BREAKS_THE_COMMENT.exec(body);
  if (breaker) throw new Error(`${OUTPUT}: a notice holds "${breaker[0]}", which would break the notices comment`);
  return `<!--\n${body}-->`;
}

/**
 * Returns the page with the comment straight after its start. `withPolicy` then puts the content
 * policy between the two, so nothing comes before the policy. A page that starts any other way is
 * refused, as `withPolicy` refuses it.
 */
export function withNotices(html: string, comment: string): string {
  if (!html.startsWith(PAGE_START)) throw new Error(`${OUTPUT}: does not start as PAGE_START in build/csp.ts says, so the notices have no place`);
  return `${PAGE_START}\n${comment}${html.slice(PAGE_START.length)}`;
}
