// Identificador del perfil (SRS 18, punto 11): el cliente genera el UUID. Usa crypto.randomUUID,
// que solo existe en contextos seguros (HTTPS o localhost) y desde Safari 15.4. Si falta (por
// ejemplo, al probar en un iPhone por http://IP-local), se arma un v4 con getRandomValues, que
// si esta disponible en cualquier contexto. Nunca se usa Math.random: el UUID es una credencial.

type CryptoLike = Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string };

export function newProfileId(cryptoSource: CryptoLike = globalThis.crypto): string {
  if (typeof cryptoSource.randomUUID === "function") return cryptoSource.randomUUID();
  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  // RFC 4122: version 4 (0100) y variante 10xx.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
