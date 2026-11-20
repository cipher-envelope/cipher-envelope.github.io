# Standards

The rules every change to this repository follows. How recurring problems are solved is in
[`patterns.md`](patterns.md); how a merged change reaches the hosted app and the offline file is in
[`releases.md`](releases.md).

There is no code yet. This guide records what is decided; the rules for each part of the app are
added as that part lands.

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

- A method is either for protecting real data, with a strong modern construction, or part of the
  Learn area, with a classical or weak cipher.
- An insecure method is never presented as anything else. It is shown in red, with large text
  saying that it is insecure.
- Encrypting and then decrypting with the right secret gives back the original input exactly. A
  method that cannot do that is not added.

## The envelope

- The export is this project's own envelope format: versioned and self-describing. It carries the
  format version, the method ID and the method's parameters: the KDF settings, salt, nonce and the
  ciphertext.
- It never carries the password, the key, a private key or a derived key
  ([`patterns.md`](patterns.md), "The envelope never holds a secret").

## Inputs and secrets

- The inputs are a text, a text file or an image. A file or an image is encrypted as its bytes, so
  it decrypts to the identical file.
- The secret is one of a password (turned into a key by a KDF), a generated random key, a
  recipient's public key, or a key file.

## Interface

- The app is TypeScript built with Vite, with no UI framework. Drawing may use the `@borrowdale/*`
  packages.
- Once loaded, the app makes no network request, and it runs no third-party script
  ([`patterns.md`](patterns.md), "No network calls after load" and "No third-party scripts").

## Code and tests

- Dependencies are pinned to exact versions, and the lockfile is committed.
- A test arranges its input, acts once and asserts literal values.
- A new rule gets its check in the same pull request, so the next change cannot break it
  unnoticed.

## Workflow

There is no workflow yet. The one that builds and deploys the app follows these rules:

- Only the job that deploys has `pages: write` and `id-token: write`. The workflow default is
  `contents: read`.
- Actions are pinned to a full commit SHA, with the version in a trailing comment.
- The checkout sets `persist-credentials: false`. Jobs set `timeout-minutes`.
- Steps print no secret and no environment dump.

## Documentation

- `README.md` introduces the app, and `LICENSE` holds the licence. `docs/` holds this guide,
  [`patterns.md`](patterns.md), [`releases.md`](releases.md) and
  [`CONTRIBUTING.md`](CONTRIBUTING.md). A new documentation file goes under `docs/`.
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
- No private working notes, review records or planning documents. A pull request carries the
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
  whole workflow again.
- Pull requests are squash-merged, so the title becomes the commit subject on `main`.
- A pull request description states:
  - what changed and why, with `Fixes #N` where it resolves an issue;
  - what changes for a user: which methods, inputs or secrets, and whether the envelope changes;
  - which checks ran, locally or in CI, and which did not.
- Merging a change to the app deploys it. Review the pull request as the publication it is.
