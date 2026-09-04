-- Semente dos dois planos do produto (Parte 1 §2). Preço é placeholder
-- explícito — a decisão de precificação real ainda não foi tomada (ver
-- docs/status.md §3); trocar depois é um UPDATE, não uma migração de schema.
-- `limits` fica vazio de propósito: limites numéricos por plano são a
-- decisão #6 pendente em docs/status.md, e um limite inventado seria pior do
-- que nenhum limite.
INSERT INTO "plans" ("id", "code", "name", "price_minor", "currency", "features", "limits", "active", "updated_at")
VALUES
  (
    gen_random_uuid(),
    'essential',
    'Essencial',
    4990,
    'BRL',
    '{"smartAgenda": false, "waitlist": false, "advancedReports": false, "baileys": false}',
    '{}',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'pro',
    'Pro',
    9990,
    'BRL',
    '{"smartAgenda": true, "waitlist": true, "advancedReports": true, "baileys": true}',
    '{}',
    true,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO NOTHING;
