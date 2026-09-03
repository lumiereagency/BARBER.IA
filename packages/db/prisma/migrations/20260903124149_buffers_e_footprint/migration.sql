-- Buffers garantidos pelo banco, não só pelo motor de disponibilidade.
--
-- Problema: os buffers de preparo e limpeza (Parte 2 §5.2) não podiam entrar na
-- constraint de exclusão, porque `timestamptz ± interval` é STABLE no Postgres
-- (provolatile = 's') e expressão de índice exige IMMUTABLE. Sem isso, uma
-- corrida conseguiria encaixar um corte dentro do buffer de outro.
--
-- Solução: materializar o footprint ocupado em colunas próprias. `starts_at` e
-- `ends_at` seguem sendo o horário do serviço — o que cliente e agenda exibem —
-- e `occupies_from`/`occupies_to` passam a ser o intervalo protegido.
--
-- Escrito em passos expand-safe (nulável, backfill, NOT NULL) conforme
-- docs/delivery-part3.md §6, para funcionar mesmo com a tabela populada.

-- 1. Granularidade da grade de horários
ALTER TABLE barbershops
  ADD COLUMN slot_granularity_minutes INTEGER NOT NULL DEFAULT 15;

-- 2. Expand: colunas nuláveis
ALTER TABLE appointments
  ADD COLUMN buffer_before_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN buffer_after_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN occupies_from TIMESTAMPTZ(3),
  ADD COLUMN occupies_to TIMESTAMPTZ(3);

ALTER TABLE appointment_holds
  ADD COLUMN occupies_from TIMESTAMPTZ(3),
  ADD COLUMN occupies_to TIMESTAMPTZ(3);

-- 3. Backfill: sem buffers registrados, o footprint é o próprio serviço
UPDATE appointments
   SET occupies_from = starts_at, occupies_to = ends_at
 WHERE occupies_from IS NULL;

UPDATE appointment_holds
   SET occupies_from = starts_at, occupies_to = ends_at
 WHERE occupies_from IS NULL;

-- 4. Contract: agora as colunas são obrigatórias
ALTER TABLE appointments
  ALTER COLUMN occupies_from SET NOT NULL,
  ALTER COLUMN occupies_to SET NOT NULL;

ALTER TABLE appointment_holds
  ALTER COLUMN occupies_from SET NOT NULL,
  ALTER COLUMN occupies_to SET NOT NULL;

-- 5. Constraints passam a proteger o footprint
ALTER TABLE appointments DROP CONSTRAINT appointments_no_overlap;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(occupies_from, occupies_to) WITH &&
  )
  WHERE (status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW'));

ALTER TABLE appointment_holds DROP CONSTRAINT appointment_holds_no_overlap;
ALTER TABLE appointment_holds
  ADD CONSTRAINT appointment_holds_no_overlap
  EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(occupies_from, occupies_to) WITH &&
  );

-- 6. O footprint nunca pode ser menor que o serviço que ele protege
ALTER TABLE appointments
  ADD CONSTRAINT appointments_footprint_covers_service
  CHECK (occupies_from <= starts_at AND occupies_to >= ends_at);
ALTER TABLE appointment_holds
  ADD CONSTRAINT appointment_holds_footprint_covers_service
  CHECK (occupies_from <= starts_at AND occupies_to >= ends_at);
