// Onboarding (lib/onboarding.ts), contra Postgres real.
//
// O que este teste existe para provar: toda barbearia nova nasce com uma
// assinatura de trial no Pro — decisão registrada em docs/design-part4.md —
// sem isso, ninguém veria a Agenda Inteligente antes de pagar por um plano
// que o Marco 7 ainda nem vende.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const { prisma } = await import("@barber/db");
const { signUpOwner } = await import("../lib/onboarding.ts");

const emails = [];

after(async () => {
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

describe("assinatura de trial no onboarding", () => {
  test("barbearia nova nasce em TRIALING no plano Pro", async () => {
    const email = `trial-${randomUUID()}@teste.com`;
    emails.push(email);

    const result = await signUpOwner({
      ownerName: "Dono",
      email,
      password: "senha-bem-longa-1",
      barbershopName: `Trial ${randomUUID().slice(0, 8)}`,
      timezone: "America/Sao_Paulo",
    });

    const subscription = await prisma.subscription.findUnique({
      where: { barbershopId: result.barbershopId },
      include: { plan: true },
    });

    assert.ok(subscription, "toda barbearia precisa nascer com uma assinatura");
    assert.equal(subscription.status, "TRIALING");
    assert.equal(subscription.plan.code, "pro");
    assert.ok(subscription.currentPeriodStart);
    assert.ok(subscription.currentPeriodEnd);

    const diasDeTrial =
      (subscription.currentPeriodEnd.getTime() - subscription.currentPeriodStart.getTime()) /
      86_400_000;
    assert.equal(Math.round(diasDeTrial), 14);

    await prisma.barbershop.deleteMany({ where: { id: result.barbershopId } });
  });

  test("assinaturas de barbearias diferentes são independentes", async () => {
    const emailA = `trial-a-${randomUUID()}@teste.com`;
    const emailB = `trial-b-${randomUUID()}@teste.com`;
    emails.push(emailA, emailB);

    const a = await signUpOwner({
      ownerName: "Dono A",
      email: emailA,
      password: "senha-bem-longa-1",
      barbershopName: `Trial A ${randomUUID().slice(0, 8)}`,
      timezone: "America/Sao_Paulo",
    });
    const b = await signUpOwner({
      ownerName: "Dono B",
      email: emailB,
      password: "senha-bem-longa-1",
      barbershopName: `Trial B ${randomUUID().slice(0, 8)}`,
      timezone: "America/Sao_Paulo",
    });

    const [subA, subB] = await Promise.all([
      prisma.subscription.findUniqueOrThrow({ where: { barbershopId: a.barbershopId } }),
      prisma.subscription.findUniqueOrThrow({ where: { barbershopId: b.barbershopId } }),
    ]);

    assert.notEqual(subA.id, subB.id);
    assert.equal(subA.barbershopId, a.barbershopId);
    assert.equal(subB.barbershopId, b.barbershopId);

    await prisma.barbershop.deleteMany({ where: { id: { in: [a.barbershopId, b.barbershopId] } } });
  });
});
