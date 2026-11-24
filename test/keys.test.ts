import { describe, expect, test, vi } from 'vitest';
import bobPrivateKey from './golden/aes-256-gcm-publickey.private-key.json?raw';
import { thrown } from './thrown';
import { fromBase64Url } from '../src/crypto/bytes';
import { keyForRecipient, keyFromFile, keyFromGenerated, keyFromPassword, keyFromPrivateKeyFile, makeKeyPair, parseGeneratedKey, parsePrivateKeyFile, parsePublicKey } from '../src/crypto/keys';
import { aesSpec, isAes, isLearnKey } from '../src/crypto/methods';

// RFC 7748, section 6.1, Bob's key pair, in two PKCS#8 forms a v1 file does not hold: with the public
// key attached (RFC 5958, version 2), and under the Ed25519 algorithm identifier.
const BOB_PKCS8_WITH_PUBLIC_KEY = 'MFECAQEwBQYDK2VuBCIEIF2rCH5iSopLeeF_i4OADuZvO7EpJhi2_Rwviyf_iODrgSEA3p7bfXt9wbTTW2HC7OQ1Nz-DQ8hbeGdNrfx-FG-IK08';
const BOB_PKCS8_AS_ED25519 = 'MC4CAQAwBQYDK2VwBCIEIF2rCH5iSopLeeF_i4OADuZvO7EpJhi2_Rwviyf_iODr';
const BOB_FILE = JSON.parse(bobPrivateKey);
// The sample private key with one byte after it: the right prefix, the wrong length.
const BOB_PKCS8_ONE_BYTE_LONGER = `${BOB_FILE.privateKey}AA`;
/** Makes this platform export an X25519 private key in the PKCS#8 form that carries the public key too, as some do. */
const exportsPkcs8WithPublicKey = () => {
  const real = crypto.subtle.exportKey.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'exportKey').mockImplementation(((format: string, key: CryptoKey) =>
    format === 'pkcs8' ? Promise.resolve(fromBase64Url(BOB_PKCS8_WITH_PUBLIC_KEY).buffer) : real(format as 'raw', key)) as typeof crypto.subtle.exportKey);
};
// RFC 8410's PKCS#8 prefix for an X25519 private key.
const X25519_PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);

// 31 bytes (0x01 to 0x1f), base64url: one byte short of a key.
const THIRTY_ONE_BYTES = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw';

describe('refusing what is not a key', () => {
  test('a generated key one byte short', () => {
    expect(thrown(parseGeneratedKey, THIRTY_ONE_BYTES)).toMatchObject({ code: 'generated-key-invalid' });
  });
  test('a generated key with characters outside base64url', () => {
    expect(thrown(parseGeneratedKey, 'not a key!')).toMatchObject({ code: 'generated-key-invalid' });
  });
  test('a public key one byte short', () => {
    expect(thrown(parsePublicKey, THIRTY_ONE_BYTES)).toMatchObject({ code: 'public-key-invalid' });
  });
  test('a private-key file that is not one', () => {
    expect(thrown(parsePrivateKeyFile, '{}')).toMatchObject({ code: 'private-key-invalid' });
  });
});

describe('a private-key file is read strictly', () => {
  test('the sample private-key file is read', () => {
    expect(parsePrivateKeyFile(bobPrivateKey).publicKey.length).toBe(32);
  });
  test('a private-key file with a field it does not have is refused', () => {
    expect(thrown(parsePrivateKeyFile, JSON.stringify({ ...JSON.parse(bobPrivateKey), note: 'extra' }))).toMatchObject({ code: 'private-key-invalid' });
  });
});

describe('cipher facts come from the method registry', () => {
  test('AES-256-GCM uses a 12-byte nonce', () => {
    expect(aesSpec('aes-256-gcm').cipher.nonceBytes).toBe(12);
  });
  test('AES-256-CBC cannot detect a changed envelope', () => {
    expect(aesSpec('aes-256-cbc').cipher.authenticated).toBe(false);
  });
  test('a classical cipher is not an AES method', () => {
    expect(isAes('caesar')).toBe(false);
  });
  test('a rail count is a learning key', () => {
    expect(isLearnKey('rails')).toBe(true);
  });
  test('a password is not a learning key', () => {
    expect(isLearnKey('password')).toBe(false);
  });
});

