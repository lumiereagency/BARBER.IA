// Criação de conta e da barbearia.
//
// O proprietário precisa concluir isto sozinho, sem suporte técnico
// (Parte 3 §11). Por isso: slug sugerido a partir do nome e resolvido
// automaticamente quando já existe, fuso obrigatório com padrão razoável, e
// nenhum passo que exija entender o modelo de dados.

import { prisma } from "@barber/db";
import {
  WeakPasswordError,
  hashPassword,
  isValidSlug,
  nextSlugCandidate,
  slugify,
} from "@barber/domain";

export class EmailAlreadyUsedError extends Error {
  constructor() {
    super("Já existe uma conta com este e-mail");
    this.name = "EmailAlreadyUsedError";
  }
}

export class InvalidSlugError extends Error {
  constructor(message = "Endereço da página inválido") {
    super(message);
    this.name = "InvalidSlugError";
  }
}

export { WeakPasswordError };

export interface SignUpInput {
  ownerName: string;
  email: string;
  password: string;
  barbershopName: string;
  timezone: string;
  desiredSlug?: string;
}

export interface SignUpResult {
  userId: string;
  barbershopId: string;
  slug: string;
}

/// Slug livre a partir de uma base. A corrida com outro cadastro simultâneo é
/// resolvida pela constraint de unicidade, não por esta consulta — aqui só
/// buscamos um bom candidato.
async function findFreeSlug(base: string): Promise<string> {
  for (let attempt = 1; attempt <= 50; attempt++) {
    const candidate = nextSlugCandidate(base, attempt);
    if (!isValidSlug(candidate)) continue;
    const taken = await prisma.barbershop.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  throw new InvalidSlugError("Não foi possível gerar um endereço para esta página");
}

export async function signUpOwner(input: SignUpInput): Promise<SignUpResult> {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new EmailAlreadyUsedError();

  // Fuso é obrigatório: sem ele a agenda não tem como existir (Parte 3 §11)
  if (!input.timezone) throw new Error("Fuso horário é obrigatório");
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: input.timezone });
  } catch {
    throw new Error("Fuso horário inválido");
  }

  const base = slugify(input.desiredSlug || input.barbershopName);
  if (!base) throw new InvalidSlugError();
  if (input.desiredSlug && !isValidSlug(base)) throw new InvalidSlugError();

  const slug = await findFreeSlug(base);
  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: input.ownerName.trim(), email, passwordHash },
      });

      const barbershop = await tx.barbershop.create({
        data: {
          name: input.barbershopName.trim(),
          slug,
          timezone: input.timezone,
        },
      });

      await tx.barbershopMembership.create({
        data: {
          barbershopId: barbershop.id,
          userId: user.id,
          role: "OWNER",
          status: "ACTIVE",
        },
      });

      await tx.auditLog.create({
        data: {
          barbershopId: barbershop.id,
          actorType: "STAFF",
          actorId: user.id,
          action: "barbershop.created",
          targetType: "barbershop",
          targetId: barbershop.id,
        },
      });

      return { userId: user.id, barbershopId: barbershop.id, slug: barbershop.slug };
    });
  } catch (error) {
    // Dois cadastros simultâneos com o mesmo e-mail ou slug: quem decide é a
    // constraint, e a mensagem precisa ser humana.
    if ((error as { code?: string }).code === "P2002") {
      const target = (error as { meta?: { target?: string[] } }).meta?.target ?? [];
      if (target.includes("email")) throw new EmailAlreadyUsedError();
      throw new InvalidSlugError("Este endereço de página acabou de ser usado. Tente outro.");
    }
    throw error;
  }
}
