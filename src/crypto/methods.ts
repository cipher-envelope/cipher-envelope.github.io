// The one list of methods. An envelope names its method by ID; everything else about the method,
// its grade included, is looked up here when the envelope is read, so regrading a method reaches
// every envelope already saved. A published ID is never renamed or reused.

export type Grade = 'recommended' | 'legacy' | 'insecure';

/** Keys for methods meant for real data. */
export type DataKey = 'password' | 'generated' | 'keyfile' | 'publickey';
/** Keys the classical learning ciphers take, as each cipher defines them. */
export type LearnKey = 'shift' | 'keyword' | 'rails' | 'none';
export type KeyKind = DataKey | LearnKey;

/** What an AES method needs from Web Crypto. Every per-method decision reads it from here. */
export interface Cipher {
  readonly algorithm: 'AES-GCM' | 'AES-CBC';
  readonly nonceBytes: 12 | 16;
  /** Whether a wrong key or a changed envelope is detected, rather than giving garbage. */
  readonly authenticated: boolean;
}

export interface AesSpec {
  readonly family: 'aes';
  readonly grade: Grade;
  /** The kinds of key it can be sealed with. */
  readonly keys: readonly DataKey[];
  readonly cipher: Cipher;
}

/** A classical cipher works on the letters of typed text and takes exactly one kind of key. */
export interface ClassicalSpec {
  readonly family: 'classical';
  readonly grade: Grade;
  readonly key: LearnKey;
}

export type MethodSpec = AesSpec | ClassicalSpec;

const SPECS = {
  'aes-256-gcm': { family: 'aes', grade: 'recommended', keys: ['password', 'generated', 'keyfile', 'publickey'], cipher: { algorithm: 'AES-GCM', nonceBytes: 12, authenticated: true } },
  'aes-256-cbc': { family: 'aes', grade: 'legacy', keys: ['password', 'generated', 'keyfile'], cipher: { algorithm: 'AES-CBC', nonceBytes: 16, authenticated: false } },
  vigenere: { family: 'classical', grade: 'insecure', key: 'keyword' },
  caesar: { family: 'classical', grade: 'insecure', key: 'shift' },
  atbash: { family: 'classical', grade: 'insecure', key: 'none' },
  'rail-fence': { family: 'classical', grade: 'insecure', key: 'rails' },
  playfair: { family: 'classical', grade: 'insecure', key: 'keyword' },
} as const satisfies Record<string, MethodSpec>;

export type MethodId = keyof typeof SPECS;
/** Derived from the list itself, so there is no second list of which methods are AES. */
export type AesMethodId = { [K in MethodId]: (typeof SPECS)[K]['family'] extends 'aes' ? K : never }[MethodId];
export type ClassicalMethodId = Exclude<MethodId, AesMethodId>;

// Object.keys is typed string[]; these objects are typed by their keys, so the keys are exactly the union.
export const METHOD_IDS = Object.keys(SPECS) as MethodId[];

const DATA_KEYS: Record<DataKey, true> = { password: true, generated: true, keyfile: true, publickey: true };
const LEARN_KEYS: Record<LearnKey, true> = { shift: true, keyword: true, rails: true, none: true };

/** The data keys in the order the interface offers them. */
export const DATA_KEY_ORDER = Object.keys(DATA_KEYS) as DataKey[];

export function isDataKey(key: string): key is DataKey {
  return Object.hasOwn(DATA_KEYS, key);
}

export function isLearnKey(key: string): key is LearnKey {
  return Object.hasOwn(LEARN_KEYS, key);
}

export function isMethodId(id: string): id is MethodId {
  return Object.hasOwn(SPECS, id);
}

export function isAes(id: MethodId): id is AesMethodId {
  return SPECS[id].family === 'aes';
}

export function aesSpec(id: AesMethodId): AesSpec {
  return SPECS[id];
}

export function classicalSpec(id: ClassicalMethodId): ClassicalSpec {
  return SPECS[id];
}

export function methodSpec(id: MethodId): MethodSpec {
  return SPECS[id];
}

export function gradeOf(id: MethodId): Grade {
  return SPECS[id].grade;
}

/** The kinds of key a method can be sealed with. */
export function keysOf(id: MethodId): readonly KeyKind[] {
  const spec = methodSpec(id);
  return spec.family === 'aes' ? spec.keys : [spec.key];
}

export function acceptsKey(id: MethodId, key: KeyKind): boolean {
  return keysOf(id).includes(key);
}

export function assertNever(value: never, what: string): never {
  throw new Error(`Unhandled ${what}: ${String(value)}`);
}
