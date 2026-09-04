"use server";

// Ações da tela de Clientes.
//
// Nota é dado sensível (Parte 3 §13: "Acesso restrito por papel; nunca
// exposto em endpoint público") — por isso a escrita exige customers.write e
// revalida a posse do registro pela barbearia da sessão antes de tocar nele,
// nunca aceita o id da URL como prova de nada.

import { revalidatePath } from "next/cache";
import { prisma } from "@barber/db";
import { requirePermission } from "@/lib/auth";

export async function saveCustomerNotes(formData: FormData): Promise<void> {
  const session = await requirePermission("customers.write");
  const id = String(formData.get("id") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();

  const relation = await prisma.barbershopCustomer.findFirst({
    where: { id, barbershopId: session.barbershopId },
    select: { id: true },
  });
  if (!relation) return;

  await prisma.barbershopCustomer.update({
    where: { id: relation.id },
    data: { notes: notes || null },
  });

  revalidatePath(`/clientes/${id}`);
}
