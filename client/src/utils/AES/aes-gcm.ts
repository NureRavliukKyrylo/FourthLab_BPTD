import { base64ToBytes, bytesToBase64 } from "../encoding/base64";

function toArrayBufferU8(u8: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(u8) as Uint8Array<ArrayBuffer>;
}

function bigIntToBytes(n: bigint): Uint8Array<ArrayBuffer> {
  if (n < 0n) throw new Error("bigint_negative");
  if (n === 0n) return new Uint8Array([0]);
  let hex = n.toString(16);
  if (hex.length % 2 === 1) hex = "0" + hex;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function deriveAesGcmKey(sharedKey: bigint): Promise<CryptoKey> {
  const material = bigIntToBytes(sharedKey);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptAesGcm(
  plaintext: string,
  key: CryptoKey
): Promise<{ cipher: string; nonce: string }> {
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);

  const pt = toArrayBufferU8(new TextEncoder().encode(plaintext));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, pt);

  return {
    cipher: bytesToBase64(toArrayBufferU8(new Uint8Array(ct))),
    nonce: bytesToBase64(nonce as Uint8Array<ArrayBuffer>),
  };
}

export async function decryptAesGcm(cipher: string, nonce: string, key: CryptoKey): Promise<string> {
  const ct = base64ToBytes(cipher);
  const iv = base64ToBytes(nonce);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
