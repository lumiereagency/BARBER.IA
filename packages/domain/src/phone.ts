// Normalização de telefone para E.164.
//
// É a chave de deduplicação da relação com a barbearia: sem normalizar,
// "(11) 99999-0000" e "+5511999990000" viram dois clientes distintos e o CRM
// nasce errado (docs/tech-review-part2.md §2.1).
//
// Escopo deliberado: Brasil como padrão. Números já em formato internacional
// são aceitos como estão. Se o produto sair do Brasil, este é o ponto único a
// trocar por uma biblioteca de parsing completa.

const BR_COUNTRY_CODE = "55";

export class InvalidPhoneError extends Error {
  constructor(public readonly input: string) {
    super("Telefone inválido");
    this.name = "InvalidPhoneError";
  }
}

/// Aceita "11999990000", "(11) 99999-0000", "+55 11 99999-0000" e devolve
/// "+5511999990000".
export function normalizePhoneBR(raw: string): string {
  const trimmed = raw.trim();
  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 0) throw new InvalidPhoneError(raw);

  // Já veio internacional
  if (hadPlus) {
    if (digits.length < 8 || digits.length > 15) throw new InvalidPhoneError(raw);
    return `+${digits}`;
  }

  // Com código do país, sem o "+"
  if (digits.startsWith(BR_COUNTRY_CODE) && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }

  // Nacional com DDD: 10 dígitos (fixo) ou 11 (celular)
  if (digits.length === 10 || digits.length === 11) {
    const areaCode = Number(digits.slice(0, 2));
    // DDD brasileiro válido vai de 11 a 99
    if (areaCode < 11) throw new InvalidPhoneError(raw);
    return `+${BR_COUNTRY_CODE}${digits}`;
  }

  throw new InvalidPhoneError(raw);
}

/// Formato de exibição para o dono e para o cliente: "(11) 99999-0000".
export function formatPhoneBR(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (!digits.startsWith(BR_COUNTRY_CODE)) return e164;

  const national = digits.slice(2);
  if (national.length === 11) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  }
  if (national.length === 10) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  }
  return e164;
}
