import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  PERMISSIONS,
  can,
  canActOnProfessional,
  permissionsFor,
  assertCan,
  ForbiddenError,
} from "../dist/rbac.js";

const active = (role, extra = {}) => ({ role, status: "ACTIVE", ...extra });

describe("papéis", () => {
  test("OWNER tem todas as permissões", () => {
    const owner = permissionsFor(active("OWNER"));
    for (const permission of PERMISSIONS) {
      assert.ok(owner.has(permission), `OWNER deveria ter ${permission}`);
    }
  });

  test("ADMIN faz tudo menos dinheiro e fim da barbearia", () => {
    const admin = active("ADMIN");
    assert.equal(can(admin, "barbershop.billing.read"), false);
    assert.equal(can(admin, "barbershop.billing.write"), false);
    assert.equal(can(admin, "barbershop.transfer_or_close"), false);
    // e continua podendo o resto da operação
    assert.ok(can(admin, "services.write"));
    assert.ok(can(admin, "members.write"));
    assert.ok(can(admin, "reports.advanced.read"));
  });

  test("RECEPTIONIST opera agenda e clientes, mas não configura a casa", () => {
    const reception = active("RECEPTIONIST");
    assert.ok(can(reception, "appointments.write.all"));
    assert.ok(can(reception, "customers.write"));
    assert.ok(can(reception, "waitlist.act"));
    assert.equal(can(reception, "services.write"), false);
    assert.equal(can(reception, "professionals.write"), false);
    assert.equal(can(reception, "barbershop.settings.write"), false);
    assert.equal(can(reception, "members.write"), false);
    assert.equal(can(reception, "promotions.write"), false);
    assert.equal(can(reception, "reports.advanced.read"), false);
    assert.equal(can(reception, "integrations.write"), false);
  });

  test("PROFESSIONAL só enxerga o próprio escopo por padrão", () => {
    const professional = active("PROFESSIONAL", { professionalId: "p1" });
    assert.ok(can(professional, "appointments.read.own"));
    assert.ok(can(professional, "schedule.write.own"));
    assert.equal(can(professional, "appointments.read.all"), false);
    assert.equal(can(professional, "schedule.read.all"), false);
    assert.equal(can(professional, "customers.read"), false);
    assert.equal(can(professional, "customers.notes.read"), false);
    assert.equal(can(professional, "reports.basic.read"), false);
  });
});

describe("vínculo inativo", () => {
  test("convite pendente não carrega permissão", () => {
    assert.equal(permissionsFor({ role: "OWNER", status: "INVITED" }).size, 0);
  });

  test("acesso suspenso não carrega permissão, nem sendo dono", () => {
    const suspended = { role: "OWNER", status: "SUSPENDED" };
    assert.equal(permissionsFor(suspended).size, 0);
    assert.equal(can(suspended, "barbershop.settings.read"), false);
  });
});

describe("concessões extras ao profissional", () => {
  test("dono pode liberar visão da agenda da equipe", () => {
    const professional = active("PROFESSIONAL", {
      professionalId: "p1",
      extraPermissions: ["appointments.read.all", "schedule.read.all"],
    });
    assert.ok(can(professional, "appointments.read.all"));
    assert.ok(can(professional, "schedule.read.all"));
  });

  test("concessão fora da lista permitida é ignorada", () => {
    const professional = active("PROFESSIONAL", {
      professionalId: "p1",
      extraPermissions: [
        "barbershop.billing.write",
        "services.write",
        "members.write",
        "appointments.write.all",
      ],
    });
    assert.equal(can(professional, "barbershop.billing.write"), false);
    assert.equal(can(professional, "services.write"), false);
    assert.equal(can(professional, "members.write"), false);
    assert.equal(can(professional, "appointments.write.all"), false);
  });

  test("permissão inexistente não quebra nem concede nada", () => {
    const professional = active("PROFESSIONAL", {
      professionalId: "p1",
      extraPermissions: ["nao.existe", "customers.read"],
    });
    assert.ok(can(professional, "customers.read"));
    assert.equal(permissionsFor(professional).has("nao.existe"), false);
  });

  test("extras não se aplicam a outros papéis", () => {
    const reception = active("RECEPTIONIST", {
      extraPermissions: ["reports.advanced.read"],
    });
    assert.equal(can(reception, "reports.advanced.read"), false);
  });
});

describe("escopo por profissional", () => {
  const professional = active("PROFESSIONAL", { professionalId: "p1" });
  const reception = active("RECEPTIONIST");

  test("barbeiro age na própria agenda", () => {
    assert.ok(canActOnProfessional(professional, "appointments.write", "p1"));
    assert.ok(canActOnProfessional(professional, "schedule.write", "p1"));
  });

  test("barbeiro não age na agenda de outro", () => {
    assert.equal(canActOnProfessional(professional, "appointments.write", "p2"), false);
    assert.equal(canActOnProfessional(professional, "appointments.read", "p2"), false);
    assert.equal(canActOnProfessional(professional, "schedule.write", "p2"), false);
  });

  test("visão liberada permite ler a agenda alheia, não escrever", () => {
    const withRead = active("PROFESSIONAL", {
      professionalId: "p1",
      extraPermissions: ["appointments.read.all"],
    });
    assert.ok(canActOnProfessional(withRead, "appointments.read", "p2"));
    assert.equal(canActOnProfessional(withRead, "appointments.write", "p2"), false);
  });

  test("recepção age na agenda de qualquer profissional", () => {
    assert.ok(canActOnProfessional(reception, "appointments.write", "p9"));
  });

  test("barbeiro sem ficha vinculada não age em ninguém", () => {
    const orphan = active("PROFESSIONAL", { professionalId: null });
    assert.equal(canActOnProfessional(orphan, "appointments.write", "p1"), false);
  });

  test("integração: barbeiro conecta só o próprio calendário", () => {
    assert.ok(canActOnProfessional(professional, "integrations.write", "p1"));
    assert.equal(canActOnProfessional(professional, "integrations.write", "p2"), false);
  });

  test("integração: dono conecta o calendário de qualquer um", () => {
    assert.ok(canActOnProfessional(active("OWNER"), "integrations.write", "p2"));
  });

  test("integração: recepção não conecta nada", () => {
    assert.equal(canActOnProfessional(reception, "integrations.write", "p1"), false);
  });
});

describe("assertCan", () => {
  test("lança ForbiddenError nomeando a permissão", () => {
    assert.throws(
      () => assertCan(active("RECEPTIONIST"), "services.write"),
      (error) => error instanceof ForbiddenError && error.permission === "services.write"
    );
  });

  test("não lança quando permitido", () => {
    assert.doesNotThrow(() => assertCan(active("OWNER"), "services.write"));
  });
});