describe('keys as the page holds them', () => {
  test('a pasted generated key with a trailing newline is read', () => {
    expect(parseGeneratedKey('AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA\n')).toHaveLength(32);
  });
  test('a key derived from a password cannot be exported', async () => {
    expect((await keyFromPassword('a throwaway password', new Uint8Array(16), 600_000, 'AES-GCM')).extractable).toBe(false);
  });
});

describe('no derived key can be exported', () => {
  test('a generated key', async () => {
    expect((await keyFromGenerated('AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA', 'AES-GCM')).extractable).toBe(false);
  });
  test('a key from a key file', async () => {
    expect((await keyFromFile(new TextEncoder().encode('a throwaway key file'), new Uint8Array(16), 'AES-GCM')).extractable).toBe(false);
  });
  test('a key agreed with a recipient', async () => {
    expect((await keyForRecipient(JSON.parse(bobPrivateKey).publicKey, new Uint8Array(16), 'AES-GCM')).key.extractable).toBe(false);
  });
  test('a key from a private-key file', async () => {
    expect((await keyFromPrivateKeyFile(bobPrivateKey, new Uint8Array(16), fromBase64Url('hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmo'), 'AES-GCM')).extractable).toBe(false);
  });
});

describe('a private-key file is only ever one kind of file', () => {
  test('another format is refused', () => {
    expect(thrown(parsePrivateKeyFile, JSON.stringify({ ...JSON.parse(bobPrivateKey), format: 'age' }))).toMatchObject({ code: 'private-key-invalid' });
  });
  test('another kind is refused', () => {
    expect(thrown(parsePrivateKeyFile, JSON.stringify({ ...JSON.parse(bobPrivateKey), kind: 'x25519-public' }))).toMatchObject({ code: 'private-key-invalid' });
  });
  test('a pasted public key with spaces around it is read', () => {
    expect(parsePublicKey(' hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmo\n')).toHaveLength(32);
  });
});

describe('a private-key file holds its key in one form only', () => {
  test('the PKCS#8 form with the public key attached is refused', () => {
    expect(thrown(parsePrivateKeyFile, JSON.stringify({ ...BOB_FILE, privateKey: BOB_PKCS8_WITH_PUBLIC_KEY }))).toMatchObject({ code: 'private-key-invalid' });
  });
  test('a key under another algorithm identifier is refused', () => {
    expect(thrown(parsePrivateKeyFile, JSON.stringify({ ...BOB_FILE, privateKey: BOB_PKCS8_AS_ED25519 }))).toMatchObject({ code: 'private-key-invalid' });
  });
  test('a private-key file of another version is refused', () => {
    expect(thrown(parsePrivateKeyFile, JSON.stringify({ ...BOB_FILE, version: 2 }))).toMatchObject({ code: 'private-key-invalid' });
  });
  test("a new key pair's private-key file starts with RFC 8410's prefix", async () => {
    const { privateKeyFile } = await makeKeyPair();
    expect(fromBase64Url(privateKeyFile.privateKey).subarray(0, 16)).toEqual(X25519_PKCS8_PREFIX);
  });
  test('a private key with a byte after the 32-byte key is refused', () => {
    expect(thrown(parsePrivateKeyFile, JSON.stringify({ ...BOB_FILE, privateKey: BOB_PKCS8_ONE_BYTE_LONGER }))).toMatchObject({ code: 'private-key-invalid' });
  });
  test('a key pair made where the platform exports PKCS#8 with the public key is still written in the 48-byte form', async () => {
    exportsPkcs8WithPublicKey();
    const { privateKeyFile } = await makeKeyPair();
    expect(fromBase64Url(privateKeyFile.privateKey)).toHaveLength(48);
  });
  test("a new key pair's private key is 48 bytes: the prefix and the 32-byte key", async () => {
    const { privateKeyFile } = await makeKeyPair();
    expect(fromBase64Url(privateKeyFile.privateKey)).toHaveLength(48);
  });
});
