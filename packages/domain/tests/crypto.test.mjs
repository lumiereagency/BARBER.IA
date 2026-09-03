import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DecryptionError,
  EncryptionKeyError,
  decryptSecret,
  encryptSecret,
  generateEncryptionKey,
} from "../dist/crypto.js";

const CHAVE = generateEncryptionKey();
const OUTRA_CHAVE = generateEncryptionKey();
const SEGREDO = JSON.stringify({ refreshToken: "1//0abc-token-do-google", scope: "calendar" });

describe("cifra de credencial", () => {
  test("ida e volta preserva o conteúdo", () => {
    const cifrado = encryptSecret(SEGREDO, CHAVE);
    assert.equal(decryptSecret(cifrado, CHAVE), SEGREDO);
  });

  test("o texto cifrado não contém o segredo", () => {
    const cifrado = encryptSecret(SEGREDO, CHAVE);
    assert.equal(cifrado.includes("token-do-google"), false);
    assert.equal(cifrado.includes("refreshToken"), false);
  });

  test("cifrar duas vezes dá resultados diferentes", () => {
    // IV aleatório por operação: sem isso, dois profissionais com o mesmo
    // token teriam texto cifrado idêntico, revelando a coincidência.
    assert.notEqual(encryptSecret(SEGREDO, CHAVE), encryptSecret(SEGREDO, CHAVE));
  });

  test("chave errada não decifra", () => {
    const cifrado = encryptSecret(SEGREDO, CHAVE);
    assert.throws(() => decryptSecret(cifrado, OUTRA_CHAVE), DecryptionError);
  });

  test("conteúdo adulterado é detectado, não devolve lixo", () => {
    const cifrado = encryptSecret(SEGREDO, CHAVE);
    const partes = cifrado.split(".");
    // Troca um caractere do texto cifrado
    const adulterado = [
      partes[0],
      partes[1],
      partes[2],
      partes[3].slice(0, -2) + (partes[3].endsWith("AA") ? "BB" : "AA"),
    ].join(".");

    assert.throws(() => decryptSecret(adulterado, CHAVE), DecryptionError);
  });

  test("formato desconhecido é recusado", () => {
    assert.throws(() => decryptSecret("nao-e-cifrado", CHAVE), DecryptionError);
    assert.throws(() => decryptSecret("v9.a.b.c", CHAVE), DecryptionError);
  });
});

describe("chave", () => {
  test("chave ausente falha alto, em vez de gravar em claro", () => {
    assert.throws(() => encryptSecret(SEGREDO, ""), EncryptionKeyError);
  });

  test("chave de tamanho errado é recusada", () => {
    assert.throws(() => encryptSecret(SEGREDO, Buffer.from("curta").toString("base64")), EncryptionKeyError);
  });

  test("a chave gerada tem 32 bytes", () => {
    assert.equal(Buffer.from(generateEncryptionKey(), "base64").length, 32);
  });
});
