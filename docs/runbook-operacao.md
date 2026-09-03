# Runbook de operação

Cobre backup, restauração e perda da VPS (Parte 3 §7). **Um backup sem
restauração testada não conta como backup** — o ensaio mensal é parte do
procedimento, não um extra.

## Objetivos declarados

| Objetivo | Alvo | Como é sustentado |
|---|---|---|
| RPO (perda máxima aceitável) | **≤ 5 minutos** | WAL arquivado continuamente para storage externo |
| RTO (tempo máximo até voltar) | **≤ 2 horas** | VPS reprovisionável por compose + restauração ensaiada |

Por que WAL desde o piloto, e não "quando o volume justificar": num sistema de
agenda, perder as últimas horas não é perder relatório — a barbearia deixa de
saber quem chega amanhã e o cliente aparece para um horário que o sistema não
tem mais. O volume de dados é pequeno e o custo do arquivamento é baixo.

## Backup

Diário (base) + contínuo (WAL):

```bash
# Base — dump lógico diário, cifrado antes de sair da VPS
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" \
  | age -r "$BACKUP_AGE_RECIPIENT" \
  > "/tmp/barber-$(date +%F).dump.age"

# Enviar para storage externo (fora da VPS — se a VPS morre, o backup não vai junto)
aws s3 cp "/tmp/barber-$(date +%F).dump.age" "s3://$BACKUP_BUCKET/base/"
```

O WAL é arquivado pelo próprio Postgres em `/wal_archive` (ver
`docker-compose.prod.yml`); um job sincroniza esse diretório para o bucket a
cada poucos minutos.

Também versionar fora da VPS: `.env.prod` (cifrado), `Caddyfile` e, se o
WhatsApp for habilitado algum dia, a sessão do serviço.

**`ENCRYPTION_KEY` merece cuidado próprio.** Ela cifra as credenciais de
integração e vive **fora** do banco, de propósito: é o que faz um dump vazado
não entregar o Google Agenda de ninguém. A consequência é que restaurar o banco
sem ela deixa as conexões ilegíveis — o sistema trata isso sem quebrar (marca a
integração como "precisa reconectar"), mas todo profissional teria de autorizar
de novo. Guarde-a com o `.env.prod` cifrado, e nunca no mesmo objeto do dump.
Trocá-la tem exatamente o mesmo efeito: só faça isso sabendo que vai custar uma
rodada de reconexões.

Retenção sugerida: 30 dias de base diária, 7 dias de WAL.

## Restauração (ensaio mensal obrigatório)

Sempre em ambiente **isolado**, nunca por cima de produção:

```bash
# 1. Subir um Postgres limpo, separado
docker run -d --name restore-test -e POSTGRES_PASSWORD=temp postgres:16-alpine

# 2. Restaurar o dump
age -d -i "$AGE_KEY" barber-AAAA-MM-DD.dump.age \
  | docker exec -i restore-test pg_restore -U postgres -d postgres --clean --if-exists

# 3. Conferir que voltou operação, não só schema
docker exec restore-test psql -U postgres -c \
  "SELECT count(*) FROM appointments WHERE status = 'CONFIRMED';"
docker exec restore-test psql -U postgres -c \
  "SELECT conname FROM pg_constraint WHERE conname = 'appointments_no_overlap';"
```

O ensaio só é considerado bem-sucedido se as três coisas voltarem: dados,
constraint anti-conflito e índice único de telefone. Registrar data, duração
real e quem executou — a duração medida é o que valida (ou desmente) o RTO.

## Perda total da VPS

1. Provisionar VPS nova (Ubuntu LTS, Docker).
2. Restaurar `.env.prod` do cofre e apontar o DNS depois, não antes.
3. `docker compose -f infra/docker/docker-compose.prod.yml up -d postgres redis`
4. Restaurar a base mais recente e aplicar o WAL até o último ponto disponível.
5. `pnpm --filter @barber/db exec prisma migrate deploy` (idempotente).
6. Subir `web` e `worker`; conferir `/api/health` retornando `ok`.
7. Só então apontar o DNS.
8. Conferir que o worker está drenando `outbox_events` sem reprocessar efeito já
   entregue — os handlers são idempotentes por `job_key`.

## Verificação pós-deploy

- `/api/health` responde `ok` (o endpoint checa banco, não só o processo);
- uma reserva de teste é criada e cancelada em barbearia de teste;
- `outbox_events` não acumula pendências;
- log do proxy não mostra token em caminho de URL (a redação está no `Caddyfile`).

## Rollback

Migrações não são desfeitas: o caminho é *roll forward* com migração corretiva.
Voltar a imagem anterior só é seguro se a última migração foi *expand* — por
isso a disciplina de expand/contract (`docs/delivery-part3.md` §6) é o que torna
o rollback possível.
