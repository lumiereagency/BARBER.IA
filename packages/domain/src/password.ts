// Hash de senha da equipe.
//
// Usa scrypt do próprio Node: é um KDF memory-hard, recomendado pela OWASP ao
// lado de argon2 e bcrypt, e evita trazer dependência nativa só para isto. Os
// parâmetros ficam gravados junto do hash, então aumentar o custo no futuro não
// invalida as senhas já existentes.
//
// Nunca usar aqui o HMAC dos tokens de link: aquele precisa ser determinístico
// e barato porque é buscado por igualdade; senha precisa ser lenta e salgada.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

interface ScryptOptions {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

/// promisify perde a sobrecarga com opções, e sem opções o custo cairia para o
/// padrão do Node — por isso a Promise é montada à mão.
function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/// N = 2^16. Custo de memória = 128 * N * r ≈ 64 MB por verificação.
const COST = 65536;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 128 * COST * BLOCK_SIZE * 2;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPasswordError";
  }
}

/// Regra mínima deliberadamente simples: comprimento é o que mais importa, e
/// exigir símbolo costuma só produzir "Senha1!" — mais frágil e mais esquecível.
export function assertStrongPassword(password: string): void {
  if (password.length < 10) {
    throw new WeakPasswordError("A senha precisa ter pelo menos 10 caracteres");
  }
  if (password.length > 200) {
    throw new WeakPasswordError("A senha é longa demais");
  }
  if (/^\d+$/.test(password)) {
    throw new WeakPasswordError("A senha não pode ser só números");
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertStrongPassword(password);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    maxmem: MAX_MEMORY,
  });

  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, cost, blockSize, parallelization, saltB64, hashB64] = parts as [
    string, string, string, string, string, string,
  ];

  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");

  let derived: Buffer;
  try {
    derived = await scrypt(password, salt, expected.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelization),
      maxmem: MAX_MEMORY,
    });
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
