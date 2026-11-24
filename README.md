# cipher-envelope

An encryption tool that runs entirely in the browser. You pick a method and a secret, encrypt a text
or any file, such as a photo, and save an envelope: a versioned file, or text you can paste, that
holds the encrypted data with the method and its parameters, and never the secret.
The same page opens the envelope with whatever opens it: the password, the generated key or the
key file. An envelope made for a recipient's public key opens only with that recipient's private
key, so not even the person who made it can open it again.
To receive such envelopes, make a key pair on the page: it saves your private key as a file, to keep
like a password, and shows the public key to share. Opening one does not show who sealed it: anyone
who has your public key could have.

It is meant for two things:

- protecting real data: AES-256-GCM, which is recommended, and AES-256-CBC, marked Legacy because it
  cannot tell whether an envelope was changed;
- learning, in a separate Learn area of classical and weak ciphers. These are marked as insecure,
  in red, and must never be used to protect anything.

It seals up to 64 MiB at a time. The learning ciphers take typed text only, up to 1 MiB.

It builds into a single HTML file that loads nothing from the network, with its SHA-256 hash
written beside it. Each merge to `main` that changes the app deploys it to
<https://cipher-envelope.github.io/>, and each release carries the file with its hash
([`docs/releases.md`](docs/releases.md)).

## Status

First version. Checked on 2026-11-24: built with `npm run build`, `dist/cipher-envelope.html`
seals and opens in Chromium, served from a local server. Opening the file straight from disk, and
Safari and Firefox, are not checked yet. As of 2026-11-24 GitHub Pages is not enabled and the
workflow has not run, so nothing is hosted yet and there are no releases. The rules the project is
built to are in [`docs/standards.md`](docs/standards.md).

## No warranty

This software is provided as is, without warranty of any kind, and its authors accept no
responsibility for how it is used. By using it you accept that: you use it at your own risk. The
envelope never holds the secret, so if you lose the password or key, this project cannot recover
the data for you.
See [`LICENSE`](LICENSE).

## License

[MIT](LICENSE). The page also carries fonts under the SIL Open Font License 1.1, and code from other
projects under their own licences: see [`docs/third-party-notices.md`](docs/third-party-notices.md).
