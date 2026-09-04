"use server";

import { requirePermission } from "@/lib/auth";
import { generateShareLink } from "@/lib/smart-opportunity";

export async function gerarLinkVaga(
  opportunityId: string
): Promise<{ shareUrl: string } | { error: string }> {
  const session = await requirePermission("smart_agenda.act");

  try {
    return await generateShareLink(session.barbershopId, opportunityId);
  } catch (error) {
    return { error: (error as Error).message };
  }
}
