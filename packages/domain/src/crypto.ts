// Cifra de credenciais em repouso (Parte 2 §11: tokens criptografados).
//
// Os tokens OAuth do Google dão acesso ao calendário do profissional. Guardá-los
// em claro significaria que um dump do banco entrega esse acesso — por isso a
// chave vive fora do banco, na configuração.
//
// AES-256-GCM: além de cifrar, autentica. Se o texto cifrado for adulterado no
// banco, a decifragem falha em vez de devolver lixo silenciosamente.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recomendado para GCM
const KEY_LENGTH = 32;

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyError";
  }
}

export class DecryptionError extends Error {
  constructor() {
    super("Não foi possível decifrar a credencial");
    this.name = "DecryptionError";
  }
}

function parseKey(rawKey: string): Buffer {
  if (!rawKey) {
    throw new EncryptionKeyError(
      "ENCRYPTION_KEY ausente: sem ela não é possível guardar credencial de integração"
    );
  }

  const key = Buffer.from(rawKey, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new EncryptionKeyError(
      `ENCRYPTION_KEY precisa ter ${KEY_LENGTH} bytes em base64 (tem ${key.length})`
    );
  }
  return key;
}

/// Formato: v1.<iv>.<authTag>.<ciphertext>, tudo em base64url.
/// O prefixo de versão permite trocar de algoritmo depois sem adivinhar o
/// formato do que já está gravado.
export function encryptSecret(plaintext: string, rawKey: string): string {
  const key = parseKey(rawKey);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string, rawKey: string): string {
  const key = parseKey(rawKey);
  const parts = payload.split(".");

  if (parts.length !== 4 || parts[0] !== "v1") throw new DecryptionError();

  try {
    const iv = Buffer.from(parts[1]!, "base64url");
    const authTag = Buffer.from(parts[2]!, "base64url");
    const ciphertext = Buffer.from(parts[3]!, "base64url");

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Chave errada ou conteúdo adulterado dão o mesmo erro: distinguir os dois
    // ajudaria quem estivesse sondando.
    throw new DecryptionError();
  }
}

/// Gera uma chave nova, para o comando de setup.
export function generateEncryptionKey(): string {
  return randomBytes(KEY_LENGTH).toString("base64");
}
