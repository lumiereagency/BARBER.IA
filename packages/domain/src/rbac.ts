// Matriz de permissões da equipe (docs/delivery-part3.md §7).
//
// A autorização é sempre decidida no servidor: a UI apenas reflete o que esta
// matriz responde. Nenhuma tela pode ser a única barreira de acesso.
//
// Escopo: este módulo responde "este papel pode esta ação nesta barbearia?".
// Ele não resolve qual barbearia é — isso vem da sessão ou da rota pública,
// nunca de parâmetro enviado pelo cliente (Parte 2 §3).

export const PERMISSIONS = [
  "barbershop.settings.read",
  "barbershop.settings.write",
  "barbershop.billing.read",
  "barbershop.billing.write",
  "barbershop.transfer_or_close",
  "members.read",
  "members.write",
  "professionals.read",
  "professionals.write",
  "services.read",
  "services.write",
  "schedule.read.all",
  "schedule.read.own",
  "schedule.write.all",
  "schedule.write.own",
  "appointments.read.all",
  "appointments.read.own",
  "appointments.write.all",
  "appointments.write.own",
  "customers.read",
  "customers.write",
  "customers.notes.read",
  "promotions.read",
  "promotions.write",
  "reports.basic.read",
  "reports.advanced.read",
  "smart_agenda.read",
  "smart_agenda.act",
  "waitlist.read",
  "waitlist.act",
  "integrations.read",
  "integrations.write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type MembershipRole = "OWNER" | "ADMIN" | "RECEPTIONIST" | "PROFESSIONAL";

/// Permissões que o dono pode conceder caso a caso a um profissional
/// (Parte 1 §4.3: "conforme permissões"). O padrão do barbeiro é ver apenas a
/// própria agenda; nem toda permissão é concedível dessa forma — dinheiro,
/// configuração e equipe nunca são.
export const GRANTABLE_TO_PROFESSIONAL: readonly Permission[] = [
  "schedule.read.all",
  "appointments.read.all",
  "customers.read",
  "smart_agenda.read",
  "smart_agenda.act",
];

const OWNER_PERMISSIONS: readonly Permission[] = PERMISSIONS;

const ADMIN_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (permission) =>
    permission !== "barbershop.billing.read" &&
    permission !== "barbershop.billing.write" &&
    permission !== "barbershop.transfer_or_close"
);

/// Parte 1 §4.4: recepção cria e gerencia agendamentos, clientes e agenda da
/// equipe, mas não mexe em assinatura nem em configuração sensível.
const RECEPTIONIST_PERMISSIONS: readonly Permission[] = [
  "barbershop.settings.read",
  "professionals.read",
  "services.read",
  "schedule.read.all",
  "schedule.read.own",
  "schedule.write.all",
  "schedule.write.own",
  "appointments.read.all",
  "appointments.read.own",
  "appointments.write.all",
  "appointments.write.own",
  "customers.read",
  "customers.write",
  "customers.notes.read",
  "promotions.read",
  "reports.basic.read",
  "smart_agenda.read",
  "smart_agenda.act",
  "waitlist.read",
  "waitlist.act",
  "integrations.read",
];

/// Parte 1 §4.3: o barbeiro vê e gerencia a própria agenda. Pode bloquear
/// período, concluir atendimento e registrar no-show — tudo restrito ao que é
/// dele.
const PROFESSIONAL_PERMISSIONS: readonly Permission[] = [
  "barbershop.settings.read",
  "professionals.read",
  "services.read",
  "schedule.read.own",
  "schedule.write.own",
  "appointments.read.own",
  "appointments.write.own",
  "promotions.read",
  "integrations.read",
  /// Apenas a própria conexão de calendário; o escopo é verificado em
  /// canActOnProfessional, não aqui.
  "integrations.write",
];

const ROLE_PERMISSIONS: Record<MembershipRole, readonly Permission[]> = {
  OWNER: OWNER_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  RECEPTIONIST: RECEPTIONIST_PERMISSIONS,
  PROFESSIONAL: PROFESSIONAL_PERMISSIONS,
};

export interface Membership {
  role: MembershipRole;
  status: "INVITED" | "ACTIVE" | "SUSPENDED";
  /// Ficha de profissional vinculada, quando o membro atende clientes
  professionalId?: string | null;
  /// Concessões extras gravadas em barbershop_memberships.permissions
  extraPermissions?: readonly string[] | null;
}

function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/// Concessões extras só valem para PROFESSIONAL e só dentro da lista
/// concedível — assim um override mal escrito não vira escalada de privilégio.
function grantedExtras(membership: Membership): readonly Permission[] {
  if (membership.role !== "PROFESSIONAL" || !membership.extraPermissions) return [];
  return membership.extraPermissions
    .filter(isPermission)
    .filter((permission) => GRANTABLE_TO_PROFESSIONAL.includes(permission));
}

export function permissionsFor(membership: Membership): ReadonlySet<Permission> {
  // Vínculo que não está ativo não carrega permissão alguma: convite pendente
  // e acesso suspenso são exatamente iguais a não ter acesso.
  if (membership.status !== "ACTIVE") return new Set();
  return new Set([...ROLE_PERMISSIONS[membership.role], ...grantedExtras(membership)]);
}

export function can(membership: Membership, permission: Permission): boolean {
  return permissionsFor(membership).has(permission);
}

/// Resolve o par ".all" / ".own": quem tem o escopo amplo age sobre qualquer
/// profissional; quem só tem o próprio age apenas sobre a própria ficha.
export function canActOnProfessional(
  membership: Membership,
  action: "schedule.read" | "schedule.write" | "appointments.read" | "appointments.write" | "integrations.write",
  targetProfessionalId: string
): boolean {
  if (action === "integrations.write") {
    if (!can(membership, "integrations.write")) return false;
    // Dono e admin conectam o calendário de qualquer profissional; o barbeiro
    // conecta apenas o dele.
    if (membership.role === "OWNER" || membership.role === "ADMIN") return true;
    return membership.professionalId === targetProfessionalId;
  }

  if (can(membership, `${action}.all` as Permission)) return true;
  if (!can(membership, `${action}.own` as Permission)) return false;
  return membership.professionalId != null && membership.professionalId === targetProfessionalId;
}

export function assertCan(membership: Membership, permission: Permission): void {
  if (!can(membership, permission)) {
    throw new ForbiddenError(permission);
  }
}

export class ForbiddenError extends Error {
  constructor(public readonly permission: string) {
    super(`Permissão negada: ${permission}`);
    this.name = "ForbiddenError";
  }
}
