// Contratos das rotas públicas (Parte 2 §8). O front nunca replica regra
// crítica: disponibilidade, elegibilidade e preço vêm sempre do servidor.

import { z } from "zod";
import {
  e164Phone,
  idempotencyKey,
  instant,
  localDate,
  localTime,
  opaqueToken,
  uuid,
} from "./common.js";

// --- GET /public/shops/{slug} ----------------------------------------------

export const publicShopResponse = z.object({
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  phone: z.string().nullable(),
  address: z
    .object({
      street: z.string().optional(),
      number: z.string().optional(),
      complement: z.string().optional(),
      district: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
    })
    .nullable(),
  branding: z.object({
    logoUrl: z.string().url().nullable(),
    primaryColor: z.string().nullable(),
  }),
  cancellationPolicy: z.string().nullable(),
  /// O cliente precisa saber a regra antes de reservar
  bookingWindowDays: z.number().int(),
  minimumNoticeMinutes: z.number().int(),
});

// --- GET /public/shops/{slug}/services --------------------------------------

export const publicServiceItem = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  priceMinor: z.number().int(),
  durationMinutes: z.number().int(),
});

export const publicServicesResponse = z.object({
  services: z.array(publicServiceItem),
});

// --- GET /public/shops/{slug}/professionals ---------------------------------

export const publicProfessionalItem = z.object({
  id: uuid,
  displayName: z.string(),
  bio: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  /// Serviços que este profissional realiza, já com preço/duração efetivos
  /// quando ele cobra diferente do padrão da casa
  services: z.array(
    z.object({
      serviceId: uuid,
      priceMinor: z.number().int(),
      durationMinutes: z.number().int(),
    })
  ),
});

export const publicProfessionalsResponse = z.object({
  professionals: z.array(publicProfessionalItem),
});

// --- GET /public/shops/{slug}/availability ----------------------------------

export const availabilityQuery = z.object({
  serviceId: uuid,
  /// Ausente = "qualquer profissional": o servidor resolve de forma
  /// determinística por booking_priority (Parte 1 §12)
  professionalId: uuid.optional(),
  from: localDate,
  to: localDate,
});

export const availabilitySlot = z.object({
  startsAt: instant,
  endsAt: instant,
  /// Sempre concreto: mesmo em "qualquer profissional", o slot já vem
  /// atribuído, porque o hold exige profissional definido
  professionalId: uuid,
  professionalName: z.string(),
  priceMinor: z.number().int(),
});

export const availabilityResponse = z.object({
  timezone: z.string(),
  days: z.array(
    z.object({
      date: localDate,
      slots: z.array(availabilitySlot),
    })
  ),
});

// --- POST /public/shops/{slug}/holds ----------------------------------------

export const createHoldRequest = z.object({
  serviceId: uuid,
  professionalId: uuid,
  startsAt: instant,
});

export const createHoldResponse = z.object({
  /// Token opaco do hold; volta na confirmação
  holdToken: opaqueToken,
  startsAt: instant,
  endsAt: instant,
  professionalId: uuid,
  /// A UI mostra a contagem regressiva a partir daqui (Parte 1 §8)
  expiresAt: instant,
});

// --- POST /public/shops/{slug}/appointments ---------------------------------

export const createAppointmentRequest = z.object({
  holdToken: opaqueToken,
  customerName: z.string().trim().min(2).max(120),
  customerPhone: e164Phone,
  /// Aceite dos termos essenciais — obrigatório, base operacional
  acceptedTermsVersion: z.string(),
  /// Consentimento promocional: separado, opcional e nunca inferido do
  /// agendamento (Parte 2 §5.3). Ausente = não consentiu.
  marketingConsent: z
    .object({
      channels: z.array(z.enum(["WHATSAPP", "SMS", "EMAIL"])).min(1),
      textVersion: z.string(),
    })
    .optional(),
});

export const appointmentSummary = z.object({
  startsAt: instant,
  endsAt: instant,
  timezone: z.string(),
  serviceName: z.string(),
  professionalName: z.string(),
  customerName: z.string(),
  priceMinor: z.number().int(),
  status: z.enum([
    "CONFIRMED",
    "CANCELLED_BY_CUSTOMER",
    "CANCELLED_BY_SHOP",
    "COMPLETED",
    "NO_SHOW",
    "RESCHEDULED",
  ]),
});

