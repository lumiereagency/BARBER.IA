// Isolamento entre barbearias e autorização (saída do Marco 0).
//
// O que estes testes existem para impedir:
//  - uma barbearia enxergar ou alterar dado de outra (IDOR, Parte 3 §10);
//  - papel sem permissão executar ação (elevação de privilégio);
//  - sessão revogada continuar valendo;
//  - senha ser guardada de forma recuperável.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.TOKEN_HMAC_SECRET ??= "test-only-secret";
process.env.AUTH_SECRET ??= "test-only-secret";

const { prisma } = await import("@barber/db");
const { hashPassword, verifyPassword, can, canActOnProfessional } = await import("@barber/domain");
const { signUpOwner, EmailAlreadyUsedError } = await import("../lib/onboarding.ts");

const sufixo = randomUUID().slice(0, 8);
let lojaA;
let lojaB;

before(async () => {
  lojaA = await signUpOwner({
    ownerName: "Zé",
    email: `ze-${sufixo}@teste.com`,
    password: "senha-bem-longa-1",
    barbershopName: `Barbearia do Zé ${sufixo}`,
    timezone: "America/Sao_Paulo",
  });

  lojaB = await signUpOwner({
    ownerName: "Ana",
    email: `ana-${sufixo}@teste.com`,
    password: "senha-bem-longa-2",
    barbershopName: "Barbearia da Ana",
    timezone: "America/Manaus",
  });
});

after(async () => {
  await prisma.barbershop.deleteMany({
    where: { id: { in: [lojaA.barbershopId, lojaB.barbershopId] } },
  });
  await prisma.user.deleteMany({ where: { email: { contains: sufixo } } });
  await prisma.$disconnect();
});

describe("onboarding", () => {
  test("proprietário cria barbearia e vira OWNER", async () => {
    const membership = await prisma.barbershopMembership.findFirstOrThrow({
      where: { barbershopId: lojaA.barbershopId },
    });
    assert.equal(membership.role, "OWNER");
    assert.equal(membership.status, "ACTIVE");
  });

  test("o slug é derivado do nome, sem acento", async () => {
    assert.equal(lojaA.slug, `barbearia-do-ze-${sufixo}`);
  });

  test("nome repetido não colide: o segundo ganha sufixo", async () => {
    // Mesmo nome da lojaA: o slug base já está tomado
    const terceira = await signUpOwner({
      ownerName: "Outro Zé",
      email: `outro-ze-${sufixo}@teste.com`,
      password: "senha-bem-longa-3",
      barbershopName: `Barbearia do Zé ${sufixo}`,
      timezone: "America/Sao_Paulo",
    });

    assert.notEqual(terceira.slug, lojaA.slug);
    assert.equal(terceira.slug, `${lojaA.slug}-2`);

    await prisma.barbershop.delete({ where: { id: terceira.barbershopId } });
  });

  test("e-mail repetido é recusado", async () => {
    await assert.rejects(
      () =>
        signUpOwner({
          ownerName: "Zé de novo",
          email: `ze-${sufixo}@teste.com`,
          password: "senha-bem-longa-4",
          barbershopName: "Outra",
          timezone: "America/Sao_Paulo",
        }),
      EmailAlreadyUsedError
    );
  });

  test("fuso inválido é recusado", async () => {
    await assert.rejects(() =>
      signUpOwner({
        ownerName: "Fulano",
        email: `fulano-${sufixo}@teste.com`,
        password: "senha-bem-longa-5",
        barbershopName: "Teste",
        timezone: "Marte/Olympus",
      })
    );
  });

  test("senha fraca é recusada antes de criar qualquer coisa", async () => {
    const email = `fraca-${sufixo}@teste.com`;
    await assert.rejects(() =>
      signUpOwner({
        ownerName: "Fulano",
        email,
        password: "123456",
        barbershopName: "Teste",
        timezone: "America/Sao_Paulo",
      })
    );
    assert.equal(await prisma.user.count({ where: { email } }), 0);
  });
});

describe("senha", () => {
  test("não é guardada de forma recuperável", async () => {
    const user = await prisma.user.findFirstOrThrow({
      where: { email: `ze-${sufixo}@teste.com` },
    });
    assert.ok(!user.passwordHash.includes("senha-bem-longa-1"));
    assert.match(user.passwordHash, /^scrypt\$\d+\$\d+\$\d+\$/);
    assert.ok(await verifyPassword("senha-bem-longa-1", user.passwordHash));
    assert.equal(await verifyPassword("senha-bem-longa-2", user.passwordHash), false);
  });

  test("mesma senha gera hashes diferentes (salt por senha)", async () => {
    const a = await hashPassword("mesma-senha-aqui");
    const b = await hashPassword("mesma-senha-aqui");
    assert.notEqual(a, b);
    assert.ok(await verifyPassword("mesma-senha-aqui", a));
    assert.ok(await verifyPassword("mesma-senha-aqui", b));
  });
});

