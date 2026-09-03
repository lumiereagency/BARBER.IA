// Tokens de link público: gestão da reserva (/a/{token}), hold e vaga.
//
// O token cru só existe no link entregue ao cliente. O banco guarda apenas o
// HMAC (Parte 2 §5.4 e §14) — assim um dump, um backup ou um log de query não
// entregam o poder de cancelar reserva de ninguém.
//
// HMAC e não bcrypt/argon: a busca precisa ser por igualdade, então o hash tem
// de ser determinístico. Quem resiste à força bruta aqui é a entropia do token
// (256 bits), e o segredo fora do banco impede derivar tokens a partir de um
// vazamento só do banco.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/// 32 bytes em base64url: 256 bits de entropia, sem caracteres que quebrem URL.
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string, secret: string): string {
  if (!secret) {
    // Falhar alto: um segredo vazio produziria hashes previsíveis e
    // transformaria todos os links em adivinháveis.
    throw new Error("TOKEN_HMAC_SECRET ausente: não é possível gerar hash de token");
  }
  return createHmac("sha256", secret).update(token).digest("hex");
}

/// Comparação em tempo constante, para não vazar prefixo por diferença de tempo.
export function tokensMatch(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
