/**
 * AES-GCM-256 encrypt/decrypt for per-site Google credential fields
 * (`refresh_token`). `additionalData` binds the ciphertext to the row it was
 * written for (`site:{site_id}:refresh_token`), so lifting one site's
 * ciphertext onto another site's row fails to decrypt instead of silently
 * succeeding.
 */

export interface EncryptedField {
  readonly ciphertext: string; // base64
  readonly iv: string; // base64, 12 random bytes
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importCredentialKey(keyBase64: string): Promise<CryptoKey> {
  const raw = base64Decode(keyBase64);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptCredential(
  plaintext: string,
  keyBase64: string,
  additionalData: string,
): Promise<EncryptedField> {
  const key = await importCredentialKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(additionalData),
    },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: base64Encode(new Uint8Array(ciphertext)),
    iv: base64Encode(iv),
  };
}

export async function decryptCredential(
  field: EncryptedField,
  keyBase64: string,
  additionalData: string,
): Promise<string> {
  const key = await importCredentialKey(keyBase64);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64Decode(field.iv),
      additionalData: new TextEncoder().encode(additionalData),
    },
    key,
    base64Decode(field.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
