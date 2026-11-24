# Security

cipher-envelope encrypts in the browser, so a weakness in it can expose what people seal. Report
one privately, so that it can be fixed before it is public.

## Report a vulnerability

Do not open a public issue. Use GitHub's private reporting instead: on the repository's
**Security** tab, choose **Report a vulnerability**
([direct link](https://github.com/f-f-9-9-0-0/cipher-envelope/security/advisories/new)). Only you
and the maintainers see the report.

Include:

- what is wrong, and what someone could do with it;
- where you found it: the hosted app's address, the release of the offline file, or the commit you
  built it from;
- the method and the kind of secret, as the app names them, and the browser;
- the steps that show it, with a made-up input and a throwaway secret.

**Never send a real password, key, key file or private key, or an envelope made from data you care
about.**

## What to report

- A way to read, change or forge what an envelope holds without its secret, beyond the limits
  [`standards.md`](standards.md) states.
- A secret, or anything derived from it, leaving the page: in the envelope, a file name, a request
  or anything the page writes.
- Text from an envelope that the page shows or saves as something it is not, such as a file name
  that hides its type.
- Anything in the built page that loads or runs code from elsewhere.

## What is not a vulnerability

- The learning ciphers (Caesar, Atbash, Vigenère, rail fence and Playfair). They protect nothing,
  and the page says so in red.
- The limits [`standards.md`](standards.md) records: AES-256-CBC cannot detect a changed envelope,
  and the key does not depend on the method.
- A weak password.

## What happens next

The maintainer replies in the private report, fixes the problem, and publishes the advisory once
the fix is out. There is no release yet, so a fix lands in `main`.
