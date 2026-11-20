# cipher-envelope

An encryption tool that will run entirely in the browser. You will pick a method and a secret,
encrypt a text, a text file or an image, and save an envelope: a versioned file, or text you can
paste, that holds the encrypted data with the method and its parameters, and never the secret.
The same page opens the envelope with whatever opens it: the password, the generated key or the
key file. An envelope made for a recipient's public key opens only with that recipient's private
key, so not even the person who made it can open it again.

It is meant for two things:

- protecting real data, with strong modern methods;
- learning, in a separate Learn area of classical and weak ciphers. These are marked as insecure,
  in red, and must never be used to protect anything.

It will run on GitHub Pages, and as a single HTML file you can download and open offline. Its
published hash shows that a download is, byte for byte, the file attached to that release.

## Status

Early. There is no code yet, and nothing here is usable. The rules the project is built to are in
[`docs/standards.md`](docs/standards.md).

## No warranty

This software is provided as is, without warranty of any kind, and its authors accept no
responsibility for how it is used. By using it you accept that: you use it at your own risk. The
envelope never holds the secret, so if you lose the password or key, this project cannot recover
the data for you.
See [`LICENSE`](LICENSE).

## License

[MIT](LICENSE).
