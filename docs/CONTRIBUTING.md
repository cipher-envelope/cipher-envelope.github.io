# Contributing

This is the source of cipher-envelope, an encryption tool that runs entirely in the browser. It is
at an early stage: there is no code yet. Comments on the plans in these guides are welcome now;
once the app exists, so are corrections: a method that does not decrypt what it encrypted, a wrong
statement about how secure a method is, a broken layout, or an accessibility problem.

## Report a problem

[Open an issue](https://github.com/f-f-9-9-0-0/cipher-envelope/issues/new) and include:

- where you used it: the address of the hosted app, or the release of the offline file;
- the method, as the app names it, the kind of secret (password, generated key, public key or key
  file) and the kind of input (text, text file or image);
- what is wrong, and what you expected;
- the browser, and the window width or device.

**Never paste a real password, key, key file or private key, or an envelope made from data you
care about.** Reproduce the problem with a made-up input and a throwaway secret, and remove private
data from anything you paste.

## Propose a change

Small fixes can go straight to a pull request. For anything larger (a new method, a change to the
envelope, a change to the interface), describe it in an issue first.

### Set up

The app will be TypeScript built with Vite. The setup commands are added with the first code.

### Where things are

| Path | What it holds |
|---|---|
| `docs/` | These guides |
| `LICENSE` | The MIT licence |

The table grows as code lands.

### Rules for a change

The full list is in [`standards.md`](standards.md). The ones that catch most first changes:

- Do not change or reuse a published method ID. Envelopes already saved name their method by it.
- Never put a password, a key, a private key or a derived key into the envelope.
- Do not add a network request after load, or a script from another origin.
- Show an insecure method as insecure: in red, with large text saying so.
- Encrypting and then decrypting with the right secret must give back the original input.

### Check it

The check commands are added with the first code.

## Commits and pull requests

- Branch from `main` and open the pull request against `main`. Name the branch
  `<scope>/<plain-description>`, with `app`, `ci` or `docs` as the scope.
- Write commit subjects as one imperative sentence, for example
  `Fix the decryption of an empty text file`.
- Keep a pull request to one change, and finish it before opening: each further push runs the
  whole build again.
- In the description, say what changed and why, what changes for a user, and which checks you
  ran.
- Pull requests from outside the project may wait for a maintainer to approve their workflow
  run. The maintainer merges, and a merge publishes the app ([`releases.md`](releases.md)).

## What not to commit

Credentials or tokens, `.env` files, real passwords, keys, key files or private keys, envelopes
made from real data, machine-specific paths, personal data, the build output, and private working
notes.

## Licence

The code is published under the MIT licence ([`../LICENSE`](../LICENSE)), provided as is, without
warranty. Code you contribute is published under the same licence. Material you add from elsewhere
needs a licence that allows publishing it here, and its source named.
