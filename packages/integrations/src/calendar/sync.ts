// Projeção do agendamento no calendário externo.
//
// A regra que organiza tudo aqui: **a reserva nunca depende disto**. O
// agendamento já foi gravado e confirmado numa transação própria; o que roda
// nesta camada é uma projeção para fora. Se o Google estiver fora do ar, a
// barbearia continua com a agenda correta e o cliente com a reserva válida.
//
// A sincronização é *convergente*, não um replay de histórico: ela lê o estado
// atual do agendamento e faz o calendário refletir esse estado. Isso importa
// porque o outbox entrega ao menos uma vez e sem ordem garantida — um
// "confirmado" reentregue depois de um cancelamento não pode ressuscitar o
// evento. Como o alvo é sempre o estado atual, reprocessar em qualquer ordem
// leva ao mesmo lugar.
//
// Idempotência do evento em si: `appointment_calendar_syncs` guarda o
// `external_event_id` por (agendamento, conexão). Reprocessar atualiza o evento
// que já existe em vez de criar um segundo — que é o que a Parte 3 §11 exige ao
// dizer que reconexão não pode duplicar evento.

import { prisma } from "@barber/db";
import { decryptSecret, encryptSecret, instantToLocalDate, instantToLocalTime } from "@barber/domain";
import { CalendarError, calendarProvider, type CalendarCredentials } from "./provider.ts";

/// Status que ocupam a agenda e portanto devem aparecer no calendário externo.
/// Concluído e falta continuam lá: aconteceram, e apagar reescreveria o passado
/// do profissional.
const PRESENTES = new Set(["CONFIRMED", "COMPLETED", "NO_SHOW"]);

export interface SyncCalendarPayload {
  appointmentId: string;
}

function encryptionKey(): string {
  return process.env.ENCRYPTION_KEY ?? "";
}

function readCredentials(payload: string): CalendarCredentials {
  const dados = JSON.parse(decryptSecret(payload, encryptionKey())) as {
    accessToken: string;
    refreshToken: string;
    expiresAt: string | null;
  };
  return {
    accessToken: dados.accessToken,
    refreshToken: dados.refreshToken,
    expiresAt: dados.expiresAt ? new Date(dados.expiresAt) : null,
  };
}

export function writeCredentials(credentials: CalendarCredentials): string {
  return encryptSecret(
    JSON.stringify({
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt: credentials.expiresAt?.toISOString() ?? null,
    }),
    encryptionKey()
  );
}

/// Marca a conexão como revogada e registra o motivo para o painel.
///
/// Não apaga a conexão: o dono precisa ver o que aconteceu e reconectar, e
/// sumir em silêncio faria a integração desaparecer sem explicação.
async function markRevoked(connectionId: string, message: string): Promise<void> {
  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: {
      status: "ERROR",
      lastErrorCode: "REVOKED",
      lastErrorAt: new Date(),
      // A credencial não vale mais nada e não pode ficar guardada
      credentialsEncrypted: null,
      tokenExpiresAt: null,
    },
  });
  console.error(`[calendar] conexão ${connectionId} revogada: ${message}`);
}

/// Sincroniza um agendamento com o calendário do profissional.
///
/// Lança **apenas** em falha transitória, para que o outbox faça a retentativa.
/// Falha permanente é registrada e encerrada: insistir só gastaria tentativa e
/// atrasaria o aviso ao dono.
export async function syncAppointmentToCalendar(payload: SyncCalendarPayload): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: payload.appointmentId },
    include: { barbershop: true },
  });

  // Agendamento apagado entre o enfileiramento e o processamento não é erro
  if (!appointment) return;

  const connection = await prisma.integrationConnection.findFirst({
    where: {
      barbershopId: appointment.barbershopId,
      professionalId: appointment.professionalId,
      provider: "GOOGLE_CALENDAR",
      status: { in: ["CONNECTED", "UNSTABLE"] },
    },
  });

  // Sem conexão ativa não há o que sincronizar — e isso é normal: a integração
  // é opcional, por profissional.
  if (!connection?.credentialsEncrypted) return;

  const registro = await prisma.appointmentCalendarSync.findUnique({
    where: {
      appointmentId_connectionId: {
        appointmentId: appointment.id,
        connectionId: connection.id,
      },
    },
  });

  const deveExistir = PRESENTES.has(appointment.status);
  const eventoParaRemover = deveExistir ? null : (registro?.externalEventId ?? null);

  // Nada a fazer: já está fora do calendário e deve continuar fora. Evita
  // gastar chamada de rede a cada reentrega de um cancelamento antigo.
  if (!deveExistir && !eventoParaRemover) return;

  let credentials: CalendarCredentials;
  try {
    credentials = readCredentials(connection.credentialsEncrypted);
  } catch {
    // Credencial ilegível (chave trocada, conteúdo adulterado): insistir não
    // resolve, e o dono precisa reconectar.
    await markRevoked(connection.id, "credencial ilegível");
    return;
  }

  const provider = calendarProvider();

  try {
    const renovada = await provider.refreshCredentials(credentials);
    if (renovada) {
      credentials = renovada;
      await prisma.integrationConnection.update({
        where: { id: connection.id },
        data: {
          credentialsEncrypted: writeCredentials(renovada),
          tokenExpiresAt: renovada.expiresAt,
        },
      });
    }

    if (deveExistir) {
      const timeZone = appointment.barbershop.timezone;
      const dia = instantToLocalDate(appointment.startsAt, timeZone);
      const hora = instantToLocalTime(appointment.startsAt, timeZone);

      const externalEventId = await provider.upsertEvent(credentials, {
        externalEventId: registro?.externalEventId,
        summary: `${appointment.serviceNameSnapshot} — ${appointment.customerNameSnapshot}`,
        // Sem telefone do cliente: o evento vai para um calendário que pode
        // estar compartilhado, e o dado não é necessário lá.
        description: `Agendamento em ${appointment.barbershop.name}. ${dia} às ${hora}.`,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        timeZone,
      });

      await gravarRegistro(appointment.barbershopId, appointment.id, connection.id, {
        externalEventId,
        status: "SYNCED",
        lastError: null,
        lastSyncedAt: new Date(),
      });
    } else if (eventoParaRemover) {
      await provider.deleteEvent(credentials, eventoParaRemover);
      await gravarRegistro(appointment.barbershopId, appointment.id, connection.id, {
        externalEventId: null,
        status: "DELETED",
        lastError: null,
        lastSyncedAt: new Date(),
      });
    }

    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: "CONNECTED",
        lastSyncAt: new Date(),
        lastErrorCode: null,
        lastErrorAt: null,
      },
    });
  } catch (error) {
    // Erro desconhecido é tratado como transitório: preferimos tentar de novo a
    // desistir de um evento por causa de uma falha que não soubemos classificar.
    const falha =
      error instanceof CalendarError
        ? error
        : new CalendarError((error as Error).message, "TRANSIENT");

    if (falha.code === "REVOKED") {
      await markRevoked(connection.id, falha.message);
      return; // não relançar: retentativa não reverte revogação
    }

    await gravarRegistro(appointment.barbershopId, appointment.id, connection.id, {
      status: "FAILED",
      lastError: falha.message,
    });

    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        // "Instável" e não "erro": o dono vê que algo falhou sem achar que
        // precisa reconectar por causa de uma queda passageira.
        status: falha.isRetryable ? "UNSTABLE" : "ERROR",
        lastErrorCode: falha.code,
        lastErrorAt: new Date(),
      },
    });

    // Só falha transitória volta para a fila; permanente já está registrada
    if (falha.isRetryable) throw falha;
  }
}

