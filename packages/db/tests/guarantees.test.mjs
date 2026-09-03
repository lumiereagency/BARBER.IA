// Testes das garantias que vivem no banco, não na aplicação.
//
// Rodar com:  pnpm --filter @barber/db test:guarantees
//
// Cobre:
//  1. dois agendamentos simultâneos no mesmo slot — exatamente um sobrevive;
//  2. cancelado libera o horário, concluído não;
//  3. hold × confirmação coordenados por advisory lock (decisão #12);
//  4. relação de cliente não duplica por telefone dentro da barbearia,
//     mas o mesmo telefone existe em barbearias diferentes (isolamento);
//  5. telefone global único só quando verificado.

import pg from "pg";
import { randomUUID } from "node:crypto";

const CONNECTION = process.env.DATABASE_URL;
if (!CONNECTION) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const SHOP_A = "22222222-2222-2222-2222-222222222221";
const SHOP_B = "22222222-2222-2222-2222-222222222222";
const PRO_A = "33333333-3333-3333-3333-333333333331";
const SVC_A = "44444444-4444-4444-4444-444444444441";
const CUST_A = "55555555-5555-5555-5555-555555555551";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function connect() {
  const client = new pg.Client({ connectionString: CONNECTION });
  return client.connect().then(() => client);
}

/// O footprint (occupies_from/to) é o intervalo protegido pela constraint; por
/// padrão coincide com o serviço, mas os testes de buffer passam valores
/// maiores para exercitar a proteção do preparo e da limpeza.
function appointmentInsert(id, startsAt, endsAt, status = "CONFIRMED", footprint = {}) {
  return {
    text: `INSERT INTO appointments (
             id, barbershop_id, barbershop_customer_id, professional_id, service_id,
             starts_at, ends_at, occupies_from, occupies_to, status,
             price_snapshot_minor, service_name_snapshot, professional_name_snapshot,
             customer_name_snapshot, customer_phone_snapshot,
             management_token_hash, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::appointment_status,
                     8000,'Corte + Barba','Matheus','Joao','+5511999990000',$11, now())`,
    values: [
      id, SHOP_A, CUST_A, PRO_A, SVC_A, startsAt, endsAt,
      footprint.from ?? startsAt, footprint.to ?? endsAt,
      status, `hash_${id}`,
    ],
  };
}

async function reset(client) {
  await client.query("DELETE FROM appointment_holds");
  await client.query("DELETE FROM appointments");
}

// --- 1. Corrida real: duas transações concorrentes no mesmo slot ------------
async function testConcurrentDoubleBooking() {
  console.log("\n1) Dois agendamentos simultâneos no mesmo slot");
  const a = await connect();
  const b = await connect();
  const admin = await connect();
  await reset(admin);

  const start = "2026-10-01T13:00:00Z";
  const end = "2026-10-01T13:45:00Z";

  await a.query("BEGIN");
  await b.query("BEGIN");

  // As duas transações inserem o MESMO horário antes de qualquer commit.
  const first = await a.query(appointmentInsert(randomUUID(), start, end)).then(
    () => ({ ok: true }),
    (e) => ({ ok: false, error: e.message })
  );

  // A segunda fica bloqueada pela constraint até a primeira decidir o commit.
  const secondPromise = b.query(appointmentInsert(randomUUID(), start, end)).then(
    () => ({ ok: true }),
    (e) => ({ ok: false, error: e.message })
  );

  await a.query("COMMIT");
  const second = await secondPromise;

  try {
    await b.query("COMMIT");
  } catch {
    await b.query("ROLLBACK");
  }

  const { rows } = await admin.query(
    "SELECT count(*)::int AS n FROM appointments WHERE professional_id = $1 AND starts_at = $2",
    [PRO_A, start]
  );

  check("primeira transação confirma", first.ok);
  check(
    "segunda transação é rejeitada pelo banco",
    !second.ok && /exclusion|conflicting/i.test(second.error ?? ""),
    second.ok ? "a segunda passou — double booking!" : second.error
  );
  check("exatamente 1 agendamento sobrevive", rows[0].n === 1, `encontrados ${rows[0].n}`);

  await Promise.all([a.end(), b.end(), admin.end()]);
}

