# Contributing

This is the source of cipher-envelope, an encryption tool that runs entirely in the browser. It is
at an early stage, and corrections are welcome: a method that does not decrypt what it encrypted, a
wrong statement about how secure a method is, a broken layout, or an accessibility problem.

## Report a problem

**For a security problem, do not open an issue:** report it privately, as
[`SECURITY.md`](SECURITY.md) explains.

For anything else, [open an issue][new-issue] and include:

- where you used it: the hosted app's address, the release of the offline file, or, until those
  exist, the commit you built it from;
- the method, as the app names it, the kind of secret (password, generated key, key file, public
  key, or a learning cipher's shift, keyword or rails) and the kind of input (text, or a file or
  photo);
- what is wrong, and what you expected;
- the browser, and the window width or device.

**Never paste a real password, key, key file or private key, or an envelope made from data you
care about.** Reproduce the problem with a made-up input and a throwaway secret, and remove private
data from anything you paste.

## Propose a change

Small fixes can go straight to a pull request. For anything larger (a new method, a change to the
envelope, a change to the interface), describe it in an issue first.

### Set up

Install Node 22.22.2 or later in the 22 line, 24.15.0 or later in the 24 line, or 26 or later
(`.node-version` names 24), then:

```bash
npm ci
npm run dev
```

`npm run dev` serves the app locally and reloads it as you edit. It serves the page without its
content policy, which only the build adds, so check anything that loads or connects in the built
file too (`npm run build`).

### Where things are

| Path | What it holds |
|---|---|
| `index.html`, `src/main.ts`, `src/styles.css` | The page, its entry point and its styles |
| `src/crypto/` | The methods, the envelope format, sealing and opening |
| `src/ui/` | The start, which refuses to run in a frame; the workbench, its drawings, the palette and the English text |
| `src/fonts/` | Playfair Display and IBM Plex, and the licence of every font the page carries |
| `build/` | The content policy added to the built page, and the check of the published page |
| `vite.config.ts` | The build: one HTML file, its policy and its SHA-256 hash |
| `test/` | The tests |
| `test/golden/` | Version-1 envelopes every release must still open, and the private-key file that opens the public-key one |
| `scripts/golden-envelopes.mjs` | Adds new samples to `test/golden/` with Web Crypto directly, and never rewrites one; `--check` writes nothing |
| `scripts/check-output.mjs` | Runs the check of the published page on `dist/` |
| `.github/workflows/app.yml` | The workflow: checks every pull request, deploys `main`, attaches the offline file to a release |
| `docs/` | These guides |
| `LICENSE` | The MIT licence |

### Rules for a change

The full list is in [`standards.md`](standards.md). The ones that catch most first changes:

- Do not change or reuse a published method ID. Envelopes already saved name their method by it.
- Never put a password, a key, a private key or any derived key into the envelope unencrypted.
- Do not add a network request after load, or a script from another origin.
- Show an insecure method as insecure: in red, with very large text saying so.
- For a method meant for real data, encrypting and then decrypting with the right secret must give
  back the original input exactly.

### Check it

```bash
npm run check
```

It runs the type check, the tests, the check that every sample in `test/golden/` is still there
and unchanged, the build, and the check of the built page. The workflow runs the same on every pull
request. A change to a method or to the envelope must keep every envelope in `test/golden/`
opening.

## Commits and pull requests

- Branch from `main` and open the pull request against `main`. Name the branch
  `<scope>/<plain-description>`, with `app`, `ci` or `docs` as the scope.
- Write commit subjects as one imperative sentence, for example
  `Fix the decryption of an empty text file`.
- Keep a pull request to one change, and finish it before opening it: each further push runs the
  whole check again, so answer review feedback in one push.
- In the description, say what changed and why, what changes for a user, and which test commands
  you ran.
- The maintainer merges once the check has passed. A pull request from outside the project may wait
  for a maintainer to approve its workflow run, and a merge that changes the app publishes it
  ([`releases.md`](releases.md)).

## What not to commit

Credentials or tokens, `.env` files, real passwords, keys, key files or private keys, envelopes
made from real data, machine-specific paths, personal data, the build output, and private working
notes.

## Licence

The code is published under the MIT licence ([`../LICENSE`](../LICENSE)), provided as is, without
warranty. Code you contribute is published under the same licence. Material you add from elsewhere
needs a licence that allows publishing it here, and its source named.

[new-issue]: https://github.com/cipher-envelope/cipher-envelope.github.io/issues/new
