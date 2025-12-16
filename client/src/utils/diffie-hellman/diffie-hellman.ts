function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, "0");
  if (hex === "") return 0n;
  return BigInt("0x" + hex);
}

function bitLength(n: bigint): number {
  if (n <= 0n) return 0;
  return n.toString(2).length;
}

function randomBigIntBelow(maxExclusive: bigint): bigint {
  if (maxExclusive <= 1n) throw new Error("maxExclusive_invalid");
  const bits = bitLength(maxExclusive - 1n);
  const bytesLen = Math.ceil(bits / 8);
  const buf = new Uint8Array(bytesLen);
  while (true) {
    crypto.getRandomValues(buf);
    const r = bytesToBigInt(buf);
    if (r < maxExclusive) return r;
  }
}

function randomBigIntInRange(minInclusive: bigint, maxInclusive: bigint): bigint {
  if (maxInclusive < minInclusive) throw new Error("range_invalid");
  const span = maxInclusive - minInclusive + 1n;
  return minInclusive + randomBigIntBelow(span);
}

export function generatePrivateKey(p: bigint): bigint {
  if (p <= 5n) throw new Error("p_too_small");
  return randomBigIntInRange(2n, p - 2n);
}

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod <= 0n) throw new Error("mod_invalid");
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

export function generatePublicKey(g: bigint, privateKey: bigint, p: bigint): bigint {
  return modPow(g, privateKey, p);
}

export function computeIntermediate(receivedValue: bigint, privateKey: bigint, p: bigint): bigint {
  return modPow(receivedValue, privateKey, p);
}
