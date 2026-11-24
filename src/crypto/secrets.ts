// What a user supplies to seal or open an envelope.

import type { Bytes } from './bytes';
import { isDataKey, isLearnKey } from './methods';

/** A secret for a method meant for real data. */
export type DataSecret =
  | { readonly kind: 'password'; readonly password: string }
  | { readonly kind: 'generated'; readonly key: string }
  | { readonly kind: 'keyfile'; readonly file: Bytes }
  | { readonly kind: 'publickey'; readonly publicKey: string };

/** A key for a classical learning cipher, as typed. */
export type LearnSecret =
  | { readonly kind: 'shift'; readonly shift: string }
  | { readonly kind: 'keyword'; readonly keyword: string }
  | { readonly kind: 'rails'; readonly rails: string }
  | { readonly kind: 'none' };

export type SealSecret = DataSecret | LearnSecret;

/** What opens a data envelope: the same as sealed it, except a public key opens with the private-key file. */
export type OpenDataSecret = Exclude<DataSecret, { kind: 'publickey' }> | { readonly kind: 'privatekey'; readonly file: string };

export type OpenSecret = OpenDataSecret | LearnSecret;

export function isDataSecret(secret: SealSecret): secret is DataSecret {
  return isDataKey(secret.kind);
}

export function isLearnSecret(secret: OpenSecret): secret is LearnSecret {
  return isLearnKey(secret.kind);
}
