# Patterns

How this project solves the problems it meets more than once, so the next change reads like what is
already here. The rules a change must follow are in [`standards.md`](standards.md).

Each pattern names the code that follows it, where there is some. New patterns are added as code
lands.

## Method IDs, not names

**Problem.** An envelope saved today must still say which method made it when it is opened later,
in another version of the app. A display name can be reworded or translated; an envelope that
stored one would stop matching it.

**Pattern.** The envelope stores the method's ID, a stable slug such as `aes-256-gcm`. The name a
user sees is looked up from the ID when the envelope is read.

- The ID is a slug, never a position in a list: inserting a method must not change what an
  existing ID means.
- A published ID is never renamed or reused ([`standards.md`](standards.md), "Method IDs").
- Everything else about a method, its grade included, is looked up from the ID, so regrading a
  method reaches every envelope already saved. An envelope that carries a grade is refused.
- An envelope whose ID the app does not know is refused with a message that names the ID. It is
  never decrypted by guessing the method.

**Reference.** `src/crypto/methods.ts` holds the one list of methods; `src/crypto/envelope.ts`
refuses an unknown ID by name; `src/ui/catalog.ts` holds the names shown (`METHOD_TEXT`).

## The envelope never holds a secret

**Problem.** An export that contained the key would protect nothing, and anyone given the
envelope would also have what opens it.

**Pattern.** The envelope holds what decryption needs besides the secret: the format version, the
method ID, which kind of secret opens it, the method's parameters (for a password, the KDF settings
and salt; for a key file, a salt; for a recipient's public key, a salt and the ephemeral public key;
for an AES method, the nonce) and the ciphertext.

- The salt and the nonce are not secrets, and decryption needs them. Every seal draws a fresh random
  nonce, and a fresh salt where there is one, so a nonce repeats under the same key only by chance.
- The password, the key, a private key and any derived key never appear unencrypted in the
  envelope, in any field or encoding.
- The secret that opens the envelope is supplied at decryption.

**Reference.** `src/crypto/envelope.ts`: the `Envelope` type has no field a secret could go in,
serialisation writes only its known fields, and reading refuses any other field.

## No network calls after load

**Problem.** A page that can send a request after it has loaded can send what the user typed or
opened. The offline file must also work with no connection at all.

**Pattern.** Every asset is fetched when the page opens, or inlined: no lazy-loaded chunk, and no
WASM module or font fetched on demand. After that, the app makes no network request.

- A text field sets `spellcheck="false"`: a browser's enhanced spellcheck can send what is typed to
  a server, and no policy can stop it.

**Reference.** `vite.config.ts` builds one self-contained file with `vite-plugin-singlefile`;
`build/csp.ts` adds the policy, with `connect-src 'none'`; `PLAIN` in `src/ui/workbench.ts` turns
spellcheck off.

## No third-party scripts

**Problem.** A script loaded from another origin runs with full access to the page, and it can
change without any commit here.

**Pattern.** Every script the app runs is part of its own build. Dependencies, including any of the
`@borrowdale/core`, `fills`, `text` and `charts` packages the app uses, are bundled by Vite rather
than loaded from a CDN.

**Reference.** `build/csp.ts`: the built page's policy allows only the scripts inlined into it, each
by its SHA-256 hash, so a script from anywhere else does not run.

## Check the published output, not the source

**Problem.** A rule about what users receive (no third-party script, nothing fetched from
elsewhere) can be broken by a dependency or the build, not only by the code written here. Checking
each source file would miss the combination.

**Pattern.** A check reads the files that are actually published, the built app and the offline
file, and fails on the first violation, naming the file.

- The message is `<file>: <what is wrong>`.
- A new rule for the output is one more assertion in the check that already reads it, not a new
  script.

As of 2026-11-24, the build refuses a page it did not produce as `index.html`, one with no inline
script, one whose script is still loaded by `src` or is empty, and one with no `<head>` for the
policy (`vite.config.ts`, `build/csp.ts`). Each refusal names the file in the form above. The check
that reads the whole published output is not built yet.

## Open every seal before offering it

**Problem.** An envelope that cannot be opened loses what was sealed in it. The user may find out
only when the original is gone.

**Pattern.** Sealing writes the envelope as text, reads that text back, opens it and compares the
result with what was sealed. Only then is the envelope returned. If they differ, nothing is offered
and the user is told.

- A learning cipher that gives back a normalised text, such as Playfair, is compared with that
  normalised form.
- The sender of a public-key envelope holds no private key. The check derives the content key again
  from the salt and ephemeral key read back from the text, so only the recipient's side is
  unchecked.

**Reference.** `seal` in `src/crypto/seal.ts`.

## Words in one catalog

**Problem.** Words written beside the code drift from the rules they describe, and a new error or
method could reach the page with no words.

**Pattern.** The crypto layer reports a failure as a stable code, with the offending value as its
detail, and holds no message text. The interface turns codes, method IDs and key kinds into words
from one catalog, keyed by their own types, so adding one without its words does not compile. A
number the words state, such as a limit, is read from the constant the code enforces.

**Reference.** `src/crypto/errors.ts`; `src/ui/catalog.ts`.

## Text from an envelope is the sender's

**Problem.** Whoever made an envelope chose its method name, its field names and the name of a file
inside it. Shown as they are, they could pass for the page's own words, hide characters, or disguise
a file's type.

**Pattern.** A value from an envelope is never written as markup. A value quoted in a message loses
its control and format characters and is cut to 32 characters. An opened file's name is cleaned and
shortened, keeping its extension, before it is shown or saved, and it is shown apart from the page's
words.

**Reference.** `quoted` in `src/ui/catalog.ts`; `safeFileName` and `senderName` in
`src/ui/workbench.ts`.

## Plainly fictional fixtures

**Problem.** Tests and examples need inputs and secrets, and this repository is public. A real one
would leak; a realistic-looking one could be taken for a leak.

**Pattern.** Test inputs and secrets are plainly made up (a sample sentence, a throwaway password,
a key generated for the test) or are published test vectors, with their source named. Nothing in a
fixture is real data.

**Reference.** `test/seal.test.ts` uses a throwaway sentence and password; `test/vectors.test.ts`
uses test case 15 of the GCM specification; `scripts/golden-envelopes.mjs` builds its samples from
counting bytes, a sample sentence and the keys of RFC 7748, section 6.1.
