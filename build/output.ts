// The check of the published page (docs/patterns.md, "Check the published output, not the
// source"). It reads the file the build wrote, so a dependency or a build step that breaks a rule
// is caught as well as the code here. Each problem names its file: `<file>: <what is wrong>`.

import { loadsFromFile, type Script, scriptTags, sha256Hex } from './csp.ts';

/** The page the build publishes, both as the hosted app and as the offline file. */
export const OUTPUT = 'cipher-envelope.html';

/**
 * How the page must start: as `index.html` does, then the policy. Nothing comes before the policy,
 * so the browser applies it, and the charset ends well within the first 1,024 bytes, where the
 * browser looks for it. Written out here as well as in `build/csp.ts`, rather than matched loosely:
 * a change to the start of `index.html` is made in both.
 */
const PAGE_START = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="';
const POLICY = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)">/gi;
/** Addresses with a scheme, and scheme-less ones (`//host`) that a link or a refresh would follow. */
const ADDRESS = /\b(?:https?|wss?):\/\/[^\s"'<>)]+|(?<![\w:/])\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
/**
 * Outside addresses the page may name: those the third-party notices name. Each is matched exactly,
 * wherever it appears in the page. Adding one is a deliberate edit here.
 */
const ALLOWED_ADDRESSES: readonly string[] = [
  'http://scripts.sil.org/OFL',
  'https://github.com/clauseggers/Playfair-Display',
  'https://github.com/rough-stuff/rough',
  'https://github.com/pshihn/hachure-fill',
  'https://github.com/pshihn/bezier-points',
  'https://github.com/pshihn/points-on-path',
  'https://github.com/pshihn/path-data-parser',
  'https://www.netlib.org/fdlibm/',
];
/**
 * A passage of each notice the page must carry (docs/third-party-notices.md). Written out here rather
 * than taken from the build, so a notice the build stops carrying fails this check. An MIT notice is
 * its copyright together with the start of its permission, as the licence lays them out: the
 * permission's first words alone are in every font's licence too.
 */
const NOTICES: readonly string[] = [
  'Copyright (c) 2026 borrowdale\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software',
  'Copyright (c) 2019 Preet Shihn\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software',
  'Copyright (C) 1993 by Sun Microsystems, Inc.',
  'Copyright 2017 The Playfair Display Project Authors',
  'Copyright 2019 IBM Corp.',
  'Copyright 2017 IBM Corp.',
  'Copyright (c) 2024 by Excalidraw.',
  'SIL OPEN FONT LICENSE Version 1.1',
];
const MACHINE_PATH = /\/(?:Users|home)\/[\w.-]+/;
const HASH_LINE = /^([0-9a-f]{64}) {2}(\S+)\n$/;

/**
 * The policy the page must carry. It is written out here, and the scripts' hashes are computed
 * here, rather than taken from the build, so a change to the build's policy or to how it hashes
 * fails this check until it is made here too.
 */
async function expectedPolicy(scripts: readonly Script[]): Promise<string> {
  const hashes = await Promise.all(
    scripts.map(async (s) => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s.body));
      return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
    }),
  );
  return [
    "default-src 'none'",
    `script-src ${hashes.join(' ')}`,
    "style-src 'unsafe-inline'",
    'font-src data:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * Every rule the published page breaks, each as `<file>: <what is wrong>`; empty when it breaks
 * none.
 */
export async function checkOutput(file: string, page: string, hashLine: string): Promise<string[]> {
  const problems: string[] = [];
  const startsRight = page.startsWith(PAGE_START);
  if (!startsRight) {
    problems.push(
      `${file}: does not start as PAGE_START in build/output.ts says: <!doctype html>, <html lang="en">, <head>, <meta charset="utf-8"> and the content policy, one per line with LF endings`,
    );
  }

  const policies = Array.from(page.matchAll(POLICY));
  const scripts = scriptTags(page);
  if (policies.length !== 1) problems.push(`${file}: ${policies.length} content policies, not one`);
  if (scripts.some(loadsFromFile)) problems.push(`${file}: a script is loaded from a file`);
  // The browser hashes a script after turning each carriage return into a line feed and each NUL
  // into U+FFFD, so the hash the build wrote for such a script never matches and the app is blocked.
  if (scripts.some((s) => /[\r\0]/.test(s.body))) problems.push(`${file}: a script holds a carriage return or NUL, which the browser hashes differently`);
  // The browser applies the policy tag at the start, so that tag, closed straight after its content,
  // is the one compared: a different copy elsewhere in the page says nothing about it.
  if (startsRight && !page.startsWith(`${PAGE_START}${await expectedPolicy(scripts)}">`)) {
    problems.push(`${file}: the content policy at the start is not the one written out in build/output.ts`);
  }

  for (const address of new Set(page.match(ADDRESS))) {
    if (!ALLOWED_ADDRESSES.includes(address)) problems.push(`${file}: names an outside address, ${address}`);
  }
  for (const notice of NOTICES) {
    if (!page.includes(notice)) problems.push(`${file}: carries no notice "${notice}"`);
  }
  if (/sourceMappingURL/i.test(page)) problems.push(`${file}: refers to a source map`);
  const path = MACHINE_PATH.exec(page);
  if (path) problems.push(`${file}: names a machine path, ${path[0]}`);

  const hash = HASH_LINE.exec(hashLine);
  if (!hash || hash[2] !== file) problems.push(`${file}.sha256: is not "<SHA-256>  ${file}"`);
  else if (hash[1] !== (await sha256Hex(new TextEncoder().encode(page)))) problems.push(`${file}.sha256: does not match the page`);
  return problems;
}
