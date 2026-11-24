// Every failure the crypto layer reports has a stable code. The interface turns the code into words
// from its catalog, so no message text lives here.

export type ErrorCode =
  | 'empty-input'
  | 'too-large'
  | 'learn-too-large'
  | 'text-only'
  | 'key-kind-unsupported'
  | 'password-empty'
  | 'generated-key-invalid'
  | 'keyfile-missing'
  | 'file-too-large'
  | 'file-unreadable'
  | 'public-key-invalid'
  | 'private-key-missing'
  | 'private-key-invalid'
  | 'x25519-unsupported'
  | 'shift-range'
  | 'keyword-letters'
  | 'rails-range'
  | 'not-envelope'
  | 'version-newer'
  | 'version-invalid'
  | 'method-unknown'
  | 'field-unknown'
  | 'field-invalid'
  | 'kdf-unknown'
  | 'iterations-range'
  | 'wrong-secret'
  | 'unauthenticated-failed'
  | 'garbled'
  | 'round-trip-failed';

export class CipherError extends Error {
  readonly code: ErrorCode;
  /** The offending value, such as an unknown method ID, named back to the user. */
  readonly detail: string | undefined;

  constructor(code: ErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = 'CipherError';
    this.code = code;
    this.detail = detail;
  }
}
