// Leitura e validação das variáveis de ambiente (Parte 2 §18).
// Preenchido na próxima etapa, junto com o carregamento tipado do .env.

/// Nome do produto (Parte 4 §2: nunca hardcoded pelo código — um lugar só).
/// Decidido em 2026-09-04: "Cutlist". A grafia em title case segue a regra do
/// §5 contra caixa alta pesada como padrão; o valor pode ser sobrescrito por
/// ambiente enquanto a marca não está registrada em definitivo.
export const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Cutlist";
