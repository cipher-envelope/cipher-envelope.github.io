# Third-party notices

The page carries code and fonts from other projects. Their notices and licences travel inside the
page: a comment at its start, straight after its content policy. View the hosted app's source, or
open the offline file in a text editor, to read them.

The build writes that comment ([`build/notices.ts`](../build/notices.ts)). From each npm package the
page's code imports, every copy of it at every version, it reads the files named `LICENSE` or
`LICENCE`, `COPYING`, `NOTICE`, `THIRD_PARTY_NOTICES` or `third-party-notices`, and `OFL`, in any
letter case, alone or followed by an extension or a suffix such as `-MIT`. It also reads every
`src/fonts/LICENSE-*.txt`, and writes each text once, under every source that ships it. A bundled
package that ships none of these files fails the build. So does a notice, or a package's name or
version, holding text that would end the comment early or that the build and the check would read as
a script or a content policy: `-->`, `--!>`, `<!--`, `<script`, `</script` or `<meta`. The check of
the published page ([`build/output.ts`](../build/output.ts)) looks for a passage of each notice
below (for an MIT notice, its copyright together with the start of its permission), and allows the
outside addresses the notices name, each matched exactly, wherever it appears in the page.

Not read yet: other file names, such as `NOTICES` or `THIRD-PARTY-LICENSES`, and a package that only
the styles reach, through `@import` or `url()` into `node_modules`: the build's list of modules does
not hold it, so its notices would not reach the page. Keep such files under `src/` with their
licence beside them, as `src/fonts/` does. Code a build plugin adds as a virtual module is not read
either: Vite's module preload polyfill is one, and this build leaves it out.

Checked on 2026-11-24: the comment holds 6 texts from 9 sources and adds 26,952 bytes to the page.

## Fonts

Each font is licensed under the SIL Open Font License, Version 1.1. The font files are in
`src/fonts/`, except Excalifont, which comes from `@borrowdale/text`.

| Font | Copyright | Licence |
|---|---|---|
| Playfair Display | Copyright 2017 The Playfair Display Project Authors, with Reserved Font Name "Playfair Display" | [`src/fonts/LICENSE-playfair-display.txt`](../src/fonts/LICENSE-playfair-display.txt) |
| IBM Plex Sans | Copyright 2019 IBM Corp. | [`src/fonts/LICENSE-ibm-plex-sans.txt`](../src/fonts/LICENSE-ibm-plex-sans.txt) |
| IBM Plex Mono | Copyright 2017 IBM Corp. | [`src/fonts/LICENSE-ibm-plex-mono.txt`](../src/fonts/LICENSE-ibm-plex-mono.txt) |
| Excalifont, through `@borrowdale/text` | Copyright (c) 2024 by Excalidraw. Excalifont is a trademark of Excalidraw. | [`src/fonts/LICENSE-excalifont.txt`](../src/fonts/LICENSE-excalifont.txt), the same text as the package's `OFL.txt` |

## Code

The page bundles `@borrowdale/core`, `@borrowdale/fills` and `@borrowdale/text` from npm, each
under the MIT licence (Copyright (c) 2026 borrowdale); `@borrowdale/text` also carries Excalifont,
above.

`@borrowdale/core` includes code ported from rough.js, hachure-fill, points-on-curve, points-on-path
and path-data-parser (MIT, Copyright Preet Shihn), and from fdlibm 5.3 (Copyright (C) 1993 Sun
Microsystems, Inc., used under its notice). Their notices are in that package's
`THIRD_PARTY_NOTICES.md`, which the page carries whole.

## Adding a dependency or a font

- **An npm package the page's code imports:** its licence and notice files reach the page without a
  change here, when they carry one of the names above. If they name an outside address, the check
  of the published page fails until the address is added to `ALLOWED_ADDRESSES` in
  `build/output.ts`. Add a passage of its notice to `NOTICES` there, and a paragraph above. For an
  MIT notice, the passage is its copyright with the start of its permission, as the licence lays
  them out: the permission's first words alone are in every font's licence too.
- **A font in `src/fonts/`:** add its licence as `src/fonts/LICENSE-<font>.txt`, a row above, and
  its copyright line to `NOTICES` in `build/output.ts`.