export const createAppointmentResponse = z.object({
  appointment: appointmentSummary,
  /// URL de /a/{token} — único lugar onde o token cru existe
  manageUrl: z.string().url(),
  /// Mensagem pronta para envio manual; o envio é sempre do usuário
  /// (Parte 1 §17.1), nunca automático pela plataforma
  whatsappShareUrl: z.string().url().nullable(),
  calendarUrl: z.string().url().nullable(),
});

/// Quando o slot é perdido durante o fluxo, a resposta traz alternativas
/// próximas em vez de só recusar (Parte 1 §8).
export const slotUnavailableResponse = z.object({
  error: z.object({
    code: z.literal("SLOT_UNAVAILABLE"),
    message: z.string(),
    details: z.object({
      nearestSlots: z.array(availabilitySlot),
    }),
  }),
});

// --- Gestão por token: /public/appointments/{token} -------------------------

export const manageAppointmentResponse = z.object({
  appointment: appointmentSummary,
  shop: z.object({
    name: z.string(),
    slug: z.string(),
    phone: z.string().nullable(),
    cancellationPolicy: z.string().nullable(),
  }),
  /// O servidor decide o que ainda é permitido; a UI só reflete
  /// (escrita só enquanto CONFIRMED — decisão #14)
  permissions: z.object({
    canCancel: z.boolean(),
    canReschedule: z.boolean(),
    /// Motivo quando bloqueado: já passou, fora da antecedência mínima, etc.
    blockedReason: z.string().nullable(),
  }),
});

export const cancelAppointmentRequest = z.object({
  reason: z.string().max(500).optional(),
});

export const rescheduleAppointmentRequest = z.object({
  /// Reservar o novo slot e liberar o anterior é uma operação só (Parte 1 §9)
  holdToken: opaqueToken,
});

export const rescheduleAppointmentResponse = z.object({
  appointment: appointmentSummary,
  /// Remarcar emite novo token e invalida o anterior
  manageUrl: z.string().url(),
});

// --- POST /public/waitlist ---------------------------------------------------

export const createWaitlistRequest = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerPhone: e164Phone,
  serviceId: uuid.optional(),
  professionalId: uuid.optional(),
  dateFrom: localDate.optional(),
  dateTo: localDate.optional(),
  timeRangeStart: localTime.optional(),
  timeRangeEnd: localTime.optional(),
  acceptedTermsVersion: z.string(),
  /// Entrar na fila implica ser contatado sobre ESTA fila — finalidade
  /// operacional, distinta de marketing
  contactConsentTextVersion: z.string(),
});

export const createWaitlistResponse = z.object({
  id: uuid,
  status: z.literal("WAITING"),
});

// --- Vaga da Agenda Inteligente: /public/vacancies/{token} ------------------

export const vacancyResponse = z.object({
  shop: z.object({ name: z.string(), slug: z.string(), timezone: z.string() }),
  /// A janela oferecida é exclusivamente esta (Parte 1 §13.3)
  startsAt: instant,
  endsAt: instant,
  professionalName: z.string(),
  /// Só os serviços que cabem na janela
  services: z.array(publicServiceItem),
  expiresAt: instant,
  /// Vira false assim que alguém confirma — primeiro a reservar leva
  available: z.boolean(),
});

/// Abrir o link não reserva nada; o hold nasce só aqui, quando a pessoa
/// avança para confirmar (docs/tech-review-part2.md §3.5).
export const claimVacancyRequest = z.object({
  serviceId: uuid,
  customerName: z.string().trim().min(2).max(120),
  customerPhone: e164Phone,
  acceptedTermsVersion: z.string(),
});

// --- Cabeçalhos exigidos -----------------------------------------------------

export const mutatingHeaders = z.object({
  "idempotency-key": idempotencyKey,
});

export type PublicShopResponse = z.infer<typeof publicShopResponse>;
export type AvailabilityResponse = z.infer<typeof availabilityResponse>;
export type CreateHoldResponse = z.infer<typeof createHoldResponse>;
export type CreateAppointmentRequest = z.infer<typeof createAppointmentRequest>;
export type CreateAppointmentResponse = z.infer<typeof createAppointmentResponse>;
export type ManageAppointmentResponse = z.infer<typeof manageAppointmentResponse>;
export type VacancyResponse = z.infer<typeof vacancyResponse>;