// --- 2. Quais status ocupam a agenda ---------------------------------------
async function testStatusOccupancy() {
  console.log("\n2) Status que ocupam a agenda");
  const c = await connect();
  await reset(c);

  const start = "2026-10-02T13:00:00Z";
  const end = "2026-10-02T13:45:00Z";

  await c.query(appointmentInsert(randomUUID(), start, end, "COMPLETED"));
  const overCompleted = await c.query(appointmentInsert(randomUUID(), start, end)).then(
    () => ({ ok: true }),
    (e) => ({ ok: false, error: e.message })
  );
  check("COMPLETED continua ocupando o horário", !overCompleted.ok);

  await reset(c);
  await c.query(appointmentInsert(randomUUID(), start, end, "CANCELLED_BY_CUSTOMER"));
  const overCancelled = await c.query(appointmentInsert(randomUUID(), start, end)).then(
    () => ({ ok: true }),
    (e) => ({ ok: false, error: e.message })
  );
  check("cancelado libera o horário", overCancelled.ok, overCancelled.error);

  await reset(c);
  await c.query(appointmentInsert(randomUUID(), start, end, "RESCHEDULED"));
  const overRescheduled = await c.query(appointmentInsert(randomUUID(), start, end)).then(
    () => ({ ok: true }),
    (e) => ({ ok: false, error: e.message })
  );
  check("remarcado libera o horário", overRescheduled.ok, overRescheduled.error);

  await c.end();
}

// --- 3. Hold × confirmação via advisory lock (decisão #12) -----------------
// Constraint de exclusão não cruza tabelas, então a coordenação entre
// appointment_holds e appointments é feita com pg_advisory_xact_lock por
// profissional. Este teste prova que o padrão funciona sob concorrência.
async function testHoldCoordination() {
  console.log("\n3) Hold × confirmação coordenados por advisory lock");
  const a = await connect();
  const b = await connect();
  const admin = await connect();
  await reset(admin);

  const start = "2026-10-03T13:00:00Z";
  const end = "2026-10-03T13:45:00Z";

  const lockSql = "SELECT pg_advisory_xact_lock(hashtext($1))";
  const slotFreeSql = `
    SELECT NOT EXISTS (
      SELECT 1 FROM appointments
       WHERE professional_id = $1
         AND status IN ('CONFIRMED','COMPLETED','NO_SHOW')
         AND tstzrange(occupies_from, occupies_to) && tstzrange($2::timestamptz, $3::timestamptz)
    ) AND NOT EXISTS (
      SELECT 1 FROM appointment_holds
       WHERE professional_id = $1
         AND expires_at > now()
         AND tstzrange(occupies_from, occupies_to) && tstzrange($2::timestamptz, $3::timestamptz)
    ) AS free`;

  // Transação A cria um hold sob o lock.
  await a.query("BEGIN");
  await a.query(lockSql, [PRO_A]);
  const freeForA = await a.query(slotFreeSql, [PRO_A, start, end]);
  check("slot livre antes do hold", freeForA.rows[0].free === true);
  await a.query(
    `INSERT INTO appointment_holds (id, barbershop_id, professional_id, service_id,
       starts_at, ends_at, occupies_from, occupies_to, expires_at, session_token_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$5,$6, now() + interval '5 minutes', $7)`,
    [randomUUID(), SHOP_A, PRO_A, SVC_A, start, end, `sess_${randomUUID()}`]
  );

  // Transação B tenta confirmar o MESMO slot; fica bloqueada no lock até A commitar.
  let bSawHold = null;
  const bFlow = (async () => {
    await b.query("BEGIN");
    await b.query(lockSql, [PRO_A]); // bloqueia aqui
    const free = await b.query(slotFreeSql, [PRO_A, start, end]);
    bSawHold = free.rows[0].free;
    await b.query("ROLLBACK");
  })();

  await new Promise((r) => setTimeout(r, 200));
  await a.query("COMMIT");
  await bFlow;

  check(
    "confirmação concorrente enxerga o hold e recusa o slot",
    bSawHold === false,
    `slot reportado como livre=${bSawHold}`
  );

  // Hold expirado não pode bloquear.
  await reset(admin);
  await admin.query(
    `INSERT INTO appointment_holds (id, barbershop_id, professional_id, service_id,
       starts_at, ends_at, occupies_from, occupies_to, expires_at, session_token_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$5,$6, now() - interval '1 minute', $7)`,
    [randomUUID(), SHOP_A, PRO_A, SVC_A, start, end, `sess_${randomUUID()}`]
  );
  const afterExpiry = await admin.query(slotFreeSql, [PRO_A, start, end]);
  check("hold expirado não bloqueia mais", afterExpiry.rows[0].free === true);

  await reset(admin);
  await Promise.all([a.end(), b.end(), admin.end()]);
}

