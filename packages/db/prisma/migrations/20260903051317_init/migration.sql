-- CreateEnum
CREATE TYPE "coupon_discount_type" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "barbershop_status" AS ENUM ('ACTIVE', 'PAST_DUE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('OWNER', 'ADMIN', 'RECEPTIONIST', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "schedule_exception_type" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'VACATION');

-- CreateEnum
CREATE TYPE "customer_account_status" AS ENUM ('ACTIVE', 'DELETION_REQUESTED', 'ANONYMIZED');

-- CreateEnum
CREATE TYPE "consent_channel" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "consent_purpose" AS ENUM ('OPERATIONAL', 'MARKETING');

-- CreateEnum
CREATE TYPE "consent_status" AS ENUM ('GRANTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('CONFIRMED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "appointment_source" AS ENUM ('ONLINE', 'MANUAL', 'WAITLIST', 'SMART_OPPORTUNITY');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('CUSTOMER', 'STAFF', 'SYSTEM', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "waitlist_status" AS ENUM ('WAITING', 'NOTIFIED', 'FULFILLED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "promotion_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "smart_opportunity_status" AS ENUM ('OPEN', 'FILLED', 'EXPIRED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "integration_provider" AS ENUM ('GOOGLE_CALENDAR', 'WHATSAPP_BAILEYS');

-- CreateEnum
CREATE TYPE "integration_status" AS ENUM ('CONNECTED', 'UNSTABLE', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "calendar_sync_status" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "outbox_status" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "job_attempt_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "idempotency_status" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "features" JSONB NOT NULL,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" "coupon_discount_type" NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "max_redemptions" INTEGER,
    "redeemed_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barbershops" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "phone" TEXT,
    "address" JSONB,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" "barbershop_status" NOT NULL DEFAULT 'ACTIVE',
    "booking_window_days" INTEGER NOT NULL DEFAULT 60,
    "minimum_notice_minutes" INTEGER NOT NULL DEFAULT 0,
    "cancellation_notice_minutes" INTEGER NOT NULL DEFAULT 0,
    "hold_duration_minutes" INTEGER NOT NULL DEFAULT 5,
    "cancellation_policy" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "barbershops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "subscription_status" NOT NULL DEFAULT 'TRIALING',
    "provider" TEXT,
    "external_customer_id" TEXT,
    "external_subscription_id" TEXT,
    "current_period_start" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "name" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barbershop_memberships" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "membership_role" NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "permissions" JSONB,
    "professional_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "barbershop_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professionals" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "bio" TEXT,
    "phone" TEXT,
    "avatar_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "booking_priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "professionals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_minor" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "public_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_services" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "custom_price_minor" INTEGER,
    "custom_duration_minutes" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "professional_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_hours" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_local_time" TEXT NOT NULL,
    "end_local_time" TEXT NOT NULL,
    "effective_from" DATE,
    "effective_to" DATE,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_exceptions" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "type" "schedule_exception_type" NOT NULL,
    "start_local_time" TEXT,
    "end_local_time" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_blocks" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "normalized_phone" TEXT,
    "display_name" TEXT NOT NULL,
    "email" TEXT,
    "phone_verified_at" TIMESTAMPTZ(3),
    "account_status" "customer_account_status" NOT NULL DEFAULT 'ACTIVE',
    "deletion_requested_at" TIMESTAMPTZ(3),
    "anonymized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barbershop_customers" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "customer_id" UUID,
    "normalized_phone" TEXT NOT NULL,
    "current_name" TEXT NOT NULL,
    "first_visit_at" TIMESTAMPTZ(3),
    "last_visit_at" TIMESTAMPTZ(3),
    "completed_visits_count" INTEGER NOT NULL DEFAULT 0,
    "cancelled_count" INTEGER NOT NULL DEFAULT 0,
    "no_show_count" INTEGER NOT NULL DEFAULT 0,
    "total_spent_minor" INTEGER NOT NULL DEFAULT 0,
    "average_ticket_minor" INTEGER,
    "average_return_days" DOUBLE PRECISION,
    "preferred_professional_id" UUID,
    "preferred_service_id" UUID,
    "last_contact_at" TIMESTAMPTZ(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "barbershop_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID,
    "customer_id" UUID,
    "barbershop_customer_id" UUID,
    "channel" "consent_channel" NOT NULL,
    "purpose" "consent_purpose" NOT NULL,
    "status" "consent_status" NOT NULL DEFAULT 'GRANTED',
    "text_version" TEXT NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "source" TEXT NOT NULL,
    "evidence" JSONB,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "barbershop_customer_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "appointment_status" NOT NULL DEFAULT 'CONFIRMED',
    "price_snapshot_minor" INTEGER NOT NULL,
    "service_name_snapshot" TEXT NOT NULL,
    "professional_name_snapshot" TEXT NOT NULL,
    "customer_name_snapshot" TEXT NOT NULL,
    "customer_phone_snapshot" TEXT NOT NULL,
    "source" "appointment_source" NOT NULL DEFAULT 'ONLINE',
    "management_token_hash" TEXT NOT NULL,
    "management_token_expires_at" TIMESTAMPTZ(3),
    "previous_appointment_id" UUID,
    "promotion_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "created_by_type" "actor_type" NOT NULL DEFAULT 'CUSTOMER',
    "created_by_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_holds" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_events" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "barbershop_customer_id" UUID NOT NULL,
    "service_id" UUID,
    "professional_id" UUID,
    "date_from" DATE,
    "date_to" DATE,
    "time_range_start" TEXT,
    "time_range_end" TEXT,
    "status" "waitlist_status" NOT NULL DEFAULT 'WAITING',
    "expires_at" TIMESTAMPTZ(3),
    "rank_score" DOUBLE PRECISION,
    "rank_reasons" JSONB,
    "fulfilled_appointment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "eligibility_rules" JSONB NOT NULL DEFAULT '{}',
    "rules_version" INTEGER NOT NULL DEFAULT 1,
    "usage_limit" INTEGER,
    "status" "promotion_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "barbershop_customer_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "redeemed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_opportunities" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "compatible_service_ids" UUID[],
    "estimated_revenue_minor" INTEGER NOT NULL,
    "calculation_version" INTEGER NOT NULL DEFAULT 1,
    "status" "smart_opportunity_status" NOT NULL DEFAULT 'OPEN',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "share_token_hash" TEXT,
    "claimed_appointment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "smart_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_return_scores" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "barbershop_customer_id" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reasons" JSONB NOT NULL,
    "calculation_version" INTEGER NOT NULL DEFAULT 1,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_return_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "professional_id" UUID,
    "provider" "integration_provider" NOT NULL,
    "status" "integration_status" NOT NULL DEFAULT 'DISCONNECTED',
    "credentials_ref" TEXT,
    "last_sync_at" TIMESTAMPTZ(3),
    "last_error_code" TEXT,
    "disconnected_at" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_calendar_syncs" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "external_event_id" TEXT,
    "status" "calendar_sync_status" NOT NULL DEFAULT 'PENDING',
    "last_error" TEXT,
    "last_synced_at" TIMESTAMPTZ(3),

    CONSTRAINT "appointment_calendar_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "outbox_status" NOT NULL DEFAULT 'PENDING',
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_attempts" (
    "id" UUID NOT NULL,
    "outbox_event_id" UUID,
    "job_key" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "job_attempt_status" NOT NULL,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "job_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "idempotency_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_snapshot" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "ip_hash" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_users_email_key" ON "platform_admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "barbershops_slug_key" ON "barbershops"("slug");

-- CreateIndex
CREATE INDEX "barbershops_organization_id_idx" ON "barbershops"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_barbershop_id_key" ON "subscriptions"("barbershop_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_counters_barbershop_id_metric_period_start_key" ON "usage_counters"("barbershop_id", "metric", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "barbershop_memberships_professional_id_key" ON "barbershop_memberships"("professional_id");

-- CreateIndex
CREATE INDEX "barbershop_memberships_user_id_idx" ON "barbershop_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "barbershop_memberships_barbershop_id_user_id_key" ON "barbershop_memberships"("barbershop_id", "user_id");

-- CreateIndex
CREATE INDEX "professionals_barbershop_id_active_idx" ON "professionals"("barbershop_id", "active");

-- CreateIndex
CREATE INDEX "services_barbershop_id_active_public_order_idx" ON "services"("barbershop_id", "active", "public_order");

-- CreateIndex
CREATE INDEX "professional_services_barbershop_id_service_id_active_idx" ON "professional_services"("barbershop_id", "service_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "professional_services_professional_id_service_id_key" ON "professional_services"("professional_id", "service_id");

-- CreateIndex
CREATE INDEX "working_hours_barbershop_id_professional_id_weekday_idx" ON "working_hours"("barbershop_id", "professional_id", "weekday");

-- CreateIndex
CREATE INDEX "schedule_exceptions_barbershop_id_professional_id_start_dat_idx" ON "schedule_exceptions"("barbershop_id", "professional_id", "start_date");

-- CreateIndex
CREATE INDEX "schedule_blocks_barbershop_id_professional_id_starts_at_idx" ON "schedule_blocks"("barbershop_id", "professional_id", "starts_at");

-- CreateIndex
CREATE INDEX "customers_normalized_phone_idx" ON "customers"("normalized_phone");

-- CreateIndex
CREATE INDEX "barbershop_customers_barbershop_id_customer_id_idx" ON "barbershop_customers"("barbershop_id", "customer_id");

-- CreateIndex
CREATE INDEX "barbershop_customers_barbershop_id_last_visit_at_idx" ON "barbershop_customers"("barbershop_id", "last_visit_at");

-- CreateIndex
CREATE UNIQUE INDEX "barbershop_customers_barbershop_id_normalized_phone_key" ON "barbershop_customers"("barbershop_id", "normalized_phone");

-- CreateIndex
CREATE INDEX "consents_barbershop_customer_id_channel_purpose_idx" ON "consents"("barbershop_customer_id", "channel", "purpose");

-- CreateIndex
CREATE INDEX "consents_customer_id_channel_purpose_idx" ON "consents"("customer_id", "channel", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_management_token_hash_key" ON "appointments"("management_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_previous_appointment_id_key" ON "appointments"("previous_appointment_id");

-- CreateIndex
CREATE INDEX "appointments_barbershop_id_professional_id_starts_at_idx" ON "appointments"("barbershop_id", "professional_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_barbershop_id_starts_at_idx" ON "appointments"("barbershop_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_barbershop_customer_id_starts_at_idx" ON "appointments"("barbershop_customer_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_holds_session_token_hash_key" ON "appointment_holds"("session_token_hash");

-- CreateIndex
CREATE INDEX "appointment_holds_barbershop_id_professional_id_starts_at_idx" ON "appointment_holds"("barbershop_id", "professional_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointment_holds_expires_at_idx" ON "appointment_holds"("expires_at");

-- CreateIndex
CREATE INDEX "appointment_events_appointment_id_created_at_idx" ON "appointment_events"("appointment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_fulfilled_appointment_id_key" ON "waitlist_entries"("fulfilled_appointment_id");

-- CreateIndex
CREATE INDEX "waitlist_entries_barbershop_id_status_idx" ON "waitlist_entries"("barbershop_id", "status");

-- CreateIndex
CREATE INDEX "promotions_barbershop_id_status_starts_at_idx" ON "promotions"("barbershop_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "promotion_redemptions_barbershop_id_promotion_id_idx" ON "promotion_redemptions"("barbershop_id", "promotion_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemptions_promotion_id_appointment_id_key" ON "promotion_redemptions"("promotion_id", "appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "smart_opportunities_share_token_hash_key" ON "smart_opportunities"("share_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "smart_opportunities_claimed_appointment_id_key" ON "smart_opportunities"("claimed_appointment_id");

-- CreateIndex
CREATE INDEX "smart_opportunities_barbershop_id_status_starts_at_idx" ON "smart_opportunities"("barbershop_id", "status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_return_scores_barbershop_customer_id_key" ON "customer_return_scores"("barbershop_customer_id");

-- CreateIndex
CREATE INDEX "customer_return_scores_barbershop_id_score_idx" ON "customer_return_scores"("barbershop_id", "score");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_barbershop_id_professional_id_provi_key" ON "integration_connections"("barbershop_id", "professional_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_calendar_syncs_appointment_id_connection_id_key" ON "appointment_calendar_syncs"("appointment_id", "connection_id");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "job_attempts_job_key_idx" ON "job_attempts"("job_key");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");

-- CreateIndex
CREATE INDEX "audit_logs_barbershop_id_created_at_idx" ON "audit_logs"("barbershop_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_type_actor_id_idx" ON "audit_logs"("actor_type", "actor_id");

-- AddForeignKey
ALTER TABLE "barbershops" ADD CONSTRAINT "barbershops_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbershop_memberships" ADD CONSTRAINT "barbershop_memberships_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbershop_memberships" ADD CONSTRAINT "barbershop_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbershop_memberships" ADD CONSTRAINT "barbershop_memberships_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbershop_customers" ADD CONSTRAINT "barbershop_customers_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbershop_customers" ADD CONSTRAINT "barbershop_customers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbershop_customers" ADD CONSTRAINT "barbershop_customers_preferred_professional_id_fkey" FOREIGN KEY ("preferred_professional_id") REFERENCES "professionals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barbershop_customers" ADD CONSTRAINT "barbershop_customers_preferred_service_id_fkey" FOREIGN KEY ("preferred_service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_barbershop_customer_id_fkey" FOREIGN KEY ("barbershop_customer_id") REFERENCES "barbershop_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_barbershop_customer_id_fkey" FOREIGN KEY ("barbershop_customer_id") REFERENCES "barbershop_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_previous_appointment_id_fkey" FOREIGN KEY ("previous_appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_barbershop_customer_id_fkey" FOREIGN KEY ("barbershop_customer_id") REFERENCES "barbershop_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_fulfilled_appointment_id_fkey" FOREIGN KEY ("fulfilled_appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_barbershop_customer_id_fkey" FOREIGN KEY ("barbershop_customer_id") REFERENCES "barbershop_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_opportunities" ADD CONSTRAINT "smart_opportunities_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_opportunities" ADD CONSTRAINT "smart_opportunities_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_opportunities" ADD CONSTRAINT "smart_opportunities_claimed_appointment_id_fkey" FOREIGN KEY ("claimed_appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_scores" ADD CONSTRAINT "customer_return_scores_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_scores" ADD CONSTRAINT "customer_return_scores_barbershop_customer_id_fkey" FOREIGN KEY ("barbershop_customer_id") REFERENCES "barbershop_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_calendar_syncs" ADD CONSTRAINT "appointment_calendar_syncs_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_calendar_syncs" ADD CONSTRAINT "appointment_calendar_syncs_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_calendar_syncs" ADD CONSTRAINT "appointment_calendar_syncs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_outbox_event_id_fkey" FOREIGN KEY ("outbox_event_id") REFERENCES "outbox_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garantias que não são expressáveis no schema Prisma
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1) Anti-conflito de agenda (Parte 2 §6).
-- Cobre todos os status que ocupam agenda: CONFIRMED ocupa o futuro, COMPLETED
-- e NO_SHOW mantêm o passado ocupado (senão daria para gravar retroativamente
-- um segundo atendimento em cima de um já realizado).
-- Cancelados e remarcados liberam o horário.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  )
  WHERE (status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW'));

-- 2) Telefone global único apenas quando verificado (Parte 2 §5.3).
-- Antes da verificação, o mesmo número pode aparecer em contas não verificadas
-- distintas sem travar o cadastro.
CREATE UNIQUE INDEX customers_normalized_phone_verified_key
  ON customers (normalized_phone)
  WHERE phone_verified_at IS NOT NULL AND normalized_phone IS NOT NULL;

-- 3) Holds não podem se sobrepor entre si para o mesmo profissional.
-- Não dá para excluir holds expirados no predicado (o Postgres exige expressão
-- imutável e now() não é), então a expiração é responsabilidade do job de
-- limpeza; enquanto não roda, o hold expirado ainda ocupa. A coordenação
-- hold × agendamento é feita por advisory lock na aplicação (decisão #12).
ALTER TABLE appointment_holds
  ADD CONSTRAINT appointment_holds_no_overlap
  EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  );

-- 4) Intervalos precisam ser coerentes.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_time_order CHECK (ends_at > starts_at);
ALTER TABLE appointment_holds
  ADD CONSTRAINT appointment_holds_time_order CHECK (ends_at > starts_at);
ALTER TABLE schedule_blocks
  ADD CONSTRAINT schedule_blocks_time_order CHECK (ends_at > starts_at);