/// Grava o estado da projeção sem apagar o `external_event_id` quando a
/// atualização não o menciona — perder esse id criaria um evento duplicado na
/// próxima tentativa.
async function gravarRegistro(
  barbershopId: string,
  appointmentId: string,
  connectionId: string,
  dados: {
    externalEventId?: string | null;
    status: "SYNCED" | "FAILED" | "DELETED";
    lastError?: string | null;
    lastSyncedAt?: Date;
  }
): Promise<void> {
  await prisma.appointmentCalendarSync.upsert({
    where: { appointmentId_connectionId: { appointmentId, connectionId } },
    update: dados,
    create: { barbershopId, appointmentId, connectionId, ...dados },
  });
}

/// Remarcação: o agendamento antigo vira `RESCHEDULED` e o novo nasce
/// `CONFIRMED`. Sincronizar os dois é o que tira o horário velho do calendário
/// e coloca o novo — nesta ordem, para o profissional nunca ver os dois juntos.
export async function syncRescheduledAppointment(payload: {
  appointmentId: string;
  previousAppointmentId?: string | null;
}): Promise<void> {
  if (payload.previousAppointmentId) {
    await syncAppointmentToCalendar({ appointmentId: payload.previousAppointmentId });
  }
  await syncAppointmentToCalendar({ appointmentId: payload.appointmentId });
}

/// Reconciliação (Parte 2 §11): encontra agendamentos futuros que deveriam
/// estar no calendário e não estão, e os reenfileira.
///
/// Existe porque entrega ao menos uma vez não é garantia de sucesso: um evento
/// pode ter esgotado as tentativas enquanto o Google estava fora, e ninguém
/// perceberia sem alguém conferindo. É também o que faz uma reconexão trazer de
/// volta tudo que aconteceu enquanto a integração estava desligada.
export async function reconcileCalendar(limit = 100): Promise<number> {
  const conexoes = await prisma.integrationConnection.findMany({
    where: {
      provider: "GOOGLE_CALENDAR",
      status: { in: ["CONNECTED", "UNSTABLE"] },
      credentialsEncrypted: { not: null },
      professionalId: { not: null },
    },
    select: { id: true, barbershopId: true, professionalId: true },
  });

  let reenfileirados = 0;

  for (const conexao of conexoes) {
    const pendentes = await prisma.appointment.findMany({
      where: {
        barbershopId: conexao.barbershopId,
        professionalId: conexao.professionalId!,
        status: "CONFIRMED",
        startsAt: { gte: new Date() },
        OR: [
          { calendarSyncs: { none: { connectionId: conexao.id } } },
          {
            calendarSyncs: {
              some: { connectionId: conexao.id, status: { in: ["FAILED", "PENDING", "DELETED"] } },
            },
          },
        ],
      },
      select: { id: true },
      take: limit,
      orderBy: { startsAt: "asc" },
    });

    for (const appointment of pendentes) {
      // Um evento pendente para o mesmo agendamento já resolve: enfileirar
      // outro só multiplicaria trabalho, já que a sincronização é convergente.
      const jaNaFila = await prisma.outboxEvent.count({
        where: {
          type: "SYNC_CALENDAR",
          status: { in: ["PENDING", "PROCESSING"] },
          payload: { equals: { appointmentId: appointment.id } },
        },
      });
      if (jaNaFila > 0) continue;

      await prisma.outboxEvent.create({
        data: {
          barbershopId: conexao.barbershopId,
          type: "SYNC_CALENDAR",
          payload: { appointmentId: appointment.id },
        },
      });
      reenfileirados++;
    }
  }

  return reenfileirados;
}
