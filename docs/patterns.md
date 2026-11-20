# Patterns

How this project solves the problems it meets more than once, so the next change reads like what is
already here. The rules a change must follow are in [`standards.md`](standards.md).

There is no code yet, so no pattern names a reference implementation. Each gets one when the code
that follows it lands, and new patterns are added as code lands.

## Method IDs, not names

**Problem.** An envelope saved today must still say which method made it when it is opened later,
in another version of the app. A display name can be reworded or translated; an envelope that
stored one would stop matching it.

**Pattern.** The envelope stores the method's ID, a stable slug such as `aes-256-gcm`. The name a
user sees is looked up from the ID when the envelope is read.

- The ID is a slug, never a position in a list: inserting a method must not change what an
  existing ID means.
- A published ID is never renamed or reused ([`standards.md`](standards.md), "Method IDs").
- An envelope whose ID the app does not know is refused with a message that names the ID. It is
  never decrypted by guessing the method.

## The envelope never holds a secret

**Problem.** An export that contained the key would protect nothing, and anyone given the
envelope would also have what opens it.

**Pattern.** The envelope holds what decryption needs besides the secret: the format version, the
method ID, which kind of secret opens it, the method's parameters (for a password, the KDF settings
and salt; the nonce; for a recipient's public key, the ephemeral public key or the encrypted content
key) and the ciphertext.

- The salt and the nonce are not secrets, and decryption needs them. A nonce is never reused with
  the same key.
- The password, the key, a private key and any derived key never appear unencrypted in the
  envelope, in any field or encoding.
- The secret that opens the envelope is supplied at decryption.

## No network calls after load

**Problem.** A page that can send a request after it has loaded can send what the user typed or
opened. The offline file must also work with no connection at all.

**Pattern.** Every asset is fetched when the page opens, or inlined: no lazy-loaded chunk, and no
WASM module or font fetched on demand. After that, the app makes no network request.

## No third-party scripts

**Problem.** A script loaded from another origin runs with full access to the page, and it can
change without any commit here.

**Pattern.** Every script the app runs is part of its own build. Dependencies, including any of the
`@borrowdale/core`, `fills`, `text` and `charts` packages the app uses, are bundled by Vite rather
than loaded from a CDN.

## Check the published output, not the source

**Problem.** A rule about what users receive (no third-party script, nothing fetched from
elsewhere) can be broken by a dependency or the build, not only by the code written here. Checking
each source file would miss the combination.

**Pattern.** A check reads the files that are actually published, the built app and the offline
file, and fails on the first violation, naming the file.

- The message is `<file>: <what is wrong>`.
- A new rule for the output is one more assertion in the check that already reads it, not a new
  script.

## Plainly fictional fixtures

**Problem.** Tests and examples need inputs and secrets, and this repository is public. A real one
would leak; a realistic-looking one could be taken for a leak.

**Pattern.** Test inputs and secrets are plainly made up (a sample sentence, a throwaway password,
a key generated for the test) or are published test vectors, with their source named. Nothing in a
fixture is real data.
