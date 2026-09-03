// Slug da página pública (/b/{slug}).
//
// É parte do endereço que a barbearia vai divulgar, então precisa ser legível,
// estável e sem acento — e não pode colidir com as rotas da própria plataforma.

const RESERVED = new Set([
  "a",
  "admin",
  "api",
  "b",
  "entrar",
  "sair",
  "criar-conta",
  "hoje",
  "agenda",
  "clientes",
  "equipe",
  "gestao",
  "minha-conta",
  "vaga",
  "espera",
  "_next",
  "static",
]);

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tira acento
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$/.test(slug) && !isReservedSlug(slug);
}

/// Gera a próxima tentativa quando o slug já existe: "barbearia-do-ze",
/// "barbearia-do-ze-2", "barbearia-do-ze-3"...
export function nextSlugCandidate(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  return `${base.slice(0, 60 - suffix.length)}${suffix}`;
}
