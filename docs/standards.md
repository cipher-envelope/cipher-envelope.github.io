# Standards

The rules every change to this repository follows. How recurring problems are solved is in
[`patterns.md`](patterns.md); how a merged change reaches the hosted app and the offline file is in
[`releases.md`](releases.md).

This guide records what is decided; the rules for each part of the app are added as that part
lands.

Treat everything here as public: the history, pull requests, issues and releases, and the app that
a merge to `main` publishes. Read [Public content](#public-content) before the first commit.

## Methods

### Method IDs

- Every method has an ID: a stable slug such as `aes-256-gcm`. The envelope stores the ID, never
  the name shown on screen, which is looked up from the ID when the envelope is read
  ([`patterns.md`](patterns.md), "Method IDs, not names").
- **Never change or reuse a published method ID**, not even to fix a typo: an envelope already
  saved names its method by it.

### Secure and insecure methods

- Each method is graded recommended, legacy or insecure. A recommended or legacy method is for
  protecting real data: AES-256-GCM is recommended, and AES-256-CBC is legacy, since it cannot
  detect a changed envelope, and the page says so when it opens one. An insecure method is a
  classical or weak cipher in the Learn area.
- An insecure method is never presented as anything else. It is shown in red, with very large text
  saying that it is insecure. Sealing with one stays locked until the user ticks "I understand this
  protects nothing."
- For every method meant for real data, and for every file or image, encrypting and then
  decrypting with the right secret gives back the original input exactly. An envelope saved by an
  earlier release still opens.

## The envelope

- The export is this project's own envelope format: versioned and self-describing. It carries the
  format name and version, the method ID, which kind of secret opens it (`opensWith`), what the
  method needs besides the secret, and the ciphertext. For an AES method that is the nonce and,
  except for a generated key, a key derivation with its salt: for a password with the PBKDF2
  iteration count, for a public key with the ephemeral public key. A learning cipher's envelope
  holds neither a nonce nor a key derivation.
- Reading is strict. An unknown version, method, key derivation or field is refused and named. A
  version-1 envelope has a 16-byte salt, 600,000 to 10,000,000 PBKDF2 iterations, a 12-byte nonce
  for AES-256-GCM or a 16-byte one for AES-256-CBC, and a 32-byte ephemeral key, each in base64url
  with no padding and only one spelling. An AES-256-GCM ciphertext is at least 16 bytes, and an
  AES-256-CBC one is whole 16-byte blocks, at least one. A learning cipher's ciphertext is at most
  2,097,152 characters. A later release may widen these bounds, never narrow them, so every envelope
  already saved still opens.
- What an AES method seals is a 4-byte big-endian length, a JSON header, then the content. The
  header is `{"kind":"text"}` for a text, sealed as UTF-8, or `{"kind":"file","name":…,"type":…}`
  for a file. So a file's name and type are encrypted, and the envelope shows neither.
- It never carries the password, the key, a private key or any derived key unencrypted
  ([`patterns.md`](patterns.md), "The envelope never holds a secret").
- A field name that appears twice in one object (in the envelope, its `kdf`, a private-key file
  or the header sealed inside) makes it not a v1 envelope. This version reads the last value; a
  later version may refuse it.
- A private-key file is a separate version-1 file, not an envelope. It holds the private key
  unencrypted, so it is kept like a password. It has exactly five fields: `format`
  (`cipher-envelope-key`), `version` (1), `kind` (`x25519-private`), `publicKey` (32 bytes) and
  `privateKey`, which holds the key in one form only, whichever browser made it: RFC 8410's PKCS#8
  prefix for X25519, then the 32-byte key.

## Inputs and secrets

- The inputs are a typed text or any file, a photo included, up to 64 MiB. A file is encrypted as
  its bytes, so it decrypts to the identical file. A learning cipher takes typed text only, up to 1
  MiB.
- What opens an envelope is one of a password (normalised to Unicode NFC, then turned into a key
  by a KDF), a generated random key, a key file, or a recipient's key pair: the public key
  encrypts, and the private key, held only by the recipient, decrypts.
- A learning cipher's keyword is normalised to NFC as well, and then only its letters A to Z
  count: an accented letter is dropped, not read as its base letter.
- The key does not depend on the method: the same secret, with the same salt, gives the same key
  to AES-256-GCM and to AES-256-CBC. What is sealed always begins with 16 bytes that are the same
  for every text, and for a file depend only on how long its name and type are as the sealed
  header writes them. So anyone who holds a Strong-lock envelope sealed with a password, a
  generated key or a key file, and knows whether it holds a text (or, for a file, that length),
  can build an Old-lock envelope that its secret decrypts to 15 bytes of their choosing. The page
  reports it as garbled and shows nothing. No way to read a sealed envelope through this is known.
  A public-key envelope is not open to it: the Old lock takes no public key. Making the key depend
  on the method would change every key, and every envelope already written, so version 1 keeps
  this (decided 2026-11-24).

## Interface

- The app is TypeScript built with Vite, with no UI framework. Drawing may use `@borrowdale/core`,
  `@borrowdale/fills`, `@borrowdale/text` and `@borrowdale/charts`, which need no UI framework.
- Every asset is fetched when the page opens, or inlined. After that, the app makes no network
  request, and it runs no script loaded from another origin
  ([`patterns.md`](patterns.md), "No network calls after load" and "No third-party scripts").
- A browser may still ask the server for `/favicon.ico` after the page loads; Chromium does. The
  request carries nothing from the page. An icon of the page's own would stop it, but the policy
  would then have to allow images, so the page has none (decided 2026-11-24).
- The built page carries a Content-Security-Policy that allows only its own inline scripts, by
  hash, and no network connection (`connect-src 'none'`), so the browser blocks the page's fetches
  and other connections, its sub-resources and its form submissions. A policy cannot stop a page
  navigating away or using WebRTC; the app has no code that does either. It also allows inline
  styles and fonts from `data:` URLs, and nothing else: no images, frames or workers. A new kind of
  asset needs a change to `build/csp.ts` and to the policy written out in `build/output.ts`.
- The policy covers this page only, not other pages served from the same origin. A page there can
  script this one, in a frame or in a window it opened, and read what is typed into it. It can also
  register a service worker that answers for the app's address with a copy of its own, without the
  policy, and goes on answering after that page is gone. So the hosted app is served from an origin
  it does not share with any other page ([`releases.md`](releases.md), the hosted app).
- No other repository in the `cipher-envelope` organization publishes a GitHub Pages site. One
  that did would be served from the app's own origin, at `cipher-envelope.github.io/<repository>`.
- A policy in a `<meta>` tag cannot refuse being framed: `frame-ancestors` works only as a
  response header, and GitHub Pages sends no custom headers. So the page refuses by itself
  (`src/ui/start.ts`): when it is not the top window, it mounts nothing and shows a notice with its
  own address, to open in a tab of its own. It gives no link, since a tab opened from a sandboxed
  frame inherits the sandbox, where saving a file fails without a word. A frame that blocks scripts
  shows only the `<noscript>` line (Chromium, Firefox and WebKit, checked 2026-11-24). The check
  relies on the host never serving the page for a fenced frame, which takes a response header
  GitHub Pages cannot send. Not handled yet: a sandboxed page can open the app in a new window,
  which inherits the sandbox, so saving fails there without a word.
- Every entry point starts the app through `start`, never `mountWorkbench` directly, so the frame
  check cannot be skipped. `test/main.test.ts` loads the entry point as a framed page.

## Code and tests

- The project runs on Node 22.22.2 or later in the 22 line, 24.15.0 or later in the 24 line, or 26
  or later: the `engines` range in `package.json`, the versions its test tools accept.
  `.node-version` names 24, the long-term-support release it is built and tested with.
- Dependencies are pinned to exact versions, and the lockfile is committed.
- A test arranges its input, acts (one operation, one round trip, or one flow through the page) and
  asserts literal values. Where none can be known, because the value is random or the point is that
  two results match, it asserts how the two relate. Its body has no loop, no `if` or conditional
  expression, no function of its own (use the shared `test/thrown.ts` for an error thrown at once,
  and `await expect(…).rejects` for a rejected promise) and no `try`. It reads no file of the
  repository except a sample in `test/golden/`. Expected values never come from running the code
  under test: they come from a published test vector, a textbook example, a case worked by hand, a
  value computed with another tool that the test names, a sample in `test/golden/`, or the words and
  numbers the page is meant to show.
- A new rule gets its check in the same pull request, so the next change cannot break it
  unnoticed.

## Workflow

The workflow, [`.github/workflows/app.yml`](../.github/workflows/app.yml), follows these rules:

- Only the job that deploys has `pages: write` and `id-token: write`, and only the job that attaches
  the offline file to a release has `contents: write`. The workflow default is `contents: read`.
- Actions are pinned to a full commit SHA, with the version in a trailing comment.
- The checkout sets `persist-credentials: false`. Jobs set `timeout-minutes`.
- The check job builds the page that is deployed and released, so it restores no dependency cache
  saved by another run, and installs with `npm ci --ignore-scripts`.
- A pull request runs the check whatever files it changes: the check is required on `main`, and a
  run that a path filter skipped would never report.
- The deploy and release jobs use the page the check job built and checked; neither builds it
  again.
- Steps print no secret and no environment dump.

## Documentation

- `README.md` introduces the app, and `LICENSE` holds the licence. `docs/` holds this guide,
  [`patterns.md`](patterns.md), [`releases.md`](releases.md), [`CONTRIBUTING.md`](CONTRIBUTING.md),
  [`SECURITY.md`](SECURITY.md), which says how to report a vulnerability privately, and
  [`third-party-notices.md`](third-party-notices.md), which credits the fonts and the npm code built
  into the page. A new documentation file goes under `docs/`.
- Docs change in the pull request that changes the behaviour they describe.
- State what was measured or checked, with its date, not what is expected to hold.

## Public content

Everything here is world-readable and most of it is permanent: the history, pull requests,
issues, workflow logs, releases and the app.

- No credentials, tokens or `.env` files.
- No real password, key, key file or private key, and no envelope made from real data, in a test,
  an example, an issue or a screenshot. Use made-up inputs and throwaway secrets.
- No machine-specific paths, usernames or hostnames, including in a source map or the offline file.
- No personal data. Commit with a GitHub noreply address.
- No private working notes or planning documents. A pull request carries the
  source, the tests, the checks and the reader-facing docs the change needs, and nothing else.
- Link only to public destinations.

## Git and pull requests

- `main` is the only long-lived branch, and pull requests target it. Nobody pushes to `main`
  directly.
- Branch names are `<scope>/<plain-description>`: `app/` for the app and its tests, `ci/` for the
  workflow and checks, `docs/` for documentation. For example `docs/contributing-guide`.
- Commit subjects are one sentence in the imperative, starting with a capital letter, with no
  full stop and no prefix: `Add the contributing guide`. The body says why, when the diff does
  not.
- All commits land before the pull request opens. Every push to an open pull request runs the
  whole workflow again, so answer review feedback in one push.
- Pull requests are squash-merged, so the title becomes the commit subject on `main`.
- A pull request description states:
  - what changed and why, with `Fixes #N` where it resolves an issue;
  - what changes for a user: which methods, inputs or secrets, and whether the envelope changes;
  - which test commands ran, locally or in CI.
- Merging a change to the app deploys it. Review the pull request as the publication it is.
