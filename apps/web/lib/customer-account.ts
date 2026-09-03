// Conta do consumidor: código de acesso, vinculação de histórico e
// encerramento (Parte 1 §10, Parte 2 §4).
//
// Deliberadamente sem cookies e sem nada do Next: são operações de banco, e
// mantê-las separadas da sessão é o que permite testá-las sem subir servidor.
// A camada de sessão fica em customer-session.ts.
//
// Sem senha, por decisão de produto: o cliente informa o telefone, recebe um
// código e entra. As defesas que isso exige:
//  - código guardado como HMAC, com expiração curta;
//  - tentativas contadas, para força bruta não compensar;
//  - limite de pedidos por telefone, para a tela não virar máquina de SMS;
//  - a resposta é sempre a mesma, exista o telefone ou não, para não revelar
//    quem tem cadastro (Parte 2 §4: impedir enumeração de telefone).

import { prisma } from "@barber/db";
import {
  InvalidPhoneError,
  generateToken,
  hashToken,
  normalizePhoneBR,
} from "@barber/domain";
import { randomInt, timingSafeEqual } from "node:crypto";
import { messagingProvider } from "./messaging.ts";

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/// Quantos pedidos de código o mesmo telefone pode fazer numa janela curta.
const MAX_REQUESTS_PER_WINDOW = 3;
const REQUEST_WINDOW_MINUTES = 15;

export { InvalidPhoneError };

export class TooManyRequestsError extends Error {
  constructor() {
    super("Muitas tentativas. Aguarde alguns minutos.");
    this.name = "TooManyRequestsError";
  }
}

export class InvalidCodeError extends Error {
  constructor() {
    super("Código inválido ou expirado.");
    this.name = "InvalidCodeError";
  }
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET não configurado");
  return value;
}

/// 6 dígitos, sorteados com gerador criptográfico — Math.random seria
/// previsível o bastante para valer a pena atacar.
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface RequestCodeResult {
  /// Sempre "enviado", exista o telefone ou não: a tela nunca revela cadastro.
  sent: true;
}

export async function requestAccessCode(rawPhone: string): Promise<RequestCodeResult> {
  const destination = normalizePhoneBR(rawPhone);

  const janela = new Date(Date.now() - REQUEST_WINDOW_MINUTES * 60000);
  const recentes = await prisma.customerAuthChallenge.count({
    where: { destination, createdAt: { gte: janela } },
  });
  if (recentes >= MAX_REQUESTS_PER_WINDOW) throw new TooManyRequestsError();

  const code = generateCode();

  // Pedir um código novo invalida os anteriores: dois códigos válidos ao mesmo
  // tempo dobrariam a chance de acerto de quem estivesse tentando adivinhar.
  await prisma.customerAuthChallenge.updateMany({
    where: { destination, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await prisma.customerAuthChallenge.create({
    data: {
      destination,
      channel: "SMS",
      codeHash: hashToken(code, secret()),
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60000),
    },
  });

  await messagingProvider().sendAccessCode({ destination, code, channel: "SMS" });

  return { sent: true };
}

export interface VerifyResult {
  customerId: string;
  /// Relações vinculadas agora, para a tela poder dizer o que aconteceu
  linkedRelations: number;
}

/// Vincula as relações desse telefone ao consumidor verificado.
///
/// Só entram relações com atividade nos últimos 12 meses. Número de celular é
/// reciclado no Brasil, e sem esse corte quem recebesse um número reaproveitado
/// herdaria o histórico do dono anterior — inclusive nome e atendimentos em
/// barbearias que nunca visitou (docs/delivery-part3.md §3.4). Relações mais
/// antigas continuam acessíveis pelo link de gestão da própria reserva.
const LINK_WINDOW_MONTHS = 12;

export async function verifyAccessCode(
  rawPhone: string,
  code: string
): Promise<VerifyResult> {
  const destination = normalizePhoneBR(rawPhone);

  const challenge = await prisma.customerAuthChallenge.findFirst({
    where: { destination, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) throw new InvalidCodeError();

  if (challenge.attempts >= MAX_ATTEMPTS) {
    await prisma.customerAuthChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    throw new TooManyRequestsError();
  }

  const informado = Buffer.from(hashToken(code, secret()), "hex");
  const esperado = Buffer.from(challenge.codeHash, "hex");
  const confere =
    informado.length === esperado.length && timingSafeEqual(informado, esperado);

  if (!confere) {
    await prisma.customerAuthChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    throw new InvalidCodeError();
  }

  return prisma.$transaction(async (tx) => {
    await tx.customerAuthChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    const existente = await tx.customer.findFirst({ where: { normalizedPhone: destination } });

    const relacoes = await tx.barbershopCustomer.findMany({
      where: { normalizedPhone: destination, customerId: null },
      orderBy: { createdAt: "desc" },
    });

    const customer =
      existente ??
      (await tx.customer.create({
        data: {
          normalizedPhone: destination,
          displayName: relacoes[0]?.currentName ?? "Cliente",
          phoneVerifiedAt: new Date(),
        },
      }));

    if (existente && !existente.phoneVerifiedAt) {
      await tx.customer.update({
        where: { id: existente.id },
        data: { phoneVerifiedAt: new Date() },
      });
    }

    const corte = new Date();
    corte.setMonth(corte.getMonth() - LINK_WINDOW_MONTHS);

    const vinculaveis = relacoes.filter(
      (relacao) => (relacao.lastVisitAt ?? relacao.createdAt) >= corte
    );

    if (vinculaveis.length > 0) {
      await tx.barbershopCustomer.updateMany({
        where: { id: { in: vinculaveis.map((r) => r.id) } },
        data: { customerId: customer.id },
      });
    }

    return { customerId: customer.id, linkedRelations: vinculaveis.length };
  });
}

/// Encerramento de conta (decisão #7 da Parte 1, LGPD).
///
/// Anonimiza a identificação no cadastro global e em cada relação, e preserva
/// o histórico operacional agregado — a barbearia precisa dele para a própria
/// contabilidade, e ele deixa de apontar para uma pessoa identificável.
export async function closeCustomerAccount(customerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const relacoes = await tx.barbershopCustomer.findMany({ where: { customerId } });

    for (const relacao of relacoes) {
      await tx.barbershopCustomer.update({
        where: { id: relacao.id },
        data: {
          currentName: "Cliente removido",
          // O telefone é a chave de deduplicação da relação, então não pode
          // simplesmente sumir: vira um valor irreversível e único.
          normalizedPhone: `+00000000${relacao.id.slice(0, 8)}`,
          notes: null,
          customerId: null,
        },
      });
    }

    // Consentimentos são revogados, não apagados: a revogação em si precisa
    // ficar registrada.
    await tx.consent.updateMany({
      where: { customerId, status: "GRANTED" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });

    await tx.customerSession.updateMany({
      where: { customerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await tx.customer.update({
      where: { id: customerId },
      data: {
        displayName: "Cliente removido",
        normalizedPhone: null,
        email: null,
        phoneVerifiedAt: null,
        accountStatus: "ANONYMIZED",
        anonymizedAt: new Date(),
      },
    });
  });
}
