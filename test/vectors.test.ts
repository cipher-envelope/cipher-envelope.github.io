import { expect, test } from 'vitest';
import { open } from '../src/crypto/seal';
import type { Envelope } from '../src/crypto/envelope';

// AES-256-GCM test case 15 from the GCM specification (McGrew and Viega), sent through this code's
// own opening path with the specification's key, IV, ciphertext and tag. Its plaintext is not an
// envelope payload, so a correct decryption ends in "garbled", while a broken tag ends in
// "wrong-secret": the difference proves the authenticated decryption itself ran correctly.

const KEY = '_v_pkoZlcxxtao-UZzCDCP7_6ZKGZXMcbWqPlGcwgwg';
const IV = 'yv66vvrO263eyviI';
const CIPHERTEXT_AND_TAG = 'Ui3B8JlWfQf0fzejKoRCfWQ6jNy_5cDJdZiivSVV0aqMsI5IWQ27PaewixBWgog4xfYeY5O6egq8yfZiiYAVrbCU2sXZNHG97BpQInDjzGw';
const TAG_WITH_ONE_BIT_FLIPPED = 'Ui3B8JlWfQf0fzejKoRCfWQ6jNy_5cDJdZiivSVV0aqMsI5IWQ27PaewixBWgog4xfYeY5O6egq8yfZiiYAVrbCU2sXZNHG97BpQInDjzG0';

const envelope = (ciphertext: string): Envelope => ({ format: 'cipher-envelope', version: 1, method: 'aes-256-gcm', opensWith: 'generated', nonce: IV, ciphertext });

test('the specification vector authenticates and decrypts', async () => {
  await expect(open(envelope(CIPHERTEXT_AND_TAG), { kind: 'generated', key: KEY })).rejects.toMatchObject({ code: 'garbled' });
});

test('one flipped tag bit is rejected as a wrong secret or a changed envelope', async () => {
  await expect(open(envelope(TAG_WITH_ONE_BIT_FLIPPED), { kind: 'generated', key: KEY })).rejects.toMatchObject({ code: 'wrong-secret' });
});
