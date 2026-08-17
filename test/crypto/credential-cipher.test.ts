import { describe, it, expect } from "vitest";
import {
  encryptCredential,
  decryptCredential,
} from "../../src/crypto/credential-cipher";

function randomKeyBase64(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("credential-cipher", () => {
  it("round-trips plaintext through encrypt then decrypt", async () => {
    const key = randomKeyBase64();
    const aad = "site:1:refresh_token";
    const encrypted = await encryptCredential("my-refresh-token", key, aad);
    const decrypted = await decryptCredential(encrypted, key, aad);
    expect(decrypted).toBe("my-refresh-token");
  });

  it("fails closed when the ciphertext is tampered with", async () => {
    const key = randomKeyBase64();
    const aad = "site:1:refresh_token";
    const encrypted = await encryptCredential("my-refresh-token", key, aad);

    const tamperedBytes = Uint8Array.from(atob(encrypted.ciphertext), (c) =>
      c.charCodeAt(0),
    );
    tamperedBytes[0] ^= 0xff;
    let tamperedBinary = "";
    for (const byte of tamperedBytes)
      tamperedBinary += String.fromCharCode(byte);
    const tampered = { ...encrypted, ciphertext: btoa(tamperedBinary) };

    await expect(decryptCredential(tampered, key, aad)).rejects.toThrow();
  });

  it("fails when decrypted with the wrong key", async () => {
    const key = randomKeyBase64();
    const wrongKey = randomKeyBase64();
    const aad = "site:1:refresh_token";
    const encrypted = await encryptCredential("my-refresh-token", key, aad);

    await expect(decryptCredential(encrypted, wrongKey, aad)).rejects.toThrow();
  });

  it("fails when decrypted with a different site's additionalData", async () => {
    const key = randomKeyBase64();
    const encrypted = await encryptCredential(
      "my-refresh-token",
      key,
      "site:1:refresh_token",
    );

    await expect(
      decryptCredential(encrypted, key, "site:2:refresh_token"),
    ).rejects.toThrow();
  });

  it("uses an independently random IV on each write of the same plaintext", async () => {
    const key = randomKeyBase64();
    const aad = "site:1:refresh_token";
    const first = await encryptCredential("same-plaintext", key, aad);
    const second = await encryptCredential("same-plaintext", key, aad);

    expect(first.iv).not.toBe(second.iv);
  });
});