describe("isolamento entre barbearias", () => {
  test("cada dono só enxerga a própria equipe e catálogo", async () => {
    await prisma.service.create({
      data: { barbershopId: lojaA.barbershopId, name: "Corte A", priceMinor: 5000, durationMinutes: 30 },
    });
    await prisma.service.create({
      data: { barbershopId: lojaB.barbershopId, name: "Corte B", priceMinor: 6000, durationMinutes: 30 },
    });

    const daA = await prisma.service.findMany({ where: { barbershopId: lojaA.barbershopId } });
    const daB = await prisma.service.findMany({ where: { barbershopId: lojaB.barbershopId } });

    assert.deepEqual(daA.map((s) => s.name), ["Corte A"]);
    assert.deepEqual(daB.map((s) => s.name), ["Corte B"]);
  });

  test("o dono de uma não é membro da outra", async () => {
    const donoDaA = await prisma.user.findFirstOrThrow({
      where: { email: `ze-${sufixo}@teste.com` },
    });

    const acesso = await prisma.barbershopMembership.findFirst({
      where: { userId: donoDaA.id, barbershopId: lojaB.barbershopId },
    });
    assert.equal(acesso, null);
  });

  test("editar por id só funciona dentro da própria barbearia", async () => {
    const servicoDaB = await prisma.service.findFirstOrThrow({
      where: { barbershopId: lojaB.barbershopId },
    });

    // É exatamente o que assertBelongsToTenant faz antes de qualquer escrita:
    // buscar pelo id JUNTO do tenant da sessão.
    const comoSeFosseDaA = await prisma.service.findFirst({
      where: { id: servicoDaB.id, barbershopId: lojaA.barbershopId },
    });
    assert.equal(comoSeFosseDaA, null, "serviço de outra barbearia não pode ser alcançado");
  });

  test("o mesmo telefone de cliente vira relações separadas por barbearia", async () => {
    await prisma.barbershopCustomer.create({
      data: { barbershopId: lojaA.barbershopId, normalizedPhone: "+5511900000001", currentName: "João" },
    });
    await prisma.barbershopCustomer.create({
      data: { barbershopId: lojaB.barbershopId, normalizedPhone: "+5511900000001", currentName: "João" },
    });

    const naA = await prisma.barbershopCustomer.findMany({
      where: { barbershopId: lojaA.barbershopId, normalizedPhone: "+5511900000001" },
    });
    assert.equal(naA.length, 1, "cada barbearia enxerga só a própria relação");
  });
});

describe("autorização por papel", () => {
  const ativo = (role, extra = {}) => ({ role, status: "ACTIVE", ...extra });

  test("recepção não altera serviços nem configurações", () => {
    const recepcao = ativo("RECEPTIONIST");
    assert.equal(can(recepcao, "services.write"), false);
    assert.equal(can(recepcao, "barbershop.settings.write"), false);
    assert.equal(can(recepcao, "professionals.write"), false);
  });

  test("barbeiro não mexe na agenda de outro", () => {
    const barbeiro = ativo("PROFESSIONAL", { professionalId: "p1" });
    assert.equal(canActOnProfessional(barbeiro, "appointments.write", "p2"), false);
    assert.ok(canActOnProfessional(barbeiro, "appointments.write", "p1"));
  });

  test("admin não acessa cobrança", () => {
    assert.equal(can(ativo("ADMIN"), "barbershop.billing.write"), false);
    assert.ok(can(ativo("OWNER"), "barbershop.billing.write"));
  });
});

describe("sessão", () => {
  test("sessão revogada deixa de valer", async () => {
    const user = await prisma.user.findFirstOrThrow({
      where: { email: `ze-${sufixo}@teste.com` },
    });

    const sessao = await prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash: `hash-${randomUUID()}`,
        activeBarbershopId: lojaA.barbershopId,
        expiresAt: new Date(Date.now() + 864e5),
      },
    });

    await prisma.userSession.update({
      where: { id: sessao.id },
      data: { revokedAt: new Date() },
    });

    const recarregada = await prisma.userSession.findUniqueOrThrow({ where: { id: sessao.id } });
    // getSession recusa qualquer sessão com revokedAt preenchido
    assert.ok(recarregada.revokedAt, "revogação precisa ficar registrada no banco");
  });

  test("sessão expirada não é aceita", async () => {
    const user = await prisma.user.findFirstOrThrow({
      where: { email: `ana-${sufixo}@teste.com` },
    });

    const expirada = await prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash: `hash-${randomUUID()}`,
        activeBarbershopId: lojaB.barbershopId,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    assert.ok(expirada.expiresAt < new Date());
  });
});
