-- Fixture mínima usada pelos testes de garantia do banco.
-- Duas barbearias, para exercitar isolamento entre tenants.

INSERT INTO plans (id, code, name, price_minor, features, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'essential', 'Essencial', 6900, '{"smartAgenda":false,"waitlist":false}', now()),
  ('11111111-1111-1111-1111-111111111112', 'pro', 'Pro', 14900, '{"smartAgenda":true,"waitlist":true}', now());

INSERT INTO barbershops (id, name, slug, timezone, updated_at) VALUES
  ('22222222-2222-2222-2222-222222222221', 'Barbearia A', 'barbearia-a', 'America/Sao_Paulo', now()),
  ('22222222-2222-2222-2222-222222222222', 'Barbearia B', 'barbearia-b', 'America/Sao_Paulo', now());

INSERT INTO professionals (id, barbershop_id, display_name, updated_at) VALUES
  ('33333333-3333-3333-3333-333333333331', '22222222-2222-2222-2222-222222222221', 'Matheus', now()),
  ('33333333-3333-3333-3333-333333333332', '22222222-2222-2222-2222-222222222222', 'Rafael', now());

INSERT INTO services (id, barbershop_id, name, price_minor, duration_minutes, updated_at) VALUES
  ('44444444-4444-4444-4444-444444444441', '22222222-2222-2222-2222-222222222221', 'Corte + Barba', 8000, 45, now()),
  ('44444444-4444-4444-4444-444444444442', '22222222-2222-2222-2222-222222222222', 'Corte', 5000, 30, now());

INSERT INTO barbershop_customers (id, barbershop_id, normalized_phone, current_name, updated_at) VALUES
  ('55555555-5555-5555-5555-555555555551', '22222222-2222-2222-2222-222222222221', '+5511999990000', 'Joao', now()),
  ('55555555-5555-5555-5555-555555555552', '22222222-2222-2222-2222-222222222222', '+5511999990000', 'Joao', now());