// --- 3b. Buffers protegidos pelo banco -------------------------------------
// A constraint age sobre o footprint, não sobre o horário do serviço: sem isso,
// uma corrida encaixaria um corte dentro do intervalo de preparo de outro.
async function testBufferProtection() {
  console.log("\n3b) Buffer protegido pela constraint");
  const c = await connect();
  await reset(c);

  const start = "2026-10-04T13:00:00Z";
  const end = "2026-10-04T13:45:00Z";
  // Serviço das 13:00 às 13:45, com 15 min de buffer depois: ocupa até 14:00
  await c.query(
    appointmentInsert(randomUUID(), start, end, "CONFIRMED", { to: "2026-10-04T14:00:00Z" })
  );

  // Começar 13:45 é dentro do buffer — deve ser recusado
  const dentroDoBuffer = await c
    .query(appointmentInsert(randomUUID(), "2026-10-04T13:45:00Z", "2026-10-04T14:30:00Z"))
    .then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message }));
  check("agendar dentro do buffer é recusado", !dentroDoBuffer.ok);

  // Começar 14:00, quando o buffer termina, é permitido
  const depoisDoBuffer = await c
    .query(appointmentInsert(randomUUID(), "2026-10-04T14:00:00Z", "2026-10-04T14:45:00Z"))
    .then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message }));
  check("agendar após o buffer é permitido", depoisDoBuffer.ok, depoisDoBuffer.error);

  // O footprint nunca pode ser menor que o serviço
  const footprintInvalido = await c
    .query(
      appointmentInsert(randomUUID(), "2026-10-04T16:00:00Z", "2026-10-04T16:45:00Z", "CONFIRMED", {
        from: "2026-10-04T16:30:00Z",
      })
    )
    .then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message }));
  check("footprint menor que o serviço é recusado", !footprintInvalido.ok);

  await reset(c);
  await c.end();
}

// --- 4. Dedupe de cliente e isolamento entre tenants ------------------------
async function testCustomerDedupe() {
  console.log("\n4) Relação de cliente: dedupe e isolamento");
  const c = await connect();

  const dup = await c
    .query(
      `INSERT INTO barbershop_customers (id, barbershop_id, normalized_phone, current_name, updated_at)
       VALUES ($1,$2,'+5511999990000','Joao de novo', now())`,
      [randomUUID(), SHOP_A]
    )
    .then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message }));
  check(
    "mesmo telefone na mesma barbearia é rejeitado",
    !dup.ok && /unique|duplicate/i.test(dup.error ?? ""),
    dup.ok ? "duplicou — CRM corrompido" : ""
  );

  // Escopado às duas barbearias da fixture: o banco de desenvolvimento pode
  // ter outras barbearias com o mesmo telefone, e isso não invalida nada — é
  // justamente o comportamento esperado.
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM barbershop_customers
      WHERE normalized_phone = '+5511999990000' AND barbershop_id = ANY($1::uuid[])`,
    [[SHOP_A, SHOP_B]]
  );
  check(
    "mesmo telefone existe em barbearias diferentes (isolamento)",
    rows[0].n === 2,
    `encontrados ${rows[0].n}`
  );

  await c.end();
}

// --- 5. Telefone global único só quando verificado --------------------------
async function testVerifiedPhoneUniqueness() {
  console.log("\n5) Telefone global único apenas quando verificado");
  const c = await connect();
  await c.query("DELETE FROM customers");

  const insert = (verified) =>
    c
      .query(
        `INSERT INTO customers (id, normalized_phone, display_name, phone_verified_at, updated_at)
         VALUES ($1, '+5511988887777', 'Teste', ${verified ? "now()" : "NULL"}, now())`,
        [randomUUID()]
      )
      .then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message }));

  const first = await insert(false);
  const second = await insert(false);
  check("dois não verificados com o mesmo telefone são permitidos", first.ok && second.ok);

  const firstVerified = await insert(true);
  const secondVerified = await insert(true);
  check("primeiro verificado passa", firstVerified.ok, firstVerified.error);
  check(
    "segundo verificado com o mesmo telefone é rejeitado",
    !secondVerified.ok && /unique|duplicate/i.test(secondVerified.error ?? "")
  );

  await c.query("DELETE FROM customers");
  await c.end();
}

const start = Date.now();
await testConcurrentDoubleBooking();
await testStatusOccupancy();
await testHoldCoordination();
await testBufferProtection();
await testCustomerDedupe();
await testVerifiedPhoneUniqueness();

console.log(`\n${passed} passaram, ${failed} falharam (${Date.now() - start}ms)`);
process.exit(failed === 0 ? 0 : 1);
