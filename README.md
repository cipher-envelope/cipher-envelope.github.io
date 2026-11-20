# cipher-envelope

An encryption tool that runs entirely in the browser. You pick a method and a secret, encrypt a
text, a text file or an image, and save an envelope: a small, versioned file that records the
method and its parameters, and never the secret. The same page opens the envelope again when you
give it the secret.

It is meant for two things:

- protecting real data, with strong modern methods;
- learning, in a separate Learn area of classical and weak ciphers. These are marked as insecure,
  in red, and must never be used to protect anything.

It will run on GitHub Pages, and as a single HTML file you can download, check against its
published hash, and open offline.

## Status

Early. There is no code yet, and nothing here is usable. The rules the project is built to are in
[`docs/standards.md`](docs/standards.md).

## No warranty

This software is provided as is, without warranty of any kind, and its authors accept no
responsibility for how it is used. By using it you accept that: you use it at your own risk. The
envelope never holds the secret, so if you lose the password or key, the data cannot be recovered.
See [`LICENSE`](LICENSE).

## License

[MIT](LICENSE).
