-- =============================================================================
-- SOFIA · Migración 5: Ciclo de Vida, Sesiones, Idempotencia, Diario DML y Auditoría Estricta
-- =============================================================================
-- Notas operativas:
-- 1. Diseñada para aplicarse en ventana coordinada previa al despliegue de Express Fase 2.
-- 2. Usa índice compuesto (status, start_time, end_time) para evitar tanto ERROR 42P17
--    (status::text no es IMMUTABLE en predicados de índice) como ERROR 55P04 con valores enum nuevos.
-- =============================================================================

do $$
begin
  create extension if not exists btree_gist;
exception
  when insufficient_privilege then
    raise notice 'Extensión btree_gist no instalada por permisos de rol; se usan índices únicos parciales y locks deterministas.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Esquema privado de auditoría interna (fuera de PostgREST)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Ampliación de ENUMs existentes y creación de nuevos ENUMs
-- ---------------------------------------------------------------------------
alter type public.reservation_status add value if not exists 'seated';
alter type public.reservation_status add value if not exists 'completed';
alter type public.reservation_status add value if not exists 'no_show';

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'table_session_type'
  ) then
    create type public.table_session_type as enum ('reservation', 'walk_in');
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'session_close_reason'
  ) then
    create type public.session_close_reason as enum (
      'service_completed',
      'walk_in_closed',
      'operational_release',
      'reservation_cancelled'
    );
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'user_auth_op_type'
  ) then
    create type public.user_auth_op_type as enum ('invite_user', 'reset_password');
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'user_auth_op_state'
  ) then
    create type public.user_auth_op_state as enum (
      'pending_auth',
      'auth_dispatched',
      'auth_response_received',
      'completed',
      'failed',
      'needs_reconciliation'
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Evolución de tablas existentes
-- ---------------------------------------------------------------------------
alter table public.tables
  add column if not exists shape text not null default 'square';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tables'::regclass
      and conname = 'tables_shape_check'
  ) then
    alter table public.tables
      add constraint tables_shape_check
      check (shape in ('round', 'square', 'rectangle'));
  end if;
end;
$$;

alter table public.reservations
  add column if not exists seated_at timestamptz,
  add column if not exists seated_by uuid references public.profiles (id) on delete restrict,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references public.profiles (id) on delete restrict,
  add column if not exists no_show_at timestamptz,
  add column if not exists no_show_by uuid references public.profiles (id) on delete restrict;

alter table public.audit_logs
  add column if not exists created_txid xid8 not null default pg_current_xact_id(),
  add column if not exists idempotency_key text,
  add column if not exists operation text,
  add column if not exists is_primary_idempotency_event boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.audit_logs'::regclass
      and conname = 'audit_logs_mono_event_check'
  ) then
    alter table public.audit_logs
      add constraint audit_logs_mono_event_check
      check (is_primary_idempotency_event = true);
  end if;
end;
$$;

create index if not exists idx_audit_logs_created_txid
  on public.audit_logs (created_txid);

create unique index if not exists uq_audit_logs_primary_idempotency
  on public.audit_logs (actor_id, idempotency_key)
  where idempotency_key is not null and is_primary_idempotency_event = true;

-- ---------------------------------------------------------------------------
-- 4. Nuevas tablas de negocio, idempotencia y coordinación Auth
-- ---------------------------------------------------------------------------
create table if not exists public.operational_settings (
  id smallint primary key default 1 check (id = 1),
  default_reservation_duration_minutes integer not null default 120
    check (default_reservation_duration_minutes between 30 and 360),
  default_walk_in_duration_minutes integer not null default 90
    check (default_walk_in_duration_minutes between 30 and 360),
  reservation_buffer_minutes integer not null default 15
    check (reservation_buffer_minutes between 0 and 60),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict
);

insert into public.operational_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables (id) on delete restrict,
  reservation_id uuid references public.reservations (id) on delete restrict,
  session_type public.table_session_type not null,
  guests_count integer check (guests_count is null or (guests_count between 1 and 50)),
  started_at timestamptz not null default now(),
  expected_duration_minutes integer not null default 90
    check (expected_duration_minutes between 15 and 480),
  estimated_end_at timestamptz not null,
  ended_at timestamptz,
  close_reason public.session_close_reason,
  started_by uuid references public.profiles (id) on delete restrict,
  ended_by uuid references public.profiles (id) on delete restrict,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint table_sessions_type_reservation_check check (
    (session_type = 'reservation' and reservation_id is not null)
    or (session_type = 'walk_in' and reservation_id is null)
  ),
  constraint table_sessions_close_consistency_check check (
    (ended_at is null and close_reason is null and ended_by is null)
    or (ended_at is not null and close_reason is not null and ended_at >= started_at)
  ),
  constraint table_sessions_estimated_after_start_check check (estimated_end_at >= started_at)
);

create unique index if not exists uq_table_sessions_one_open_per_table
  on public.table_sessions (table_id)
  where ended_at is null;

create index if not exists idx_table_sessions_reservation_open
  on public.table_sessions (reservation_id)
  where ended_at is null and reservation_id is not null;

create index if not exists idx_table_sessions_started_at
  on public.table_sessions (started_at desc);

create index if not exists idx_reservations_active_states
  on public.reservations (status, start_time, end_time);

create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles (id) on delete restrict,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 8 and 128),
  operation text not null check (length(btrim(operation)) between 3 and 100),
  request_hash text not null check (length(btrim(request_hash)) between 16 and 128),
  created_txid xid8 not null default pg_current_xact_id(),
  primary_audit_id uuid references public.audit_logs (id) on delete restrict,
  response_status integer not null default 200,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  constraint uq_idempotency_keys_actor_key unique (actor_id, idempotency_key)
);

create index if not exists idx_idempotency_keys_created_txid
  on public.idempotency_keys (created_txid);

create table if not exists public.user_auth_operations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles (id) on delete restrict,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 8 and 128),
  request_hash text not null check (length(btrim(request_hash)) between 16 and 128),
  operation_type public.user_auth_op_type not null,
  target_email text not null check (target_email = lower(btrim(target_email)) and length(target_email) >= 5),
  target_user_id uuid,
  correlation_id uuid not null unique default gen_random_uuid(),
  state public.user_auth_op_state not null default 'pending_auth',
  audit_log_id uuid references public.audit_logs (id) on delete restrict,
  last_error text,
  state_history jsonb not null default '[]'::jsonb,
  dispatched_at timestamptz,
  reconciled_at timestamptz,
  reconciled_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_user_auth_ops_actor_key unique (actor_id, idempotency_key)
);

create unique index if not exists uq_user_auth_ops_active_target
  on public.user_auth_operations (operation_type, target_email)
  where state in ('pending_auth', 'auth_dispatched', 'auth_response_received');

alter table public.profiles
  add column if not exists invited_operation_id uuid references public.user_auth_operations (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 5. Tablas privadas del diario DML independiente y sellos de verificación
-- ---------------------------------------------------------------------------
create table if not exists private._tx_dml_journal (
  txid xid8 not null default pg_current_xact_id(),
  target_schema text not null,
  target_table text not null,
  row_pk text not null,
  first_op text not null check (first_op in ('INSERT', 'UPDATE', 'DELETE')),
  last_op text not null check (last_op in ('INSERT', 'UPDATE', 'DELETE')),
  row_existed_before_tx boolean not null,
  first_old_row jsonb,
  last_new_row jsonb,
  old_pk text,
  new_pk text,
  is_deleted_at_end boolean not null,
  has_effective_change boolean not null default true,
  mutation_count integer not null default 1 check (mutation_count >= 1),
  op_trace jsonb not null default '[]'::jsonb,
  verified_at timestamptz,
  hold_for_investigation boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (txid, target_schema, target_table, row_pk)
);

create index if not exists idx_tx_dml_journal_unverified
  on private._tx_dml_journal (txid)
  where verified_at is null;

create index if not exists idx_tx_dml_journal_purge_candidates
  on private._tx_dml_journal (verified_at, created_at)
  where verified_at is not null and hold_for_investigation = false;

create table if not exists private._tx_verified_audits (
  audit_log_id uuid primary key references public.audit_logs (id) on delete restrict,
  txid xid8 not null,
  verified_at timestamptz not null default now()
);

create index if not exists idx_tx_verified_audits_txid
  on private._tx_verified_audits (txid);

create table if not exists private.journal_purge_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  xmin_used xid8,
  deleted_journal_rows integer not null default 0,
  deleted_seal_rows integer not null default 0,
  unverified_stale_count integer not null default 0,
  status text not null check (status in ('running', 'success', 'failure')),
  error_message text
);

-- ---------------------------------------------------------------------------
-- 6. Privilegios mínimos, cierre de escrituras directas PostgREST y RLS
-- ---------------------------------------------------------------------------
grant usage on type
  public.table_session_type,
  public.session_close_reason,
  public.user_auth_op_type,
  public.user_auth_op_state
  to authenticated, service_role;

-- 6.1 operational_settings: lectura staff activo, mutación exclusiva via RPC
alter table public.operational_settings enable row level security;
revoke all on table public.operational_settings from public, anon, authenticated;
grant select on table public.operational_settings to authenticated;

drop policy if exists "Operational settings viewable by active staff" on public.operational_settings;
create policy "Operational settings viewable by active staff"
  on public.operational_settings for select to authenticated
  using (exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.status = 'active'::public.profile_status
  ));

-- 6.2 table_sessions: lectura staff activo, mutación exclusiva via RPC
alter table public.table_sessions enable row level security;
revoke all on table public.table_sessions from public, anon, authenticated;
grant select on table public.table_sessions to authenticated;

drop policy if exists "Table sessions viewable by active staff" on public.table_sessions;
create policy "Table sessions viewable by active staff"
  on public.table_sessions for select to authenticated
  using (exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.status = 'active'::public.profile_status
  ));

-- 6.3 idempotency_keys y user_auth_operations: sin exposición a PostgREST cliente
alter table public.idempotency_keys enable row level security;
revoke all on table public.idempotency_keys from public, anon, authenticated;

alter table public.user_auth_operations enable row level security;
revoke all on table public.user_auth_operations from public, anon, authenticated;

-- 6.4 admin_alerts: cerrar UPDATE directo de Migración 4 (forzar review_admin_alert_tx)
revoke all on table public.admin_alerts from public, anon, authenticated;
grant select on table public.admin_alerts to authenticated;
drop policy if exists "Only active super_admin can review alerts" on public.admin_alerts;

-- 6.5 profiles: cerrar UPDATE directo de display name para evitar mutaciones fuera de RPC
revoke update on table public.profiles from public, anon, authenticated;
drop policy if exists "Users can update display name" on public.profiles;
drop policy if exists "Users can update only their own display name" on public.profiles;

-- 6.6 check_table_overlap(): cerrar ACL por defecto sobre PUBLIC
revoke all on function public.check_table_overlap() from public, anon, authenticated;

-- 6.7 Tablas privadas: RLS forzada sin políticas y sin privilegios ni siquiera a service_role
alter table private._tx_dml_journal enable row level security;
alter table private._tx_dml_journal force row level security;
revoke all on table private._tx_dml_journal from public, anon, authenticated, service_role;

alter table private._tx_verified_audits enable row level security;
alter table private._tx_verified_audits force row level security;
revoke all on table private._tx_verified_audits from public, anon, authenticated, service_role;

alter table private.journal_purge_runs enable row level security;
alter table private.journal_purge_runs force row level security;
revoke all on table private.journal_purge_runs from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Triggers de updated_at, sincronización Auth e inmutabilidad de claves
-- ---------------------------------------------------------------------------
create or replace function public.set_operational_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function public.set_operational_updated_at() from public, anon, authenticated;

drop trigger if exists operational_settings_set_updated_at on public.operational_settings;
create trigger operational_settings_set_updated_at
  before update on public.operational_settings
  for each row execute function public.set_operational_updated_at();

drop trigger if exists table_sessions_set_updated_at on public.table_sessions;
create trigger table_sessions_set_updated_at
  before update on public.table_sessions
  for each row execute function public.set_operational_updated_at();

drop trigger if exists user_auth_operations_set_updated_at on public.user_auth_operations;
create trigger user_auth_operations_set_updated_at
  before update on public.user_auth_operations
  for each row execute function public.set_operational_updated_at();

-- Sincronización segura auth.users -> public.profiles:
-- Solo correlaciona invited_operation_id si la operación existe para ese email; nunca deriva roles/permisos desde metadata.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_raw_op text;
  v_matched_op_id uuid;
begin
  if new.email is null then
    return new;
  end if;

  v_raw_op := btrim(coalesce(new.raw_user_meta_data ->> 'sofia_invite_op_id', ''));
  if v_raw_op ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select op.id into v_matched_op_id
    from public.user_auth_operations op
    where op.id = v_raw_op::uuid
      and op.operation_type = 'invite_user'::public.user_auth_op_type
      and op.target_email = lower(btrim(new.email))
    limit 1;
  end if;

  perform set_config('app.auth_sync_trigger', '1', true);
  begin
    insert into public.profiles (
      id, first_name, last_name, email, role, status, invited_operation_id
    )
    values (
      new.id,
      nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), 100), ''),
      nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'last_name', '')), 100), ''),
      lower(btrim(new.email)),
      'operational_admin'::public.app_role,
      'inactive'::public.profile_status,
      v_matched_op_id
    )
    on conflict (id) do update
      set email = excluded.email,
          invited_operation_id = coalesce(public.profiles.invited_operation_id, excluded.invited_operation_id),
          updated_at = now();
  exception when others then
    perform set_config('app.auth_sync_trigger', '', true);
    raise;
  end;
  perform set_config('app.auth_sync_trigger', '', true);

  return new;
end;
$function$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

-- Trigger de inmutabilidad de PK y columnas protegidas en tablas auditadas
create or replace function private.enforce_row_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_table_name = 'idempotency_keys' then
    raise exception 'public.idempotency_keys es estrictamente inmutable (% no permitido).', tg_op using errcode = '55000';
  end if;

  if tg_table_name = 'operational_settings' then
    if tg_op = 'DELETE' then
      raise exception 'public.operational_settings no puede eliminarse.' using errcode = '55000';
    end if;
    if tg_op = 'INSERT' and new.id <> 1 then
      raise exception 'public.operational_settings solo admite id = 1.' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' and new.id is distinct from old.id then
      raise exception 'No se puede modificar la clave primaria de public.operational_settings.' using errcode = '55000';
    end if;
    return new;
  end if;

  if tg_table_name = 'admin_alerts' then
    if tg_op = 'DELETE' then
      raise exception 'public.admin_alerts no puede eliminarse.' using errcode = '55000';
    end if;
    if tg_op = 'UPDATE' then
      if new.id is distinct from old.id
        or new.audit_log_id is distinct from old.audit_log_id
        or new.title is distinct from old.title
        or new.severity is distinct from old.severity
        or new.created_at is distinct from old.created_at then
        raise exception 'Los campos originales de public.admin_alerts son inmutables.' using errcode = '55000';
      end if;
      if old.status = 'reviewed' then
        raise exception 'Una alerta ya revisada no puede volver a modificarse.' using errcode = 'SF409';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'La clave primaria de %.% es inmutable.', tg_table_schema, tg_table_name using errcode = '55000';
    end if;

    if tg_table_name = 'reservation_tables' then
      if new.reservation_id is distinct from old.reservation_id
        or new.table_id is distinct from old.table_id then
        raise exception 'Las claves foráneas de public.reservation_tables son inmutables.' using errcode = '55000';
      end if;
    elsif tg_table_name = 'profiles' then
      if old.invited_operation_id is not null and new.invited_operation_id is distinct from old.invited_operation_id then
        raise exception 'public.profiles.invited_operation_id es inmutable una vez asignado.' using errcode = '55000';
      end if;
    elsif tg_table_name = 'user_auth_operations' then
      if new.actor_id is distinct from old.actor_id
        or new.idempotency_key is distinct from old.idempotency_key
        or new.request_hash is distinct from old.request_hash
        or new.operation_type is distinct from old.operation_type
        or new.target_email is distinct from old.target_email
        or new.correlation_id is distinct from old.correlation_id
        or new.created_at is distinct from old.created_at then
        raise exception 'Los metadatos iniciales de public.user_auth_operations son inmutables.' using errcode = '55000';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' and tg_table_name = 'user_auth_operations' then
    raise exception 'public.user_auth_operations no puede eliminarse.' using errcode = '55000';
  end if;

  return coalesce(new, old);
end;
$function$;

revoke all on function private.enforce_row_immutability() from public, anon, authenticated, service_role;

drop trigger if exists trg_immutability_tables on public.tables;
create trigger trg_immutability_tables
  before update on public.tables
  for each row execute function private.enforce_row_immutability();

drop trigger if exists trg_immutability_reservations on public.reservations;
create trigger trg_immutability_reservations
  before update on public.reservations
  for each row execute function private.enforce_row_immutability();

drop trigger if exists trg_immutability_reservation_tables on public.reservation_tables;
create trigger trg_immutability_reservation_tables
  before update on public.reservation_tables
  for each row execute function private.enforce_row_immutability();

drop trigger if exists trg_immutability_table_sessions on public.table_sessions;
create trigger trg_immutability_table_sessions
  before update on public.table_sessions
  for each row execute function private.enforce_row_immutability();

drop trigger if exists trg_immutability_operational_settings on public.operational_settings;
create trigger trg_immutability_operational_settings
  before insert or update or delete on public.operational_settings
  for each row execute function private.enforce_row_immutability();

drop trigger if exists trg_immutability_admin_alerts on public.admin_alerts;
create trigger trg_immutability_admin_alerts
  before update or delete on public.admin_alerts
  for each row execute function private.enforce_row_immutability();

drop trigger if exists trg_immutability_profiles on public.profiles;
create trigger trg_immutability_profiles
  before update on public.profiles
  for each row execute function private.enforce_row_immutability();

drop trigger if exists trg_immutability_idempotency_keys on public.idempotency_keys;
create trigger trg_immutability_idempotency_keys
  before update or delete on public.idempotency_keys
  for each row execute function private.enforce_row_immutability();

drop trigger if exists trg_immutability_user_auth_operations on public.user_auth_operations;
create trigger trg_immutability_user_auth_operations
  before update or delete on public.user_auth_operations
  for each row execute function private.enforce_row_immutability();

-- ---------------------------------------------------------------------------
-- 8. Diario DML independiente, triggers de captura, verificación diferida y purga
-- ---------------------------------------------------------------------------
create or replace function private.guard_journal_internal_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_mode text := coalesce(current_setting('app.journal_write_mode', true), '');
begin
  if tg_table_name = '_tx_dml_journal' then
    if tg_op = 'INSERT' then
      if pg_trigger_depth() < 2 or v_mode <> 'capture' then
        raise exception 'Escritura no autorizada en private._tx_dml_journal (INSERT).' using errcode = '42501';
      end if;
      return new;
    elsif tg_op = 'UPDATE' then
      if pg_trigger_depth() >= 2 and v_mode = 'capture' then
        return new;
      end if;
      if pg_trigger_depth() >= 1 and v_mode = 'verify'
        and old.verified_at is null
        and new.verified_at is not null
        and new.txid = old.txid
        and new.target_schema = old.target_schema
        and new.target_table = old.target_table
        and new.row_pk = old.row_pk
        and new.first_op = old.first_op
        and new.last_op = old.last_op
        and new.is_deleted_at_end = old.is_deleted_at_end then
        return new;
      end if;
      raise exception 'Escritura no autorizada en private._tx_dml_journal (UPDATE).' using errcode = '42501';
    elsif tg_op = 'DELETE' then
      if v_mode = 'purge'
        and old.verified_at is not null
        and old.hold_for_investigation = false
        and old.txid < pg_snapshot_xmin(pg_current_snapshot()) then
        return old;
      end if;
      raise exception 'Eliminación no autorizada en private._tx_dml_journal.' using errcode = '42501';
    end if;
  elsif tg_table_name = '_tx_verified_audits' then
    if tg_op = 'INSERT' then
      if pg_trigger_depth() < 1 or v_mode <> 'verify' then
        raise exception 'Escritura no autorizada en private._tx_verified_audits.' using errcode = '42501';
      end if;
      return new;
    elsif tg_op = 'UPDATE' then
      raise exception 'private._tx_verified_audits es inmutable.' using errcode = '55000';
    elsif tg_op = 'DELETE' then
      if v_mode = 'purge' then
        return old;
      end if;
      raise exception 'Eliminación no autorizada en private._tx_verified_audits.' using errcode = '42501';
    end if;
  end if;

  raise exception 'Operación no permitida en tabla privada %.', tg_table_name using errcode = '42501';
end;
$function$;

revoke all on function private.guard_journal_internal_writes() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_tx_dml_journal on private._tx_dml_journal;
create trigger trg_guard_tx_dml_journal
  before insert or update or delete on private._tx_dml_journal
  for each row execute function private.guard_journal_internal_writes();

drop trigger if exists trg_guard_tx_verified_audits on private._tx_verified_audits;
create trigger trg_guard_tx_verified_audits
  before insert or update or delete on private._tx_verified_audits
  for each row execute function private.guard_journal_internal_writes();

create or replace function private.capture_business_dml_tx()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_txid xid8 := pg_current_xact_id();
  v_pk text;
  v_old_json jsonb;
  v_new_json jsonb;
  v_prev_mode text := coalesce(current_setting('app.journal_write_mode', true), '');
  v_trace_item jsonb;
begin
  -- Sincronización automática desde auth.users -> public.profiles fuera de una RPC *_tx
  if tg_table_name = 'profiles'
    and coalesce(current_setting('app.auth_sync_trigger', true), '') = '1'
    and nullif(current_setting('app.tx_operation', true), '') is null
    and pg_trigger_depth() >= 2 then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_new_json := to_jsonb(new);
    v_old_json := null;
    v_pk := v_new_json ->> 'id';
  elsif tg_op = 'UPDATE' then
    v_old_json := to_jsonb(old);
    v_new_json := to_jsonb(new);
    v_pk := v_new_json ->> 'id';
  elsif tg_op = 'DELETE' then
    v_old_json := to_jsonb(old);
    v_new_json := null;
    v_pk := v_old_json ->> 'id';
  else
    raise exception 'Operación DML no soportada en capture_business_dml_tx: %', tg_op using errcode = 'SF500';
  end if;

  if v_pk is null or length(v_pk) = 0 then
    raise exception 'No se pudo extraer clave primaria de %.%.', tg_table_schema, tg_table_name using errcode = 'SF500';
  end if;

  v_trace_item := jsonb_build_object(
    'op', tg_op,
    'at', clock_timestamp(),
    'txOp', nullif(current_setting('app.tx_operation', true), '')
  );

  perform set_config('app.journal_write_mode', 'capture', true);
  begin
    insert into private._tx_dml_journal (
      txid,
      target_schema,
      target_table,
      row_pk,
      first_op,
      last_op,
      row_existed_before_tx,
      first_old_row,
      last_new_row,
      old_pk,
      new_pk,
      is_deleted_at_end,
      has_effective_change,
      mutation_count,
      op_trace,
      verified_at
    ) values (
      v_txid,
      tg_table_schema,
      tg_table_name,
      v_pk,
      tg_op,
      tg_op,
      (tg_op <> 'INSERT'),
      v_old_json,
      v_new_json,
      case when tg_op in ('UPDATE', 'DELETE') then v_pk else null end,
      case when tg_op in ('INSERT', 'UPDATE') then v_pk else null end,
      (tg_op = 'DELETE'),
      (tg_op <> 'UPDATE' or v_new_json is distinct from v_old_json),
      1,
      jsonb_build_array(v_trace_item),
      null
    )
    on conflict (txid, target_schema, target_table, row_pk) do update
      set last_op = excluded.last_op,
          last_new_row = excluded.last_new_row,
          new_pk = excluded.new_pk,
          is_deleted_at_end = excluded.is_deleted_at_end,
          has_effective_change = (
            private._tx_dml_journal.row_existed_before_tx = false
            or excluded.is_deleted_at_end = true
            or excluded.last_new_row is distinct from private._tx_dml_journal.first_old_row
          ),
          mutation_count = private._tx_dml_journal.mutation_count + 1,
          op_trace = private._tx_dml_journal.op_trace || excluded.op_trace,
          verified_at = null;
  exception when others then
    perform set_config('app.journal_write_mode', v_prev_mode, true);
    raise;
  end;
  perform set_config('app.journal_write_mode', v_prev_mode, true);

  return coalesce(new, old);
end;
$function$;

revoke all on function private.capture_business_dml_tx() from public, anon, authenticated, service_role;

drop trigger if exists trg_capture_dml_tables on public.tables;
create trigger trg_capture_dml_tables
  after insert or update or delete on public.tables
  for each row execute function private.capture_business_dml_tx();

drop trigger if exists trg_capture_dml_reservations on public.reservations;
create trigger trg_capture_dml_reservations
  after insert or update or delete on public.reservations
  for each row execute function private.capture_business_dml_tx();

drop trigger if exists trg_capture_dml_reservation_tables on public.reservation_tables;
create trigger trg_capture_dml_reservation_tables
  after insert or update or delete on public.reservation_tables
  for each row execute function private.capture_business_dml_tx();

drop trigger if exists trg_capture_dml_table_sessions on public.table_sessions;
create trigger trg_capture_dml_table_sessions
  after insert or update or delete on public.table_sessions
  for each row execute function private.capture_business_dml_tx();

drop trigger if exists trg_capture_dml_operational_settings on public.operational_settings;
create trigger trg_capture_dml_operational_settings
  after insert or update or delete on public.operational_settings
  for each row execute function private.capture_business_dml_tx();

drop trigger if exists trg_capture_dml_admin_alerts on public.admin_alerts;
create trigger trg_capture_dml_admin_alerts
  after insert or update or delete on public.admin_alerts
  for each row execute function private.capture_business_dml_tx();

drop trigger if exists trg_capture_dml_profiles on public.profiles;
create trigger trg_capture_dml_profiles
  after insert or update or delete on public.profiles
  for each row execute function private.capture_business_dml_tx();

drop trigger if exists trg_capture_dml_user_auth_operations on public.user_auth_operations;
create trigger trg_capture_dml_user_auth_operations
  after insert or update or delete on public.user_auth_operations
  for each row execute function private.capture_business_dml_tx();

-- Verificador diferido integral de auditoría vs diario DML
create or replace function private.verify_audit_tx_commit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_txid xid8 := pg_current_xact_id();
  v_audit_count integer;
  v_audit record;
  v_idem_count integer;
  v_idem record;
  v_journal_count integer;
  v_ephemeral_count integer;
  v_now timestamptz := now();
  v_prev_mode text := coalesce(current_setting('app.journal_write_mode', true), '');
  v_cnt_tables integer := 0;
  v_cnt_reservations integer := 0;
  v_cnt_res_tables integer := 0;
  v_cnt_sessions integer := 0;
  v_cnt_settings integer := 0;
  v_cnt_alerts integer := 0;
  v_cnt_alerts_ins integer := 0;
  v_cnt_alerts_upd integer := 0;
  v_cnt_profiles integer := 0;
  v_cnt_auth_ops integer := 0;
  v_unlinked_alerts integer := 0;
  v_expected_primary_pk text;
begin
  if coalesce(current_setting('app.tx_verify_in_progress', true), '') = '1' then
    return null;
  end if;

  -- Si toda la transacción ya fue sellada y no hay filas sin verificar ni auditorías sin sello, salir rápido.
  if exists (select 1 from private._tx_verified_audits where txid = v_txid)
    and not exists (select 1 from private._tx_dml_journal where txid = v_txid and verified_at is null)
    and not exists (
      select 1 from public.audit_logs a
      where a.created_txid = v_txid
        and not exists (select 1 from private._tx_verified_audits va where va.audit_log_id = a.id)
    ) then
    return null;
  end if;

  perform set_config('app.tx_verify_in_progress', '1', true);
  begin
    select count(*) into v_audit_count
    from public.audit_logs
    where created_txid = v_txid;

    if v_audit_count <> 1 then
      raise exception 'Violación de invariante mono-evento de auditoría: se esperaban 1 fila en audit_logs para tx %, encontradas %.', v_txid, v_audit_count
        using errcode = 'SF500';
    end if;

    select * into v_audit
    from public.audit_logs
    where created_txid = v_txid;

    if v_audit.is_primary_idempotency_event is distinct from true
      or v_audit.operation is null
      or v_audit.idempotency_key is null
      or v_audit.status <> 'success' then
      raise exception 'Registro de auditoría primario inválido para tx %.', v_txid using errcode = 'SF500';
    end if;

    select count(*) into v_idem_count
    from public.idempotency_keys
    where created_txid = v_txid;

    if v_idem_count <> 1 then
      raise exception 'Se esperaba exactamente 1 registro de idempotencia para tx %, encontrados %.', v_txid, v_idem_count
        using errcode = 'SF500';
    end if;

    select * into v_idem
    from public.idempotency_keys
    where created_txid = v_txid;

    if v_idem.actor_id <> v_audit.actor_id
      or v_idem.idempotency_key <> v_audit.idempotency_key
      or v_idem.operation <> v_audit.operation
      or v_idem.primary_audit_id is distinct from v_audit.id then
      raise exception 'Desajuste entre idempotency_keys y audit_logs para tx %.', v_txid using errcode = 'SF500';
    end if;

    select count(*) into v_journal_count
    from private._tx_dml_journal
    where txid = v_txid;

    if v_journal_count < 1 then
      raise exception 'El registro de auditoría (%) no cubre ninguna mutación de negocio en tx %.', v_audit.operation, v_txid
        using errcode = 'SF500';
    end if;

    select count(*) into v_ephemeral_count
    from private._tx_dml_journal
    where txid = v_txid
      and row_existed_before_tx = false
      and is_deleted_at_end = true;

    if v_ephemeral_count > 0 then
      raise exception 'Se detectaron mutaciones efímeras (INSERT+DELETE dentro de la misma tx %).', v_txid
        using errcode = 'SF500';
    end if;

    select
      count(*) filter (where target_table = 'tables'),
      count(*) filter (where target_table = 'reservations'),
      count(*) filter (where target_table = 'reservation_tables'),
      count(*) filter (where target_table = 'table_sessions'),
      count(*) filter (where target_table = 'operational_settings'),
      count(*) filter (where target_table = 'admin_alerts'),
      count(*) filter (where target_table = 'admin_alerts' and first_op = 'INSERT'),
      count(*) filter (where target_table = 'admin_alerts' and first_op = 'UPDATE'),
      count(*) filter (where target_table = 'profiles'),
      count(*) filter (where target_table = 'user_auth_operations')
    into
      v_cnt_tables, v_cnt_reservations, v_cnt_res_tables, v_cnt_sessions,
      v_cnt_settings, v_cnt_alerts, v_cnt_alerts_ins, v_cnt_alerts_upd,
      v_cnt_profiles, v_cnt_auth_ops
    from private._tx_dml_journal
    where txid = v_txid and target_schema = 'public';

    if v_cnt_alerts_ins > 0 then
      select count(*) into v_unlinked_alerts
      from public.admin_alerts al
      join private._tx_dml_journal j
        on j.txid = v_txid and j.target_schema = 'public' and j.target_table = 'admin_alerts' and j.row_pk = al.id::text
      where al.audit_log_id <> v_audit.id;

      if v_unlinked_alerts > 0 then
        raise exception 'Existen alertas administrativas en tx % no enlazadas al evento primario de auditoría.', v_txid
          using errcode = 'SF500';
      end if;
    end if;

    -- Matriz cerrada de cobertura exacta por operación
    case v_audit.operation
      when 'create_table' then
        if v_cnt_tables <> 1 or (v_cnt_reservations + v_cnt_res_tables + v_cnt_sessions + v_cnt_settings + v_cnt_alerts_upd + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para create_table en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'tables' and first_op = 'INSERT' and is_deleted_at_end = false;
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la mesa creada.' using errcode = 'SF500';
        end if;

      when 'delete_virgin_table' then
        if v_cnt_tables <> 1 or (v_cnt_reservations + v_cnt_res_tables + v_cnt_sessions + v_cnt_settings + v_cnt_alerts_upd + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para delete_virgin_table en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'tables' and is_deleted_at_end = true;
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la mesa eliminada.' using errcode = 'SF500';
        end if;

      when 'change_table_capacity' then
        if v_cnt_tables <> 1 or v_cnt_alerts_ins <> 1 or v_cnt_alerts_upd > 0
          or (v_cnt_reservations + v_cnt_res_tables + v_cnt_sessions + v_cnt_settings + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para change_table_capacity en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'tables' and last_op = 'UPDATE';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la mesa modificada.' using errcode = 'SF500';
        end if;

      when 'set_table_status' then
        if v_cnt_tables <> 1 or v_cnt_alerts_upd > 0
          or (v_cnt_reservations + v_cnt_res_tables + v_cnt_sessions + v_cnt_settings + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para set_table_status en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'tables' and last_op = 'UPDATE';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la mesa modificada.' using errcode = 'SF500';
        end if;

      when 'initialize_floor_plan' then
        if v_cnt_tables < 1
          or (v_cnt_reservations + v_cnt_res_tables + v_cnt_sessions + v_cnt_settings + v_cnt_alerts_upd + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para initialize_floor_plan en tx %.', v_txid using errcode = 'SF500';
        end if;

      when 'update_operational_settings' then
        if v_cnt_settings <> 1 or v_cnt_alerts_upd > 0
          or (v_cnt_tables + v_cnt_reservations + v_cnt_res_tables + v_cnt_sessions + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para update_operational_settings en tx %.', v_txid using errcode = 'SF500';
        end if;

      when 'review_admin_alert' then
        if v_cnt_alerts_upd <> 1 or v_cnt_alerts_ins > 0
          or (v_cnt_tables + v_cnt_reservations + v_cnt_res_tables + v_cnt_sessions + v_cnt_settings + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para review_admin_alert en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'admin_alerts' and last_op = 'UPDATE';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la alerta revisada.' using errcode = 'SF500';
        end if;

      when 'create_reservation' then
        if v_cnt_reservations <> 1 or v_cnt_res_tables < 1
          or (v_cnt_sessions + v_cnt_settings + v_cnt_alerts + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para create_reservation en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'reservations' and first_op = 'INSERT';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la reserva creada.' using errcode = 'SF500';
        end if;

      when 'cancel_reservation' then
        if v_cnt_reservations <> 1 or v_cnt_res_tables > 0 or v_cnt_alerts_ins <> 1 or v_cnt_alerts_upd > 0
          or (v_cnt_settings + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para cancel_reservation en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'reservations' and last_op = 'UPDATE';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la reserva cancelada.' using errcode = 'SF500';
        end if;
        if exists (
          select 1 from private._tx_dml_journal
          where txid = v_txid and target_table = 'table_sessions'
            and coalesce(last_new_row, first_old_row) ->> 'reservation_id' is distinct from v_audit.entity_id
        ) then
          raise exception 'Las sesiones cerradas en cancel_reservation no pertenecen a la reserva auditada.' using errcode = 'SF500';
        end if;

      when 'reassign_reservation_tables' then
        if v_cnt_res_tables < 1 or v_cnt_reservations > 1 or v_cnt_sessions > 0
          or (v_cnt_settings + v_cnt_alerts_upd + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para reassign_reservation_tables en tx %.', v_txid using errcode = 'SF500';
        end if;
        if exists (
          select 1 from private._tx_dml_journal
          where txid = v_txid and target_table = 'reservation_tables'
            and coalesce(last_new_row, first_old_row) ->> 'reservation_id' is distinct from v_audit.entity_id
        ) then
          raise exception 'Las asignaciones modificadas en reassign_reservation_tables no pertenecen a la reserva auditada.' using errcode = 'SF500';
        end if;

      when 'seat_reservation' then
        if v_cnt_reservations <> 1 or v_cnt_sessions < 1 or v_cnt_tables < 1
          or (v_cnt_res_tables + v_cnt_settings + v_cnt_alerts + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para seat_reservation en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'reservations' and last_op = 'UPDATE';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la reserva sentada.' using errcode = 'SF500';
        end if;
        if exists (
          select 1 from private._tx_dml_journal
          where txid = v_txid and target_table = 'table_sessions'
            and coalesce(last_new_row, first_old_row) ->> 'reservation_id' is distinct from v_audit.entity_id
        ) then
          raise exception 'Las sesiones creadas en seat_reservation no pertenecen a la reserva auditada.' using errcode = 'SF500';
        end if;

      when 'no_show_reservation' then
        if v_cnt_reservations <> 1
          or (v_cnt_res_tables + v_cnt_sessions + v_cnt_settings + v_cnt_alerts_upd + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para no_show_reservation en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'reservations' and last_op = 'UPDATE';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la reserva no_show.' using errcode = 'SF500';
        end if;

      when 'complete_service' then
        if v_cnt_reservations <> 1 or v_cnt_sessions < 1 or v_cnt_tables < 1
          or (v_cnt_res_tables + v_cnt_settings + v_cnt_alerts + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para complete_service en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'reservations' and last_op = 'UPDATE';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la reserva completada.' using errcode = 'SF500';
        end if;
        if exists (
          select 1 from private._tx_dml_journal
          where txid = v_txid and target_table = 'table_sessions'
            and coalesce(last_new_row, first_old_row) ->> 'reservation_id' is distinct from v_audit.entity_id
        ) then
          raise exception 'Las sesiones cerradas en complete_service no pertenecen a la reserva auditada.' using errcode = 'SF500';
        end if;

      when 'open_walk_in_session' then
        if v_cnt_sessions <> 1 or v_cnt_tables <> 1
          or (v_cnt_reservations + v_cnt_res_tables + v_cnt_settings + v_cnt_alerts + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para open_walk_in_session en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'table_sessions' and first_op = 'INSERT';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la sesión walk-in abierta.' using errcode = 'SF500';
        end if;

      when 'extend_table_session' then
        if v_cnt_sessions <> 1
          or (v_cnt_tables + v_cnt_reservations + v_cnt_res_tables + v_cnt_settings + v_cnt_alerts + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para extend_table_session en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'table_sessions' and last_op = 'UPDATE';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la sesión extendida.' using errcode = 'SF500';
        end if;

      when 'close_walk_in_session' then
        if v_cnt_sessions <> 1 or v_cnt_tables <> 1
          or (v_cnt_reservations + v_cnt_res_tables + v_cnt_settings + v_cnt_alerts + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para close_walk_in_session en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'table_sessions' and last_op = 'UPDATE';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la sesión walk-in cerrada.' using errcode = 'SF500';
        end if;

      when 'release_table_operational' then
        if v_cnt_tables <> 1 or v_cnt_sessions > 1 or v_cnt_alerts_ins <> 1 or v_cnt_alerts_upd > 0
          or (v_cnt_reservations + v_cnt_res_tables + v_cnt_settings + v_cnt_profiles + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para release_table_operational en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'tables' and last_op = 'UPDATE';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la mesa liberada.' using errcode = 'SF500';
        end if;
        if exists (
          select 1 from private._tx_dml_journal
          where txid = v_txid and target_table = 'table_sessions'
            and (
              coalesce(last_new_row, first_old_row) ->> 'table_id' is distinct from v_audit.entity_id
              or coalesce(last_new_row, first_old_row) ->> 'session_type' is distinct from 'walk_in'
            )
        ) then
          raise exception 'release_table_operational solo puede cerrar una sesión walk_in de la mesa auditada.' using errcode = 'SF500';
        end if;

      when 'set_user_profile_status' then
        if v_cnt_profiles <> 1 or v_cnt_alerts_upd > 0
          or (v_cnt_tables + v_cnt_reservations + v_cnt_res_tables + v_cnt_sessions + v_cnt_settings + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para set_user_profile_status en tx %.', v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'profiles' and last_op = 'UPDATE';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con el perfil actualizado.' using errcode = 'SF500';
        end if;

      when 'transfer_user_profile_role' then
        if v_cnt_profiles < 1 or v_cnt_profiles > 2 or v_cnt_alerts_ins <> 1 or v_cnt_alerts_upd > 0
          or (v_cnt_tables + v_cnt_reservations + v_cnt_res_tables + v_cnt_sessions + v_cnt_settings + v_cnt_auth_ops) > 0 then
          raise exception 'Cobertura inválida para transfer_user_profile_role en tx %.', v_txid using errcode = 'SF500';
        end if;

      when 'begin_user_auth_operation', 'mark_user_auth_dispatched', 'fail_user_auth_operation' then
        if v_cnt_auth_ops <> 1 or v_cnt_alerts_upd > 0
          or (v_cnt_tables + v_cnt_reservations + v_cnt_res_tables + v_cnt_sessions + v_cnt_settings + v_cnt_profiles) > 0 then
          raise exception 'Cobertura inválida para % en tx %.', v_audit.operation, v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'user_auth_operations';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la operación Auth.' using errcode = 'SF500';
        end if;

      when 'complete_user_auth_operation', 'reconcile_user_auth_operation' then
        if v_cnt_auth_ops <> 1 or v_cnt_profiles > 1 or v_cnt_alerts_upd > 0
          or (v_cnt_tables + v_cnt_reservations + v_cnt_res_tables + v_cnt_sessions + v_cnt_settings) > 0 then
          raise exception 'Cobertura inválida para % en tx %.', v_audit.operation, v_txid using errcode = 'SF500';
        end if;
        select row_pk into v_expected_primary_pk from private._tx_dml_journal
        where txid = v_txid and target_table = 'user_auth_operations';
        if v_expected_primary_pk is distinct from v_audit.entity_id then
          raise exception 'entity_id de auditoría no coincide con la operación Auth.' using errcode = 'SF500';
        end if;

      else
        raise exception 'Operación de auditoría desconocida o no permitida: %.', v_audit.operation using errcode = 'SF500';
    end case;

    perform set_config('app.journal_write_mode', 'verify', true);
    begin
      update private._tx_dml_journal
      set verified_at = v_now
      where txid = v_txid and verified_at is null;

      insert into private._tx_verified_audits (audit_log_id, txid, verified_at)
      values (v_audit.id, v_txid, v_now)
      on conflict (audit_log_id) do nothing;
    exception when others then
      perform set_config('app.journal_write_mode', v_prev_mode, true);
      raise;
    end;
    perform set_config('app.journal_write_mode', v_prev_mode, true);
  exception when others then
    perform set_config('app.tx_verify_in_progress', '', true);
    raise;
  end;
  perform set_config('app.tx_verify_in_progress', '', true);

  return null;
end;
$function$;

revoke all on function private.verify_audit_tx_commit() from public, anon, authenticated, service_role;

drop trigger if exists trg_verify_dml_journal_commit on private._tx_dml_journal;
create constraint trigger trg_verify_dml_journal_commit
  after insert or update on private._tx_dml_journal
  deferrable initially deferred
  for each row
  when (new.verified_at is null)
  execute function private.verify_audit_tx_commit();

drop trigger if exists trg_verify_audit_logs_commit on public.audit_logs;
create constraint trigger trg_verify_audit_logs_commit
  after insert on public.audit_logs
  deferrable initially deferred
  for each row
  execute function private.verify_audit_tx_commit();

-- Purga controlada del diario DML (separada del tráfico comercial; nunca toca public.audit_logs)
create or replace function private.purge_dml_journal_tx(
  p_retention interval default interval '7 days',
  p_batch_limit integer default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_run_id uuid;
  v_xmin xid8;
  v_deleted_journal integer := 0;
  v_deleted_seals integer := 0;
  v_unverified_stale integer := 0;
  v_prev_mode text := coalesce(current_setting('app.journal_write_mode', true), '');
  v_purged_txids xid8[];
begin
  if nullif(current_setting('app.tx_operation', true), '') is not null then
    raise exception 'La purga del diario DML no puede ejecutarse dentro de una operación comercial.' using errcode = '55000';
  end if;

  if p_retention < interval '24 hours' or p_retention > interval '30 days' then
    raise exception 'La retención del diario DML debe estar entre 24 hours y 30 days.' using errcode = '22023';
  end if;

  if p_batch_limit is null or p_batch_limit < 100 or p_batch_limit > 50000 then
    raise exception 'El tamaño de lote debe estar entre 100 y 50000.' using errcode = '22023';
  end if;

  insert into private.journal_purge_runs (status)
  values ('running')
  returning id into v_run_id;

  v_xmin := pg_snapshot_xmin(pg_current_snapshot());

  select count(*) into v_unverified_stale
  from private._tx_dml_journal
  where verified_at is null
    and txid < v_xmin
    and created_at < now() - interval '1 hour';

  perform set_config('app.journal_write_mode', 'purge', true);
  begin
    with candidates as (
      select txid, target_schema, target_table, row_pk
      from private._tx_dml_journal
      where txid < v_xmin
        and verified_at is not null
        and verified_at < now() - p_retention
        and hold_for_investigation = false
      order by verified_at asc
      limit p_batch_limit
    ),
    deleted_rows as (
      delete from private._tx_dml_journal j
      using candidates c
      where j.txid = c.txid
        and j.target_schema = c.target_schema
        and j.target_table = c.target_table
        and j.row_pk = c.row_pk
      returning j.txid
    )
    select count(*), coalesce(array_agg(distinct txid), '{}')
    into v_deleted_journal, v_purged_txids
    from deleted_rows;

    if cardinality(v_purged_txids) > 0 then
      with deleted_seals as (
        delete from private._tx_verified_audits va
        where va.txid = any(v_purged_txids)
          and not exists (
            select 1 from private._tx_dml_journal j where j.txid = va.txid
          )
        returning va.audit_log_id
      )
      select count(*) into v_deleted_seals from deleted_seals;
    end if;
  exception when others then
    perform set_config('app.journal_write_mode', v_prev_mode, true);
    update private.journal_purge_runs
    set finished_at = now(),
        xmin_used = v_xmin,
        status = 'failure',
        error_message = sqlerrm
    where id = v_run_id;
    raise;
  end;
  perform set_config('app.journal_write_mode', v_prev_mode, true);

  update private.journal_purge_runs
  set finished_at = now(),
      xmin_used = v_xmin,
      deleted_journal_rows = v_deleted_journal,
      deleted_seal_rows = v_deleted_seals,
      unverified_stale_count = v_unverified_stale,
      status = 'success'
  where id = v_run_id;

  return jsonb_build_object(
    'runId', v_run_id,
    'xminUsed', v_xmin::text,
    'deletedJournalRows', v_deleted_journal,
    'deletedSealRows', v_deleted_seals,
    'unverifiedStaleCount', v_unverified_stale
  );
end;
$function$;

revoke all on function private.purge_dml_journal_tx(interval, integer) from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (
      select 1 from cron.job where jobname = 'sofia_purge_dml_journal_daily'
    ) then
      perform cron.schedule(
        'sofia_purge_dml_journal_daily',
        '15 4 * * *',
        'select private.purge_dml_journal_tx(interval ''7 days'', 5000);'
      );
    end if;
  end if;
exception
  when insufficient_privilege or undefined_table then
    raise notice 'pg_cron no disponible o sin permisos; ejecute private.purge_dml_journal_tx manualmente en mantenimiento.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Helpers transaccionales internos (bloqueo, idempotencia, cierre y estado de mesas)
-- ---------------------------------------------------------------------------
create or replace function private.begin_tx_rpc(
  p_actor_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_request_hash text,
  p_require_super_admin boolean default false
)
returns table (
  is_replay boolean,
  cached_response jsonb,
  actor_role public.app_role,
  actor_email text,
  actor_first_name text,
  actor_last_name text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_hash text := btrim(coalesce(p_request_hash, ''));
  v_actor record;
  v_existing record;
begin
  if nullif(current_setting('app.tx_operation', true), '') is not null
    or pg_trigger_depth() > 0 then
    raise exception 'No se permite anidar operaciones transaccionales *_tx dentro de la misma transacción.'
      using errcode = '55000';
  end if;

  if length(v_key) < 8 or length(v_key) > 128 then
    raise exception 'Se requiere idempotency_key válida (8 a 128 caracteres).' using errcode = '22023';
  end if;

  if length(v_hash) < 16 or length(v_hash) > 128 then
    raise exception 'Se requiere request_hash válido (16 a 128 caracteres).' using errcode = '22023';
  end if;

  if p_actor_id is null then
    raise exception 'Actor no especificado.' using errcode = '42501';
  end if;

  set constraints private.trg_verify_dml_journal_commit, public.trg_verify_audit_logs_commit deferred;
  perform set_config('app.tx_operation', p_operation, true);

  select id, role, status, email, first_name, last_name
  into v_actor
  from public.profiles
  where id = p_actor_id and status = 'active'::public.profile_status;

  if not found then
    raise exception 'Actor no autorizado o inactivo.' using errcode = '42501';
  end if;

  if p_require_super_admin and v_actor.role <> 'super_admin'::public.app_role then
    raise exception 'Operación reservada exclusivamente para el Administrador Principal activo.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('sofia_idem'),
    hashtext(p_actor_id::text || ':' || v_key)
  );

  select operation, request_hash, response_body
  into v_existing
  from public.idempotency_keys
  where actor_id = p_actor_id and idempotency_key = v_key;

  if found then
    if v_existing.operation <> p_operation or v_existing.request_hash <> v_hash then
      raise exception 'Conflicto de idempotencia: la clave ya fue utilizada con otra operación o payload.'
        using errcode = 'SF409';
    end if;

    perform set_config('app.tx_operation', '', true);
    return query select true, v_existing.response_body, v_actor.role, v_actor.email, v_actor.first_name, v_actor.last_name;
    return;
  end if;

  return query select false, null::jsonb, v_actor.role, v_actor.email, v_actor.first_name, v_actor.last_name;
end;
$function$;

revoke all on function private.begin_tx_rpc(uuid, text, text, text, boolean) from public, anon, authenticated, service_role;

create or replace function private.finish_tx_rpc(
  p_actor_id uuid,
  p_actor_role public.app_role,
  p_operation text,
  p_idempotency_key text,
  p_request_hash text,
  p_entity text,
  p_entity_id text,
  p_action text,
  p_old_values jsonb,
  p_new_values jsonb,
  p_reason text,
  p_related_table_id text,
  p_related_reservation_id text,
  p_response_body jsonb,
  p_alert_title text default null,
  p_alert_severity text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key text := btrim(p_idempotency_key);
  v_hash text := btrim(p_request_hash);
  v_audit_id uuid;
  v_alert_id uuid;
  v_final_body jsonb := coalesce(p_response_body, '{}'::jsonb);
begin
  insert into public.audit_logs (
    actor_id,
    actor_role,
    action,
    entity,
    entity_id,
    old_values,
    new_values,
    status,
    reason,
    related_table_id,
    related_reservation_id,
    created_txid,
    idempotency_key,
    operation,
    is_primary_idempotency_event
  ) values (
    p_actor_id,
    p_actor_role,
    p_action,
    p_entity,
    p_entity_id,
    p_old_values,
    p_new_values,
    'success',
    p_reason,
    p_related_table_id,
    p_related_reservation_id,
    pg_current_xact_id(),
    v_key,
    p_operation,
    true
  ) returning id into v_audit_id;

  v_final_body := jsonb_set(v_final_body, '{auditId}', to_jsonb(v_audit_id), true);

  if p_alert_title is not null then
    insert into public.admin_alerts (
      audit_log_id, title, severity, status
    ) values (
      v_audit_id,
      left(p_alert_title, 150),
      coalesce(p_alert_severity, 'info'),
      'pending'
    ) returning id into v_alert_id;

    v_final_body := jsonb_set(v_final_body, '{alertId}', to_jsonb(v_alert_id), true);
  end if;

  insert into public.idempotency_keys (
    actor_id,
    idempotency_key,
    operation,
    request_hash,
    created_txid,
    primary_audit_id,
    response_status,
    response_body
  ) values (
    p_actor_id,
    v_key,
    p_operation,
    v_hash,
    pg_current_xact_id(),
    v_audit_id,
    200,
    v_final_body
  );

  set constraints private.trg_verify_dml_journal_commit, public.trg_verify_audit_logs_commit immediate;
  set constraints private.trg_verify_dml_journal_commit, public.trg_verify_audit_logs_commit deferred;
  perform set_config('app.tx_operation', '', true);

  return v_final_body;
end;
$function$;

revoke all on function private.finish_tx_rpc(
  uuid, public.app_role, text, text, text, text, text, text, jsonb, jsonb, text, text, text, jsonb, text, text
) from public, anon, authenticated, service_role;

create or replace function private.recompute_table_availability(p_table_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tid uuid;
  v_tbl record;
  v_has_open_session boolean;
  v_has_active_res boolean;
  v_target_status public.table_status;
begin
  if p_table_ids is null or cardinality(p_table_ids) = 0 then
    return;
  end if;

  for v_tid in
    select distinct id
    from public.tables
    where id = any(p_table_ids)
    order by id asc
  loop
    select id, status, is_active into v_tbl
    from public.tables
    where id = v_tid
    for update;

    if not found then
      continue;
    end if;

    if v_tbl.is_active = false or v_tbl.status = 'out_of_service'::public.table_status then
      continue;
    end if;

    select exists (
      select 1 from public.table_sessions ts
      where ts.table_id = v_tid and ts.ended_at is null
    ) into v_has_open_session;

    if v_has_open_session then
      v_target_status := 'occupied'::public.table_status;
    else
      select exists (
        select 1
        from public.reservation_tables rt
        join public.reservations r on r.id = rt.reservation_id
        where rt.table_id = v_tid
          and r.status::text in ('confirmed', 'seated')
          and r.end_time > now()
      ) into v_has_active_res;

      if v_has_active_res then
        v_target_status := 'reserved'::public.table_status;
      else
        v_target_status := 'available'::public.table_status;
      end if;
    end if;

    if v_tbl.status is distinct from v_target_status then
      update public.tables
      set status = v_target_status,
          updated_at = now()
      where id = v_tid;
    end if;
  end loop;
end;
$function$;

revoke all on function private.recompute_table_availability(uuid[]) from public, anon, authenticated, service_role;

-- Actualización del trigger anti-solapamiento para considerar buffer operativo
create or replace function public.check_table_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_conflict_count integer;
  v_current_res record;
  v_table record;
  v_buffer interval := interval '15 minutes';
  v_buffer_mins integer;
begin
  select id, status, is_active into v_table
  from public.tables
  where id = new.table_id
  for update;

  if not found then
    raise exception 'Mesa no encontrada: %', new.table_id using errcode = 'P0002';
  end if;

  if v_table.is_active = false or v_table.status = 'out_of_service'::public.table_status then
    raise exception 'La mesa seleccionada (ID %) está inactiva o fuera de servicio.', new.table_id
      using errcode = 'P0001';
  end if;

  select id, start_time, end_time, status into v_current_res
  from public.reservations
  where id = new.reservation_id;

  if not found then
    raise exception 'Reserva no encontrada: %', new.reservation_id using errcode = 'P0002';
  end if;

  if v_current_res.status::text not in ('confirmed', 'seated') then
    return new;
  end if;

  select reservation_buffer_minutes into v_buffer_mins
  from public.operational_settings where id = 1;
  v_buffer := make_interval(mins => coalesce(v_buffer_mins, 15));

  select count(*) into v_conflict_count
  from public.reservation_tables rt
  join public.reservations r on r.id = rt.reservation_id
  where rt.table_id = new.table_id
    and rt.reservation_id <> new.reservation_id
    and r.status::text in ('confirmed', 'seated')
    and ((r.start_time - v_buffer) < v_current_res.end_time and (r.end_time + v_buffer) > v_current_res.start_time);

  if v_conflict_count > 0 then
    raise exception 'Conflicto de asignación: La mesa % ya cuenta con una reserva activa (incluyendo buffer operativo) en esa franja horaria.', new.table_id
      using errcode = '23P01';
  end if;

  return new;
end;
$function$;

revoke all on function public.check_table_overlap() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Limpieza de firmas previas de Migración 4 antes de crear RPCs v5
-- ---------------------------------------------------------------------------
drop function if exists public.change_table_capacity_tx(uuid, integer, text, boolean, uuid);
drop function if exists public.set_table_status_tx(uuid, public.table_status, text, text, uuid);
drop function if exists public.cancel_reservation_tx(uuid, text, uuid);
drop function if exists public.create_reservation_with_tables_tx(text, text, text, integer, timestamptz, integer, uuid[], text, uuid);
drop function if exists public.initialize_floor_plan_tx(jsonb, boolean, text, uuid);

-- ---------------------------------------------------------------------------
-- 11. RPCs de Salón, Mesas, Configuración Operativa y Alertas
-- ---------------------------------------------------------------------------

-- 11.1 create_table_tx
create or replace function public.create_table_tx(
  p_number integer,
  p_sector text,
  p_capacity integer,
  p_max_capacity integer,
  p_shape text,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_sector text := coalesce(nullif(btrim(p_sector), ''), 'Salón Principal');
  v_shape text := coalesce(nullif(btrim(p_shape), ''), 'square');
  v_max integer := coalesce(p_max_capacity, p_capacity);
  v_new_id uuid;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'create_table', p_idempotency_key, p_request_hash, false);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_number is null or p_number < 1 or p_number > 9999 then
    raise exception 'Número de mesa inválido.' using errcode = '22003';
  end if;
  if p_capacity is null or p_capacity < 1 or p_capacity > 30 then
    raise exception 'Capacidad inválida (1 a 30).' using errcode = '22003';
  end if;
  if v_max < p_capacity or v_max > 40 then
    raise exception 'Capacidad máxima inválida (debe ser >= capacidad y <= 40).' using errcode = '22003';
  end if;
  if v_shape not in ('round', 'square', 'rectangle') then
    raise exception 'Forma de mesa inválida (round, square, rectangle).' using errcode = '22023';
  end if;

  if exists (select 1 from public.tables where number = p_number) then
    raise exception 'Ya existe una mesa con el número %.', p_number using errcode = 'SF409';
  end if;

  insert into public.tables (
    number, sector, capacity, max_capacity, shape, status, is_active
  ) values (
    p_number, v_sector, p_capacity, v_max, v_shape, 'available'::public.table_status, true
  ) returning id into v_new_id;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'create_table',
    p_idempotency_key,
    p_request_hash,
    'table',
    v_new_id::text,
    'table.created',
    null,
    jsonb_build_object(
      'number', p_number, 'sector', v_sector, 'capacity', p_capacity,
      'maxCapacity', v_max, 'shape', v_shape, 'status', 'available', 'isActive', true
    ),
    coalesce(nullif(btrim(p_reason), ''), 'Alta de mesa en catálogo del salón'),
    v_new_id::text,
    null,
    jsonb_build_object(
      'id', v_new_id, 'number', p_number, 'sector', v_sector,
      'capacity', p_capacity, 'maxCapacity', v_max, 'shape', v_shape,
      'status', 'available', 'isActive', true
    ),
    null,
    null
  );
end;
$function$;

-- 11.2 delete_virgin_table_tx
create or replace function public.delete_virgin_table_tx(
  p_table_id uuid,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_table record;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'delete_virgin_table', p_idempotency_key, p_request_hash, true);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'Debe indicar motivo para eliminar la mesa (mínimo 5 caracteres).' using errcode = '22023';
  end if;

  select * into v_table from public.tables where id = p_table_id for update;
  if not found then
    raise exception 'Mesa no encontrada.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.reservation_tables where table_id = p_table_id)
    or exists (select 1 from public.table_sessions where table_id = p_table_id) then
    raise exception 'La mesa % tiene historial operativo (reservas o sesiones) y no puede eliminarse; desactívela con set_table_status_tx.', v_table.number
      using errcode = 'SF409';
  end if;

  delete from public.tables where id = p_table_id;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'delete_virgin_table',
    p_idempotency_key,
    p_request_hash,
    'table',
    p_table_id::text,
    'table.deleted',
    jsonb_build_object(
      'number', v_table.number, 'sector', v_table.sector,
      'capacity', v_table.capacity, 'status', v_table.status
    ),
    null,
    btrim(p_reason),
    p_table_id::text,
    null,
    jsonb_build_object('deleted', true, 'id', p_table_id, 'number', v_table.number),
    'Mesa ' || v_table.number || ' eliminada del catálogo (sin historial)',
    'info'
  );
end;
$function$;

-- 11.3 change_table_capacity_tx (p_force nunca viola capacidad comprometida SUM(tables.capacity) >= guests_count)
create or replace function public.change_table_capacity_tx(
  p_table_id uuid,
  p_new_capacity integer,
  p_reason text,
  p_force boolean,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_table record;
  v_force boolean := coalesce(p_force, false);
  v_new_max integer;
  v_res record;
  v_new_sum integer;
  v_open_session record;
  v_lock_ids uuid[];
  v_affected_res_count integer := 0;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'change_table_capacity', p_idempotency_key, p_request_hash, false);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_new_capacity is null or p_new_capacity < 1 or p_new_capacity > 30 then
    raise exception 'Capacidad inválida: debe ser entre 1 y 30.' using errcode = '22003';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'Se requiere un motivo detallado (mínimo 5 caracteres).' using errcode = '22023';
  end if;

  if v_force then
    if v_ctx.actor_role <> 'super_admin'::public.app_role then
      raise exception 'Solo el Administrador Principal activo puede confirmar cambios con p_force.' using errcode = '42501';
    end if;
    if length(btrim(p_reason)) < 10 then
      raise exception 'Cuando p_force=true se requiere un motivo detallado (mínimo 10 caracteres).' using errcode = '22023';
    end if;
  end if;

  select array_agg(distinct tbl_id order by tbl_id asc) into v_lock_ids
  from (
    select p_table_id as tbl_id
    union
    select rt2.table_id as tbl_id
    from public.reservation_tables rt1
    join public.reservations r on r.id = rt1.reservation_id
    join public.reservation_tables rt2 on rt2.reservation_id = r.id
    where rt1.table_id = p_table_id
      and r.status::text in ('confirmed', 'seated')
  ) q;

  perform 1 from public.tables where id = any(v_lock_ids) order by id asc for update;

  select * into v_table from public.tables where id = p_table_id;
  if not found then
    raise exception 'Mesa no encontrada.' using errcode = 'P0002';
  end if;

  -- Invariante duro: ninguna reducción puede romper SUM(capacity) >= guests_count de reservas activas ni sesiones abiertas
  for v_res in
    select r.id, r.customer_name, r.guests_count
    from public.reservations r
    join public.reservation_tables rt on rt.reservation_id = r.id
    where rt.table_id = p_table_id
      and r.status::text in ('confirmed', 'seated')
    order by r.id asc
    for update of r
  loop
    v_affected_res_count := v_affected_res_count + 1;
    select coalesce(sum(case when t.id = p_table_id then p_new_capacity else t.capacity end), 0)
    into v_new_sum
    from public.reservation_tables rt2
    join public.tables t on t.id = rt2.table_id
    where rt2.reservation_id = v_res.id;

    if v_new_sum < v_res.guests_count then
      raise exception 'Invariante de capacidad: la reserva de % (% comensales) quedaría con capacidad combinada insuficiente (%). Reasigne mesas primero.',
        v_res.customer_name, v_res.guests_count, v_new_sum
        using errcode = 'SF422';
    end if;
  end loop;

  select id, guests_count into v_open_session
  from public.table_sessions
  where table_id = p_table_id and ended_at is null and session_type = 'walk_in'::public.table_session_type
  for update;

  if found and v_open_session.guests_count is not null and p_new_capacity < v_open_session.guests_count then
    raise exception 'Invariante de capacidad: la sesión walk-in abierta tiene % comensales y no admite capacidad %.',
      v_open_session.guests_count, p_new_capacity
      using errcode = 'SF422';
  end if;

  v_new_max := greatest(p_new_capacity, v_table.max_capacity);

  update public.tables
  set capacity = p_new_capacity,
      max_capacity = v_new_max,
      updated_at = now()
  where id = p_table_id;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'change_table_capacity',
    p_idempotency_key,
    p_request_hash,
    'table',
    p_table_id::text,
    'table.capacity_changed',
    jsonb_build_object('capacity', v_table.capacity, 'maxCapacity', v_table.max_capacity),
    jsonb_build_object(
      'capacity', p_new_capacity, 'maxCapacity', v_new_max,
      'forced', v_force, 'activeReservationsVerified', v_affected_res_count
    ),
    btrim(p_reason),
    p_table_id::text,
    null,
    jsonb_build_object(
      'id', v_table.id, 'number', v_table.number, 'sector', v_table.sector,
      'capacity', p_new_capacity, 'maxCapacity', v_new_max, 'shape', v_table.shape,
      'status', v_table.status, 'isActive', v_table.is_active
    ),
    'Mesa ' || v_table.number || ': capacidad modificada de ' || v_table.capacity || ' a ' || p_new_capacity,
    'warning'
  );
end;
$function$;

-- 11.4 set_table_status_tx (sin cancelación ni reasignación implícita de reservas)
create or replace function public.set_table_status_tx(
  p_table_id uuid,
  p_status public.table_status,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_table record;
  v_open_sessions integer := 0;
  v_active_res integer := 0;
  v_action text;
  v_alert_title text := null;
  v_alert_sev text := null;
  v_new_active boolean;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'set_table_status', p_idempotency_key, p_request_hash, false);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_status not in ('available'::public.table_status, 'out_of_service'::public.table_status) then
    raise exception 'set_table_status_tx solo admite estados available u out_of_service; use sesiones de mesa para occupied.'
      using errcode = 'SF409';
  end if;

  select * into v_table from public.tables where id = p_table_id for update;
  if not found then
    raise exception 'Mesa no encontrada.' using errcode = 'P0002';
  end if;

  if p_status = 'out_of_service'::public.table_status then
    if p_reason is null or length(btrim(p_reason)) < 5 then
      raise exception 'Para desactivar una mesa es obligatorio indicar motivo (mínimo 5 caracteres).' using errcode = '22023';
    end if;

    select count(*) into v_open_sessions
    from public.table_sessions
    where table_id = p_table_id and ended_at is null;

    if v_open_sessions > 0 then
      raise exception 'No se puede desactivar la mesa % porque tiene una sesión abierta.', v_table.number
        using errcode = 'SF409';
    end if;

    select count(*) into v_active_res
    from public.reservations r
    join public.reservation_tables rt on rt.reservation_id = r.id
    where rt.table_id = p_table_id
      and r.status::text in ('confirmed', 'seated');

    if v_active_res > 0 then
      raise exception 'La mesa % tiene % reserva(s) activa(s). Cancele o reasigne esas reservas antes de desactivarla.', v_table.number, v_active_res
        using errcode = 'SF409';
    end if;

    v_new_active := false;
    v_action := 'table.deactivated';
    v_alert_title := 'Mesa ' || v_table.number || ' (' || v_table.sector || ') fuera de servicio';
    v_alert_sev := 'warning';
  else
    v_new_active := true;
    if v_table.status = 'out_of_service'::public.table_status or v_table.is_active = false then
      v_action := 'table.reactivated';
      v_alert_title := 'Mesa ' || v_table.number || ' reactivada para el servicio';
      v_alert_sev := 'info';
    else
      v_action := 'table.status_changed';
    end if;
  end if;

  update public.tables
  set status = p_status,
      is_active = v_new_active,
      updated_at = now()
  where id = p_table_id;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'set_table_status',
    p_idempotency_key,
    p_request_hash,
    'table',
    p_table_id::text,
    v_action,
    jsonb_build_object('status', v_table.status, 'isActive', v_table.is_active),
    jsonb_build_object('status', p_status, 'isActive', v_new_active),
    coalesce(nullif(btrim(p_reason), ''), 'Actualización de estado operativo de mesa'),
    p_table_id::text,
    null,
    jsonb_build_object(
      'id', v_table.id, 'number', v_table.number, 'sector', v_table.sector,
      'capacity', v_table.capacity, 'maxCapacity', v_table.max_capacity, 'shape', v_table.shape,
      'status', p_status, 'isActive', v_new_active
    ),
    v_alert_title,
    v_alert_sev
  );
end;
$function$;

-- 11.5 initialize_floor_plan_tx (bloqueo ordenado, prohibido DELETE con historial)
create or replace function public.initialize_floor_plan_tx(
  p_tables jsonb,
  p_wipe boolean,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_item jsonb;
  v_num integer;
  v_cap integer;
  v_max_cap integer;
  v_sec text;
  v_shape text;
  v_incoming_numbers integer[] := '{}';
  v_removed_ids uuid[];
  v_virgin_ids uuid[];
  v_historic_ids uuid[];
  v_conflicts integer := 0;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'initialize_floor_plan', p_idempotency_key, p_request_hash, true);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_tables is null or jsonb_array_length(p_tables) = 0 then
    raise exception 'Debe proporcionar al menos una mesa para el plano.' using errcode = '22023';
  end if;

  -- Bloqueo determinista de todo el catálogo existente
  perform 1 from public.tables order by id asc for update;

  for v_item in select * from jsonb_array_elements(p_tables)
  loop
    v_num := (v_item->>'number')::integer;
    if v_num is null or v_num < 1 then
      raise exception 'Número de mesa inválido en el plano.' using errcode = '22023';
    end if;
    if v_num = any(v_incoming_numbers) then
      raise exception 'Número de mesa duplicado en el plano: %.', v_num using errcode = '22023';
    end if;
    v_incoming_numbers := array_append(v_incoming_numbers, v_num);
  end loop;

  if coalesce(p_wipe, false) then
    select array_agg(id order by id asc) into v_removed_ids
    from public.tables
    where not (number = any(v_incoming_numbers));

    if v_removed_ids is not null and cardinality(v_removed_ids) > 0 then
      select count(*) into v_conflicts
      from public.reservations r
      join public.reservation_tables rt on rt.reservation_id = r.id
      where rt.table_id = any(v_removed_ids)
        and r.status::text in ('confirmed', 'seated');

      if v_conflicts > 0 then
        raise exception 'Existen % reserva(s) activa(s) sobre mesas retiradas del plano.', v_conflicts
          using errcode = 'SF409';
      end if;

      if exists (select 1 from public.table_sessions where table_id = any(v_removed_ids) and ended_at is null) then
        raise exception 'Existen sesiones abiertas sobre mesas retiradas del plano.' using errcode = 'SF409';
      end if;

      select array_agg(t.id order by t.id asc) into v_historic_ids
      from public.tables t
      where t.id = any(v_removed_ids)
        and (
          exists (select 1 from public.reservation_tables rt where rt.table_id = t.id)
          or exists (select 1 from public.table_sessions ts where ts.table_id = t.id)
        );

      select array_agg(t.id order by t.id asc) into v_virgin_ids
      from public.tables t
      where t.id = any(v_removed_ids)
        and not (t.id = any(coalesce(v_historic_ids, '{}')));

      if v_historic_ids is not null and cardinality(v_historic_ids) > 0 then
        update public.tables
        set is_active = false,
            status = 'out_of_service'::public.table_status,
            updated_at = now()
        where id = any(v_historic_ids);
      end if;

      if v_virgin_ids is not null and cardinality(v_virgin_ids) > 0 then
        delete from public.tables where id = any(v_virgin_ids);
      end if;
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_tables)
  loop
    v_num := (v_item->>'number')::integer;
    v_cap := (v_item->>'capacity')::integer;
    v_max_cap := coalesce((v_item->>'maxCapacity')::integer, v_cap);
    v_sec := coalesce(nullif(btrim(v_item->>'sector'), ''), 'Salón Principal');
    v_shape := coalesce(nullif(btrim(v_item->>'shape'), ''), 'square');
    if v_shape not in ('round', 'square', 'rectangle') then
      v_shape := 'square';
    end if;

    insert into public.tables (number, sector, capacity, max_capacity, shape, status, is_active, updated_at)
    values (v_num, v_sec, v_cap, v_max_cap, v_shape, 'available'::public.table_status, true, now())
    on conflict (number) do update
      set sector = excluded.sector,
          capacity = excluded.capacity,
          max_capacity = greatest(excluded.max_capacity, public.tables.max_capacity),
          shape = excluded.shape,
          is_active = true,
          status = case
            when public.tables.status = 'out_of_service'::public.table_status then 'available'::public.table_status
            else public.tables.status
          end,
          updated_at = now();
  end loop;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'initialize_floor_plan',
    p_idempotency_key,
    p_request_hash,
    'tables',
    'salon-layout',
    'floorplan.reinitialized',
    null,
    jsonb_build_object(
      'tablesCount', jsonb_array_length(p_tables),
      'wipeExisting', coalesce(p_wipe, false),
      'deactivatedHistoricCount', coalesce(cardinality(v_historic_ids), 0),
      'deletedVirginCount', coalesce(cardinality(v_virgin_ids), 0)
    ),
    coalesce(nullif(btrim(p_reason), ''), 'Actualización de plano arquitectónico de salón'),
    null,
    null,
    jsonb_build_object('status', 'success', 'count', jsonb_array_length(p_tables)),
    null,
    null
  );
end;
$function$;

-- 11.6 update_operational_settings_tx
create or replace function public.update_operational_settings_tx(
  p_default_reservation_duration_minutes integer,
  p_default_walk_in_duration_minutes integer,
  p_reservation_buffer_minutes integer,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_old record;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'update_operational_settings', p_idempotency_key, p_request_hash, true);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_default_reservation_duration_minutes < 30 or p_default_reservation_duration_minutes > 360 then
    raise exception 'Duración de reserva por defecto inválida (30 a 360).' using errcode = '22003';
  end if;
  if p_default_walk_in_duration_minutes < 30 or p_default_walk_in_duration_minutes > 360 then
    raise exception 'Duración de walk-in por defecto inválida (30 a 360).' using errcode = '22003';
  end if;
  if p_reservation_buffer_minutes < 0 or p_reservation_buffer_minutes > 60 then
    raise exception 'Buffer entre reservas inválido (0 a 60).' using errcode = '22003';
  end if;

  select * into v_old from public.operational_settings where id = 1 for update;

  update public.operational_settings
  set default_reservation_duration_minutes = p_default_reservation_duration_minutes,
      default_walk_in_duration_minutes = p_default_walk_in_duration_minutes,
      reservation_buffer_minutes = p_reservation_buffer_minutes,
      updated_by = p_actor_id,
      updated_at = now()
  where id = 1;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'update_operational_settings',
    p_idempotency_key,
    p_request_hash,
    'operational_settings',
    '1',
    'settings.updated',
    jsonb_build_object(
      'defaultReservationDurationMinutes', v_old.default_reservation_duration_minutes,
      'defaultWalkInDurationMinutes', v_old.default_walk_in_duration_minutes,
      'reservationBufferMinutes', v_old.reservation_buffer_minutes
    ),
    jsonb_build_object(
      'defaultReservationDurationMinutes', p_default_reservation_duration_minutes,
      'defaultWalkInDurationMinutes', p_default_walk_in_duration_minutes,
      'reservationBufferMinutes', p_reservation_buffer_minutes
    ),
    coalesce(nullif(btrim(p_reason), ''), 'Actualización de parámetros operativos del salón'),
    null,
    null,
    jsonb_build_object(
      'defaultReservationDurationMinutes', p_default_reservation_duration_minutes,
      'defaultWalkInDurationMinutes', p_default_walk_in_duration_minutes,
      'reservationBufferMinutes', p_reservation_buffer_minutes
    ),
    null,
    null
  );
end;
$function$;

-- 11.7 review_admin_alert_tx
create or replace function public.review_admin_alert_tx(
  p_alert_id uuid,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_alert record;
  v_now timestamptz := now();
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'review_admin_alert', p_idempotency_key, p_request_hash, true);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  select * into v_alert from public.admin_alerts where id = p_alert_id for update;
  if not found then
    raise exception 'Alerta administrativa no encontrada.' using errcode = 'P0002';
  end if;

  if v_alert.status = 'reviewed' then
    raise exception 'La alerta ya fue marcada como revisada.' using errcode = 'SF409';
  end if;

  update public.admin_alerts
  set status = 'reviewed',
      reviewed_at = v_now,
      reviewed_by = p_actor_id
  where id = p_alert_id;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'review_admin_alert',
    p_idempotency_key,
    p_request_hash,
    'admin_alert',
    p_alert_id::text,
    'admin_alert.reviewed',
    jsonb_build_object('status', v_alert.status),
    jsonb_build_object('status', 'reviewed', 'reviewedAt', v_now, 'reviewedBy', p_actor_id),
    coalesce(nullif(btrim(p_reason), ''), 'Revisión administrativa de alerta'),
    null,
    null,
    jsonb_build_object(
      'id', p_alert_id,
      'status', 'reviewed',
      'reviewedAt', v_now,
      'reviewedBy', p_actor_id
    ),
    null,
    null
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 12. RPCs de Ciclo de Vida de Reservas y Sesiones de Mesa
-- ---------------------------------------------------------------------------

-- 12.1 create_reservation_with_tables_tx
create or replace function public.create_reservation_with_tables_tx(
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_guests_count integer,
  p_start_time timestamptz,
  p_duration_minutes integer,
  p_table_ids uuid[],
  p_notes text,
  p_created_by uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_end_time timestamptz;
  v_res_date date;
  v_total_capacity integer := 0;
  v_tbl_count integer := 0;
  v_conflicts integer := 0;
  v_session_conflicts integer := 0;
  v_res_id uuid;
  v_tid uuid;
  v_buffer interval;
  v_buffer_mins integer;
  v_dur integer;
begin
  select * into v_ctx from private.begin_tx_rpc(p_created_by, 'create_reservation', p_idempotency_key, p_request_hash, false);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_customer_name is null or length(btrim(p_customer_name)) < 2 then
    raise exception 'Nombre del cliente requerido (mínimo 2 caracteres).' using errcode = '22023';
  end if;
  if p_guests_count is null or p_guests_count < 1 or p_guests_count > 50 then
    raise exception 'Cantidad de comensales inválida (1 a 50).' using errcode = '22003';
  end if;

  select default_reservation_duration_minutes, reservation_buffer_minutes
  into v_dur, v_buffer_mins
  from public.operational_settings where id = 1;

  v_dur := coalesce(p_duration_minutes, v_dur, 120);
  if v_dur < 30 or v_dur > 360 then
    raise exception 'Duración de reserva inválida (30 a 360 minutos).' using errcode = '22003';
  end if;

  if p_start_time is null then
    raise exception 'Fecha y hora de inicio requeridas.' using errcode = '22023';
  end if;

  if p_table_ids is null or cardinality(p_table_ids) = 0 then
    raise exception 'Debe asignar al menos una mesa a la reserva.' using errcode = '22023';
  end if;

  if cardinality(p_table_ids) <> (select count(distinct x) from unnest(p_table_ids) as x) then
    raise exception 'La lista de mesas contiene identificadores duplicados.' using errcode = '22023';
  end if;

  v_buffer := make_interval(mins => coalesce(v_buffer_mins, 15));
  v_end_time := p_start_time + make_interval(mins => v_dur);
  v_res_date := ((p_start_time at time zone 'America/Argentina/Buenos_Aires') - interval '5 hours')::date;

  select coalesce(sum(capacity), 0), count(*)
  into v_total_capacity, v_tbl_count
  from (
    select capacity
    from public.tables
    where id = any(p_table_ids)
    order by id asc
    for update
  ) locked_tbls;

  if v_tbl_count <> cardinality(p_table_ids) then
    raise exception 'Una o más mesas especificadas no existen.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.tables
    where id = any(p_table_ids) and (status = 'out_of_service'::public.table_status or is_active = false)
  ) then
    raise exception 'No se pueden asignar mesas inactivas o fuera de servicio.' using errcode = 'P0001';
  end if;

  if v_total_capacity < p_guests_count then
    raise exception 'La capacidad combinada de las mesas (%) es menor a los comensales (%).', v_total_capacity, p_guests_count
      using errcode = '23P01';
  end if;

  select count(*) into v_conflicts
  from public.reservation_tables rt
  join public.reservations r on r.id = rt.reservation_id
  where rt.table_id = any(p_table_ids)
    and r.status::text in ('confirmed', 'seated')
    and ((r.start_time - v_buffer) < v_end_time and (r.end_time + v_buffer) > p_start_time);

  if v_conflicts > 0 then
    raise exception 'Conflicto de asignación: una o más mesas tienen reservas activas (incluyendo buffer) en esa franja.'
      using errcode = '23P01';
  end if;

  select count(*) into v_session_conflicts
  from public.table_sessions ts
  where ts.table_id = any(p_table_ids)
    and ts.ended_at is null
    and (ts.started_at < v_end_time and (ts.estimated_end_at + v_buffer) > p_start_time);

  if v_session_conflicts > 0 then
    raise exception 'Conflicto de asignación: una o más mesas tienen una sesión abierta cuya ventana estimada se solapa con la reserva.'
      using errcode = '23P01';
  end if;

  insert into public.reservations (
    customer_name, customer_phone, customer_email,
    guests_count, reservation_date, start_time, end_time,
    duration_minutes, status, notes, created_by
  ) values (
    btrim(p_customer_name), nullif(btrim(p_customer_phone), ''), nullif(lower(btrim(p_customer_email)), ''),
    p_guests_count, v_res_date, p_start_time, v_end_time,
    v_dur, 'confirmed'::public.reservation_status, nullif(btrim(p_notes), ''), p_created_by
  ) returning id into v_res_id;

  for v_tid in select unnest(p_table_ids) order by 1 asc
  loop
    insert into public.reservation_tables (reservation_id, table_id)
    values (v_res_id, v_tid);
  end loop;

  perform private.recompute_table_availability(p_table_ids);

  return private.finish_tx_rpc(
    p_created_by,
    v_ctx.actor_role,
    'create_reservation',
    p_idempotency_key,
    p_request_hash,
    'reservation',
    v_res_id::text,
    'reservation.created',
    null,
    jsonb_build_object(
      'customerName', btrim(p_customer_name),
      'guestsCount', p_guests_count,
      'startTime', p_start_time,
      'endTime', v_end_time,
      'durationMinutes', v_dur,
      'tableIds', p_table_ids
    ),
    'Creación y asignación atómica de reserva',
    null,
    v_res_id::text,
    jsonb_build_object(
      'id', v_res_id,
      'customerName', btrim(p_customer_name),
      'guestsCount', p_guests_count,
      'reservationDate', v_res_date,
      'startTime', p_start_time,
      'endTime', v_end_time,
      'durationMinutes', v_dur,
      'status', 'confirmed',
      'tableIds', p_table_ids
    ),
    null,
    null
  );
end;
$function$;

-- 12.2 cancel_reservation_tx (soporta confirmed y cierre excepcional de seated)
create or replace function public.cancel_reservation_tx(
  p_reservation_id uuid,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_res record;
  v_table_ids uuid[];
  v_first_tbl_id uuid;
  v_first_tbl_num integer;
  v_open_sessions integer := 0;
  v_closed_sessions integer := 0;
  v_now timestamptz := now();
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'cancel_reservation', p_idempotency_key, p_request_hash, false);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_reason is null or length(btrim(p_reason)) < 4 then
    raise exception 'Debe ingresar el motivo de cancelación (mínimo 4 caracteres).' using errcode = '22023';
  end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reserva no encontrada.' using errcode = 'P0002';
  end if;

  if v_res.status::text not in ('confirmed', 'seated') then
    raise exception 'Solo pueden cancelarse reservas en estado confirmed o seated (estado actual: %).', v_res.status
      using errcode = 'SF409';
  end if;

  select array_agg(rt.table_id order by rt.table_id asc)
  into v_table_ids
  from public.reservation_tables rt
  where rt.reservation_id = p_reservation_id;

  if v_table_ids is not null and cardinality(v_table_ids) > 0 then
    perform 1 from public.tables where id = any(v_table_ids) order by id asc for update;
    select t.id, t.number into v_first_tbl_id, v_first_tbl_num
    from public.tables t
    where t.id = any(v_table_ids)
    order by t.number asc
    limit 1;
  end if;

  if v_res.status::text = 'confirmed' then
    select count(*) into v_open_sessions
    from public.table_sessions
    where reservation_id = p_reservation_id and ended_at is null;

    if v_open_sessions > 0 then
      raise exception 'Inconsistencia crítica: reserva confirmed con sesiones abiertas.' using errcode = 'SF500';
    end if;
  else
    with closed as (
      update public.table_sessions
      set ended_at = v_now,
          close_reason = 'reservation_cancelled'::public.session_close_reason,
          ended_by = p_actor_id,
          updated_at = v_now
      where reservation_id = p_reservation_id
        and session_type = 'reservation'::public.table_session_type
        and ended_at is null
      returning id
    )
    select count(*) into v_closed_sessions from closed;
  end if;

  update public.reservations
  set status = 'cancelled'::public.reservation_status,
      cancellation_reason = btrim(p_reason),
      cancelled_by = p_actor_id,
      updated_at = v_now
  where id = p_reservation_id;

  perform private.recompute_table_availability(v_table_ids);

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'cancel_reservation',
    p_idempotency_key,
    p_request_hash,
    'reservation',
    p_reservation_id::text,
    'reservation.cancelled',
    jsonb_build_object('status', v_res.status),
    jsonb_build_object('status', 'cancelled', 'closedSessionsCount', v_closed_sessions),
    btrim(p_reason),
    v_first_tbl_id::text,
    p_reservation_id::text,
    jsonb_build_object(
      'id', v_res.id,
      'customerName', v_res.customer_name,
      'guestsCount', v_res.guests_count,
      'previousStatus', v_res.status,
      'status', 'cancelled',
      'closedSessionsCount', v_closed_sessions,
      'cancellationReason', btrim(p_reason),
      'cancelledBy', p_actor_id
    ),
    'Cancelación de reserva: ' || v_res.customer_name || coalesce(' (Mesa ' || v_first_tbl_num || ')', ''),
    'warning'
  );
end;
$function$;

-- 12.3 reassign_reservation_tables_tx
create or replace function public.reassign_reservation_tables_tx(
  p_reservation_id uuid,
  p_new_table_ids uuid[],
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_res record;
  v_old_table_ids uuid[];
  v_all_lock_ids uuid[];
  v_total_capacity integer := 0;
  v_tbl_count integer := 0;
  v_conflicts integer := 0;
  v_session_conflicts integer := 0;
  v_buffer interval;
  v_buffer_mins integer;
  v_tid uuid;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'reassign_reservation_tables', p_idempotency_key, p_request_hash, false);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_new_table_ids is null or cardinality(p_new_table_ids) = 0 then
    raise exception 'Debe especificar al menos una nueva mesa.' using errcode = '22023';
  end if;

  if cardinality(p_new_table_ids) <> (select count(distinct x) from unnest(p_new_table_ids) as x) then
    raise exception 'La nueva lista de mesas contiene duplicados.' using errcode = '22023';
  end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reserva no encontrada.' using errcode = 'P0002';
  end if;

  if v_res.status::text <> 'confirmed' then
    raise exception 'Solo se pueden reasignar mesas de reservas en estado confirmed (actual: %).', v_res.status
      using errcode = 'SF409';
  end if;

  select coalesce(array_agg(rt.table_id order by rt.table_id asc), '{}')
  into v_old_table_ids
  from public.reservation_tables rt
  where rt.reservation_id = p_reservation_id;

  if v_old_table_ids = (select coalesce(array_agg(x order by x asc), '{}') from unnest(p_new_table_ids) as x) then
    raise exception 'Las mesas seleccionadas ya coinciden con la asignación actual de la reserva.'
      using errcode = 'SF409';
  end if;

  select array_agg(distinct x order by x asc)
  into v_all_lock_ids
  from unnest(v_old_table_ids || p_new_table_ids) as x;

  perform 1 from public.tables where id = any(v_all_lock_ids) order by id asc for update;

  select coalesce(sum(capacity), 0), count(*)
  into v_total_capacity, v_tbl_count
  from public.tables
  where id = any(p_new_table_ids);

  if v_tbl_count <> cardinality(p_new_table_ids) then
    raise exception 'Una o más mesas seleccionadas no existen.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.tables
    where id = any(p_new_table_ids) and (is_active = false or status = 'out_of_service'::public.table_status)
  ) then
    raise exception 'No se pueden asignar mesas inactivas o fuera de servicio.' using errcode = 'P0001';
  end if;

  if v_total_capacity < v_res.guests_count then
    raise exception 'La capacidad combinada (%) es menor a los comensales (%).', v_total_capacity, v_res.guests_count
      using errcode = 'SF422';
  end if;

  select reservation_buffer_minutes into v_buffer_mins from public.operational_settings where id = 1;
  v_buffer := make_interval(mins => coalesce(v_buffer_mins, 15));

  select count(*) into v_conflicts
  from public.reservation_tables rt
  join public.reservations r on r.id = rt.reservation_id
  where rt.table_id = any(p_new_table_ids)
    and r.id <> p_reservation_id
    and r.status::text in ('confirmed', 'seated')
    and ((r.start_time - v_buffer) < v_res.end_time and (r.end_time + v_buffer) > v_res.start_time);

  if v_conflicts > 0 then
    raise exception 'Conflicto de horario en una o más de las nuevas mesas.' using errcode = '23P01';
  end if;

  select count(*) into v_session_conflicts
  from public.table_sessions ts
  where ts.table_id = any(p_new_table_ids)
    and ts.ended_at is null
    and (ts.started_at < v_res.end_time and (ts.estimated_end_at + v_buffer) > v_res.start_time);

  if v_session_conflicts > 0 then
    raise exception 'Conflicto con sesión abierta en una o más de las nuevas mesas.' using errcode = '23P01';
  end if;

  delete from public.reservation_tables
  where reservation_id = p_reservation_id
    and not (table_id = any(p_new_table_ids));

  for v_tid in select unnest(p_new_table_ids) order by 1 asc
  loop
    insert into public.reservation_tables (reservation_id, table_id)
    select p_reservation_id, v_tid
    where not exists (
      select 1 from public.reservation_tables
      where reservation_id = p_reservation_id and table_id = v_tid
    );
  end loop;

  update public.reservations set updated_at = now() where id = p_reservation_id;
  perform private.recompute_table_availability(v_all_lock_ids);

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'reassign_reservation_tables',
    p_idempotency_key,
    p_request_hash,
    'reservation',
    p_reservation_id::text,
    'reservation.tables_reassigned',
    jsonb_build_object('tableIds', v_old_table_ids),
    jsonb_build_object('tableIds', p_new_table_ids),
    coalesce(nullif(btrim(p_reason), ''), 'Reasignación de mesas de reserva'),
    null,
    p_reservation_id::text,
    jsonb_build_object(
      'id', p_reservation_id,
      'previousTableIds', v_old_table_ids,
      'tableIds', p_new_table_ids
    ),
    null,
    null
  );
end;
$function$;

-- 12.4 seat_reservation_tx
create or replace function public.seat_reservation_tx(
  p_reservation_id uuid,
  p_expected_duration_minutes integer,
  p_notes text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_res record;
  v_table_ids uuid[];
  v_dur integer;
  v_now timestamptz := now();
  v_est_end timestamptz;
  v_tid uuid;
  v_sess_id uuid;
  v_session_ids uuid[] := '{}';
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'seat_reservation', p_idempotency_key, p_request_hash, false);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reserva no encontrada.' using errcode = 'P0002';
  end if;

  if v_res.status::text <> 'confirmed' then
    raise exception 'Solo se pueden sentar reservas en estado confirmed (actual: %).', v_res.status
      using errcode = 'SF409';
  end if;

  select array_agg(rt.table_id order by rt.table_id asc)
  into v_table_ids
  from public.reservation_tables rt
  where rt.reservation_id = p_reservation_id;

  if v_table_ids is null or cardinality(v_table_ids) = 0 then
    raise exception 'La reserva no tiene mesas asignadas.' using errcode = 'SF500';
  end if;

  perform 1 from public.tables where id = any(v_table_ids) order by id asc for update;

  if exists (
    select 1 from public.tables
    where id = any(v_table_ids)
      and (is_active = false or status in ('out_of_service'::public.table_status, 'occupied'::public.table_status))
  ) then
    raise exception 'Una o más mesas asignadas están fuera de servicio o ya ocupadas.' using errcode = 'SF409';
  end if;

  if exists (
    select 1 from public.table_sessions
    where table_id = any(v_table_ids) and ended_at is null
  ) then
    raise exception 'Una o más mesas asignadas ya tienen una sesión abierta.' using errcode = 'SF409';
  end if;

  v_dur := coalesce(p_expected_duration_minutes, v_res.duration_minutes, 120);
  if v_dur < 15 or v_dur > 480 then
    raise exception 'Duración esperada inválida (15 a 480 minutos).' using errcode = '22003';
  end if;
  v_est_end := v_now + make_interval(mins => v_dur);

  update public.reservations
  set status = 'seated'::public.reservation_status,
      seated_at = v_now,
      seated_by = p_actor_id,
      updated_at = v_now
  where id = p_reservation_id;

  foreach v_tid in array v_table_ids
  loop
    insert into public.table_sessions (
      table_id, reservation_id, session_type, guests_count,
      started_at, expected_duration_minutes, estimated_end_at, started_by, notes
    ) values (
      v_tid, p_reservation_id, 'reservation'::public.table_session_type, v_res.guests_count,
      v_now, v_dur, v_est_end, p_actor_id, nullif(btrim(p_notes), '')
    ) returning id into v_sess_id;
    v_session_ids := array_append(v_session_ids, v_sess_id);
  end loop;

  perform private.recompute_table_availability(v_table_ids);

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'seat_reservation',
    p_idempotency_key,
    p_request_hash,
    'reservation',
    p_reservation_id::text,
    'reservation.seated',
    jsonb_build_object('status', 'confirmed'),
    jsonb_build_object('status', 'seated', 'seatedAt', v_now, 'sessionIds', v_session_ids),
    'Check-in y apertura de sesión de reserva',
    v_table_ids[1]::text,
    p_reservation_id::text,
    jsonb_build_object(
      'id', p_reservation_id,
      'status', 'seated',
      'seatedAt', v_now,
      'tableIds', v_table_ids,
      'sessionIds', v_session_ids,
      'estimatedEndAt', v_est_end
    ),
    null,
    null
  );
end;
$function$;

-- 12.5 no_show_reservation_tx
create or replace function public.no_show_reservation_tx(
  p_reservation_id uuid,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_res record;
  v_table_ids uuid[];
  v_now timestamptz := now();
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'no_show_reservation', p_idempotency_key, p_request_hash, false);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reserva no encontrada.' using errcode = 'P0002';
  end if;

  if v_res.status::text <> 'confirmed' then
    raise exception 'Solo reservas confirmed pueden marcarse como no_show (actual: %).', v_res.status
      using errcode = 'SF409';
  end if;

  if exists (select 1 from public.table_sessions where reservation_id = p_reservation_id and ended_at is null) then
    raise exception 'La reserva tiene sesiones abiertas y no puede marcarse como no_show.' using errcode = 'SF500';
  end if;

  select coalesce(array_agg(rt.table_id order by rt.table_id asc), '{}')
  into v_table_ids
  from public.reservation_tables rt
  where rt.reservation_id = p_reservation_id;

  perform 1 from public.tables where id = any(v_table_ids) order by id asc for update;

  update public.reservations
  set status = 'no_show'::public.reservation_status,
      no_show_at = v_now,
      no_show_by = p_actor_id,
      cancellation_reason = coalesce(nullif(btrim(p_reason), ''), cancellation_reason),
      updated_at = v_now
  where id = p_reservation_id;

  perform private.recompute_table_availability(v_table_ids);

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'no_show_reservation',
    p_idempotency_key,
    p_request_hash,
    'reservation',
    p_reservation_id::text,
    'reservation.no_show',
    jsonb_build_object('status', 'confirmed'),
    jsonb_build_object('status', 'no_show', 'noShowAt', v_now),
    coalesce(nullif(btrim(p_reason), ''), 'Ausencia del cliente (no-show)'),
    null,
    p_reservation_id::text,
    jsonb_build_object('id', p_reservation_id, 'status', 'no_show', 'noShowAt', v_now),
    null,
    null
  );
end;
$function$;

-- 12.6 complete_service_tx (biyección estricta 1-a-1 entre reservation_tables y sesiones abiertas)
create or replace function public.complete_service_tx(
  p_reservation_id uuid,
  p_notes text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_res record;
  v_expected_table_ids uuid[];
  v_open_table_ids uuid[];
  v_closed_session_ids uuid[];
  v_now timestamptz := now();
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'complete_service', p_idempotency_key, p_request_hash, false);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reserva no encontrada.' using errcode = 'P0002';
  end if;

  if v_res.status::text <> 'seated' then
    raise exception 'Solo reservas en estado seated pueden finalizar servicio (actual: %).', v_res.status
      using errcode = 'SF409';
  end if;

  select coalesce(array_agg(rt.table_id order by rt.table_id asc), '{}')
  into v_expected_table_ids
  from public.reservation_tables rt
  where rt.reservation_id = p_reservation_id;

  perform 1 from public.tables where id = any(v_expected_table_ids) order by id asc for update;

  select coalesce(array_agg(ts.table_id order by ts.table_id asc), '{}')
  into v_open_table_ids
  from public.table_sessions ts
  where ts.reservation_id = p_reservation_id
    and ts.session_type = 'reservation'::public.table_session_type
    and ts.ended_at is null;

  if cardinality(v_expected_table_ids) = 0 or v_expected_table_ids <> v_open_table_ids then
    raise exception 'Inconsistencia crítica: las mesas asignadas (%) no coinciden exactamente 1-a-1 con las sesiones abiertas (%).',
      v_expected_table_ids, v_open_table_ids
      using errcode = 'SF500';
  end if;

  update public.reservations
  set status = 'completed'::public.reservation_status,
      completed_at = v_now,
      completed_by = p_actor_id,
      updated_at = v_now
  where id = p_reservation_id;

  with closed as (
    update public.table_sessions
    set ended_at = v_now,
        close_reason = 'service_completed'::public.session_close_reason,
        ended_by = p_actor_id,
        notes = coalesce(nullif(btrim(p_notes), ''), notes),
        updated_at = v_now
    where reservation_id = p_reservation_id
      and session_type = 'reservation'::public.table_session_type
      and ended_at is null
    returning id
  )
  select array_agg(id order by id asc) into v_closed_session_ids from closed;

  perform private.recompute_table_availability(v_expected_table_ids);

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'complete_service',
    p_idempotency_key,
    p_request_hash,
    'reservation',
    p_reservation_id::text,
    'reservation.service_completed',
    jsonb_build_object('status', 'seated'),
    jsonb_build_object('status', 'completed', 'completedAt', v_now, 'closedSessionIds', v_closed_session_ids),
    coalesce(nullif(btrim(p_notes), ''), 'Finalización de servicio y liberación de mesas'),
    v_expected_table_ids[1]::text,
    p_reservation_id::text,
    jsonb_build_object(
      'id', p_reservation_id,
      'status', 'completed',
      'completedAt', v_now,
      'closedSessionIds', v_closed_session_ids,
      'tableIds', v_expected_table_ids
    ),
    null,
    null
  );
end;
$function$;

-- 12.7 open_walk_in_session_tx
create or replace function public.open_walk_in_session_tx(
  p_table_id uuid,
  p_guests_count integer,
  p_expected_duration_minutes integer,
  p_notes text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_table record;
  v_dur integer;
  v_buffer_mins integer;
  v_buffer interval;
  v_now timestamptz := now();
  v_est_end timestamptz;
  v_sess_id uuid;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'open_walk_in_session', p_idempotency_key, p_request_hash, false);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  select * into v_table from public.tables where id = p_table_id for update;
  if not found then
    raise exception 'Mesa no encontrada.' using errcode = 'P0002';
  end if;

  if v_table.is_active = false or v_table.status = 'out_of_service'::public.table_status then
    raise exception 'La mesa % está inactiva o fuera de servicio.', v_table.number using errcode = 'P0001';
  end if;

  if exists (select 1 from public.table_sessions where table_id = p_table_id and ended_at is null) then
    raise exception 'La mesa % ya tiene una sesión abierta.', v_table.number using errcode = 'SF409';
  end if;

  if p_guests_count is not null and (p_guests_count < 1 or p_guests_count > v_table.capacity) then
    raise exception 'Cantidad de comensales (%) excede la capacidad de la mesa (%).', p_guests_count, v_table.capacity
      using errcode = 'SF422';
  end if;

  select default_walk_in_duration_minutes, reservation_buffer_minutes
  into v_dur, v_buffer_mins
  from public.operational_settings where id = 1;

  v_dur := coalesce(p_expected_duration_minutes, v_dur, 90);
  if v_dur < 15 or v_dur > 480 then
    raise exception 'Duración esperada inválida (15 a 480 minutos).' using errcode = '22003';
  end if;

  v_buffer := make_interval(mins => coalesce(v_buffer_mins, 15));
  v_est_end := v_now + make_interval(mins => v_dur);

  if exists (
    select 1
    from public.reservation_tables rt
    join public.reservations r on r.id = rt.reservation_id
    where rt.table_id = p_table_id
      and r.status::text in ('confirmed', 'seated')
      and ((r.start_time - v_buffer) < v_est_end and (r.end_time + v_buffer) > v_now)
  ) then
    raise exception 'Conflicto: la mesa % tiene una reserva próxima dentro de la ventana estimada.', v_table.number
      using errcode = '23P01';
  end if;

  insert into public.table_sessions (
    table_id, reservation_id, session_type, guests_count,
    started_at, expected_duration_minutes, estimated_end_at, started_by, notes
  ) values (
    p_table_id, null, 'walk_in'::public.table_session_type, p_guests_count,
    v_now, v_dur, v_est_end, p_actor_id, nullif(btrim(p_notes), '')
  ) returning id into v_sess_id;

  perform private.recompute_table_availability(array[p_table_id]);

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'open_walk_in_session',
    p_idempotency_key,
    p_request_hash,
    'table_session',
    v_sess_id::text,
    'table_session.walk_in_opened',
    null,
    jsonb_build_object(
      'tableId', p_table_id, 'guestsCount', p_guests_count,
      'startedAt', v_now, 'estimatedEndAt', v_est_end
    ),
    'Apertura de sesión walk-in en mesa ' || v_table.number,
    p_table_id::text,
    null,
    jsonb_build_object(
      'id', v_sess_id,
      'tableId', p_table_id,
      'sessionType', 'walk_in',
      'guestsCount', p_guests_count,
      'startedAt', v_now,
      'expectedDurationMinutes', v_dur,
      'estimatedEndAt', v_est_end
    ),
    null,
    null
  );
end;
$function$;

-- 12.8 extend_table_session_tx
create or replace function public.extend_table_session_tx(
  p_session_id uuid,
  p_extra_minutes integer,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_sess record;
  v_new_dur integer;
  v_new_est_end timestamptz;
  v_buffer_mins integer;
  v_buffer interval;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'extend_table_session', p_idempotency_key, p_request_hash, false);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_extra_minutes is null or p_extra_minutes < 5 or p_extra_minutes > 240 then
    raise exception 'Extensión inválida (5 a 240 minutos).' using errcode = '22003';
  end if;

  select * into v_sess from public.table_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Sesión de mesa no encontrada.' using errcode = 'P0002';
  end if;
  if v_sess.ended_at is not null then
    raise exception 'La sesión ya se encuentra cerrada.' using errcode = 'SF409';
  end if;

  perform 1 from public.tables where id = v_sess.table_id for update;

  v_new_dur := v_sess.expected_duration_minutes + p_extra_minutes;
  if v_new_dur > 480 then
    raise exception 'La duración total de la sesión no puede superar 480 minutos.' using errcode = '22003';
  end if;
  v_new_est_end := v_sess.estimated_end_at + make_interval(mins => p_extra_minutes);

  select reservation_buffer_minutes into v_buffer_mins from public.operational_settings where id = 1;
  v_buffer := make_interval(mins => coalesce(v_buffer_mins, 15));

  if exists (
    select 1
    from public.reservation_tables rt
    join public.reservations r on r.id = rt.reservation_id
    where rt.table_id = v_sess.table_id
      and r.status::text in ('confirmed', 'seated')
      and (v_sess.reservation_id is null or r.id <> v_sess.reservation_id)
      and ((r.start_time - v_buffer) < v_new_est_end and (r.end_time + v_buffer) > v_sess.started_at)
  ) then
    raise exception 'La extensión entra en conflicto con una reserva próxima en esta mesa.' using errcode = '23P01';
  end if;

  update public.table_sessions
  set expected_duration_minutes = v_new_dur,
      estimated_end_at = v_new_est_end,
      updated_at = now()
  where id = p_session_id;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'extend_table_session',
    p_idempotency_key,
    p_request_hash,
    'table_session',
    p_session_id::text,
    'table_session.extended',
    jsonb_build_object('expectedDurationMinutes', v_sess.expected_duration_minutes, 'estimatedEndAt', v_sess.estimated_end_at),
    jsonb_build_object('expectedDurationMinutes', v_new_dur, 'estimatedEndAt', v_new_est_end),
    coalesce(nullif(btrim(p_reason), ''), 'Extensión de tiempo de estadía'),
    v_sess.table_id::text,
    v_sess.reservation_id::text,
    jsonb_build_object(
      'id', p_session_id,
      'tableId', v_sess.table_id,
      'expectedDurationMinutes', v_new_dur,
      'estimatedEndAt', v_new_est_end
    ),
    null,
    null
  );
end;
$function$;

-- 12.9 close_walk_in_session_tx
create or replace function public.close_walk_in_session_tx(
  p_session_id uuid,
  p_notes text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_sess record;
  v_now timestamptz := now();
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'close_walk_in_session', p_idempotency_key, p_request_hash, false);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  select * into v_sess from public.table_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Sesión no encontrada.' using errcode = 'P0002';
  end if;
  if v_sess.ended_at is not null then
    raise exception 'La sesión ya se encuentra cerrada.' using errcode = 'SF409';
  end if;
  if v_sess.session_type <> 'walk_in'::public.table_session_type then
    raise exception 'Las sesiones de reserva deben cerrarse mediante complete_service_tx o cancel_reservation_tx.'
      using errcode = 'SF409';
  end if;

  perform 1 from public.tables where id = v_sess.table_id for update;

  update public.table_sessions
  set ended_at = v_now,
      close_reason = 'walk_in_closed'::public.session_close_reason,
      ended_by = p_actor_id,
      notes = coalesce(nullif(btrim(p_notes), ''), notes),
      updated_at = v_now
  where id = p_session_id;

  perform private.recompute_table_availability(array[v_sess.table_id]);

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'close_walk_in_session',
    p_idempotency_key,
    p_request_hash,
    'table_session',
    p_session_id::text,
    'table_session.walk_in_closed',
    jsonb_build_object('endedAt', null),
    jsonb_build_object('endedAt', v_now, 'closeReason', 'walk_in_closed'),
    coalesce(nullif(btrim(p_notes), ''), 'Cierre normal de sesión walk-in'),
    v_sess.table_id::text,
    null,
    jsonb_build_object('id', p_session_id, 'tableId', v_sess.table_id, 'endedAt', v_now, 'closeReason', 'walk_in_closed'),
    null,
    null
  );
end;
$function$;

-- 12.10 release_table_operational_tx (exclusivo walk-in o recuperación de ocupación huérfana; nunca toca reservations)
create or replace function public.release_table_operational_tx(
  p_table_id uuid,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_table record;
  v_sess record;
  v_now timestamptz := now();
  v_closed_session_id uuid := null;
  v_new_status public.table_status;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'release_table_operational', p_idempotency_key, p_request_hash, false);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'Debe indicar motivo operativo para liberar la mesa (mínimo 5 caracteres).' using errcode = '22023';
  end if;

  select * into v_table from public.tables where id = p_table_id for update;
  if not found then
    raise exception 'Mesa no encontrada.' using errcode = 'P0002';
  end if;

  select * into v_sess
  from public.table_sessions
  where table_id = p_table_id and ended_at is null
  for update;

  if found then
    if v_sess.session_type = 'reservation'::public.table_session_type then
      raise exception 'La mesa % tiene una sesión de reserva activa; use complete_service_tx o cancel_reservation_tx.', v_table.number
        using errcode = 'SF409';
    end if;

    update public.table_sessions
    set ended_at = v_now,
        close_reason = 'operational_release'::public.session_close_reason,
        ended_by = p_actor_id,
        updated_at = v_now
    where id = v_sess.id;
    v_closed_session_id := v_sess.id;
  elsif v_table.status <> 'occupied'::public.table_status then
    raise exception 'La mesa % no tiene sesión abierta ni estado occupied.', v_table.number using errcode = 'SF409';
  end if;

  perform private.recompute_table_availability(array[p_table_id]);
  if v_table.status <> 'occupied'::public.table_status then
    update public.tables set updated_at = v_now where id = p_table_id;
  end if;
  select status into v_new_status from public.tables where id = p_table_id;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'release_table_operational',
    p_idempotency_key,
    p_request_hash,
    'table',
    p_table_id::text,
    'table.operational_released',
    jsonb_build_object('status', v_table.status, 'openSessionId', v_closed_session_id),
    jsonb_build_object('status', v_new_status, 'closedSessionId', v_closed_session_id),
    btrim(p_reason),
    p_table_id::text,
    null,
    jsonb_build_object(
      'tableId', p_table_id,
      'number', v_table.number,
      'status', v_new_status,
      'closedSessionId', v_closed_session_id
    ),
    'Liberación operativa de Mesa ' || v_table.number,
    'warning'
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 13. RPCs de Gestión de Perfiles y Saga/Reconciliación de Supabase Auth
-- ---------------------------------------------------------------------------

-- 13.1 set_user_profile_status_tx
create or replace function public.set_user_profile_status_tx(
  p_target_user_id uuid,
  p_status public.profile_status,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_target record;
  v_action text;
  v_alert_title text := null;
  v_alert_sev text := null;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'set_user_profile_status', p_idempotency_key, p_request_hash, true);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_target_user_id = p_actor_id and p_status = 'inactive'::public.profile_status then
    raise exception 'El Administrador Principal no puede desactivarse a sí mismo.' using errcode = 'SF409';
  end if;

  select * into v_target from public.profiles where id = p_target_user_id for update;
  if not found then
    raise exception 'Usuario no encontrado.' using errcode = 'P0002';
  end if;

  if v_target.role = 'super_admin'::public.app_role and p_status = 'inactive'::public.profile_status then
    raise exception 'Un super_admin debe permanecer activo.' using errcode = 'SF409';
  end if;

  if v_target.status = p_status then
    raise exception 'El perfil ya se encuentra en estado %.', p_status using errcode = 'SF409';
  end if;

  update public.profiles
  set status = p_status,
      updated_at = now()
  where id = p_target_user_id;

  if p_status = 'active'::public.profile_status then
    v_action := 'user.activated';
  else
    v_action := 'user.deactivated';
    v_alert_title := 'Acceso revocado para ' || v_target.email;
    v_alert_sev := 'warning';
  end if;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'set_user_profile_status',
    p_idempotency_key,
    p_request_hash,
    'profile',
    p_target_user_id::text,
    v_action,
    jsonb_build_object('status', v_target.status),
    jsonb_build_object('status', p_status, 'email', v_target.email),
    coalesce(nullif(btrim(p_reason), ''), 'Actualización administrativa de estado de usuario'),
    null,
    null,
    jsonb_build_object(
      'id', v_target.id,
      'email', v_target.email,
      'role', v_target.role,
      'status', p_status
    ),
    v_alert_title,
    v_alert_sev
  );
end;
$function$;

-- 13.2 transfer_user_profile_role_tx
create or replace function public.transfer_user_profile_role_tx(
  p_target_user_id uuid,
  p_new_role public.app_role,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_target record;
  v_actor_profile record;
  v_now timestamptz := now();
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'transfer_user_profile_role', p_idempotency_key, p_request_hash, true);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'Debe indicar motivo para transferir rol administrativo (mínimo 5 caracteres).' using errcode = '22023';
  end if;

  if p_new_role <> 'super_admin'::public.app_role then
    raise exception 'Para preservar un super_admin activo único, transfiera super_admin al nuevo titular.' using errcode = 'SF409';
  end if;

  if p_target_user_id = p_actor_id then
    raise exception 'El usuario objetivo ya posee el rol super_admin.' using errcode = 'SF409';
  end if;

  -- Bloqueo en orden ascendente de UUID para evitar deadlocks
  perform 1 from public.profiles where id in (p_actor_id, p_target_user_id) order by id asc for update;

  select * into v_actor_profile from public.profiles where id = p_actor_id;
  select * into v_target from public.profiles where id = p_target_user_id;

  if not found then
    raise exception 'Usuario objetivo no encontrado.' using errcode = 'P0002';
  end if;

  if v_target.status <> 'active'::public.profile_status then
    raise exception 'No se puede promover a super_admin a un usuario inactivo.' using errcode = 'SF409';
  end if;

  update public.profiles
  set role = 'operational_admin'::public.app_role,
      updated_at = v_now
  where id = p_actor_id;

  update public.profiles
  set role = 'super_admin'::public.app_role,
      updated_at = v_now
  where id = p_target_user_id;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'transfer_user_profile_role',
    p_idempotency_key,
    p_request_hash,
    'profile',
    p_target_user_id::text,
    'user.super_admin_transferred',
    jsonb_build_object('previousSuperAdminId', p_actor_id, 'targetPreviousRole', v_target.role),
    jsonb_build_object('newSuperAdminId', p_target_user_id, 'demotedAdminId', p_actor_id),
    btrim(p_reason),
    null,
    null,
    jsonb_build_object(
      'newSuperAdminId', p_target_user_id,
      'newSuperAdminEmail', v_target.email,
      'previousSuperAdminId', p_actor_id,
      'previousSuperAdminEmail', v_actor_profile.email
    ),
    'Transferencia de titularidad Super Admin hacia ' || v_target.email,
    'critical'
  );
end;
$function$;

-- 13.3 begin_user_auth_operation_tx (fase 1 de saga Auth: persiste pending_auth + correlation_id antes de llamar a GoTrue)
create or replace function public.begin_user_auth_operation_tx(
  p_operation_type public.user_auth_op_type,
  p_target_email text,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_email text := lower(btrim(coalesce(p_target_email, '')));
  v_op_id uuid;
  v_corr_id uuid;
  v_action text;
  v_now timestamptz := now();
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'begin_user_auth_operation', p_idempotency_key, p_request_hash, true);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Correo electrónico objetivo inválido.' using errcode = '22023';
  end if;

  if p_operation_type = 'invite_user'::public.user_auth_op_type then
    if exists (select 1 from public.profiles where email = v_email) then
      raise exception 'Ya existe un usuario registrado con el email %.', v_email using errcode = 'SF409';
    end if;
    v_action := 'user.invite_initiated';
  else
    if not exists (select 1 from public.profiles where email = v_email) then
      raise exception 'No existe un perfil registrado para el email %.', v_email using errcode = 'P0002';
    end if;
    v_action := 'user.password_reset_initiated';
  end if;

  if exists (
    select 1 from public.user_auth_operations
    where operation_type = p_operation_type
      and target_email = v_email
      and state in ('pending_auth', 'auth_dispatched', 'auth_response_received')
  ) then
    raise exception 'Ya existe una operación % activa para %; aguarde o reconcilie antes de reintentar.', p_operation_type, v_email
      using errcode = 'SF409';
  end if;

  insert into public.user_auth_operations (
    actor_id,
    idempotency_key,
    request_hash,
    operation_type,
    target_email,
    state,
    state_history
  ) values (
    p_actor_id,
    btrim(p_idempotency_key),
    btrim(p_request_hash),
    p_operation_type,
    v_email,
    'pending_auth'::public.user_auth_op_state,
    jsonb_build_array(jsonb_build_object('state', 'pending_auth', 'at', v_now, 'by', p_actor_id))
  ) returning id, correlation_id into v_op_id, v_corr_id;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'begin_user_auth_operation',
    p_idempotency_key,
    p_request_hash,
    'user_auth_operation',
    v_op_id::text,
    v_action,
    null,
    jsonb_build_object('operationType', p_operation_type, 'targetEmail', v_email, 'correlationId', v_corr_id, 'state', 'pending_auth'),
    coalesce(nullif(btrim(p_reason), ''), 'Inicio de operación Auth supervisada'),
    null,
    null,
    jsonb_build_object(
      'operationId', v_op_id,
      'correlationId', v_corr_id,
      'operationType', p_operation_type,
      'targetEmail', v_email,
      'state', 'pending_auth'
    ),
    null,
    null
  );
end;
$function$;

-- 13.4 mark_user_auth_dispatched_tx (fase 2a: marca despacho inmediatamente antes/al invocar GoTrue)
create or replace function public.mark_user_auth_dispatched_tx(
  p_operation_id uuid,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_op record;
  v_now timestamptz := now();
  v_action text;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'mark_user_auth_dispatched', p_idempotency_key, p_request_hash, true);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  select * into v_op from public.user_auth_operations where id = p_operation_id for update;
  if not found then
    raise exception 'Operación Auth no encontrada.' using errcode = 'P0002';
  end if;

  if v_op.state <> 'pending_auth'::public.user_auth_op_state then
    raise exception 'La operación Auth debe estar en pending_auth para marcar despacho (actual: %).', v_op.state
      using errcode = 'SF409';
  end if;

  v_action := case
    when v_op.operation_type = 'invite_user'::public.user_auth_op_type then 'user.invite_dispatched'
    else 'user.password_reset_dispatched'
  end;

  update public.user_auth_operations
  set state = 'auth_dispatched'::public.user_auth_op_state,
      dispatched_at = v_now,
      state_history = state_history || jsonb_build_array(jsonb_build_object('state', 'auth_dispatched', 'at', v_now, 'by', p_actor_id)),
      updated_at = v_now
  where id = p_operation_id;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'mark_user_auth_dispatched',
    p_idempotency_key,
    p_request_hash,
    'user_auth_operation',
    p_operation_id::text,
    v_action,
    jsonb_build_object('state', v_op.state),
    jsonb_build_object('state', 'auth_dispatched', 'dispatchedAt', v_now),
    'Solicitud Auth preparada para envío a GoTrue',
    null,
    null,
    jsonb_build_object(
      'operationId', p_operation_id,
      'correlationId', v_op.correlation_id,
      'state', 'auth_dispatched',
      'dispatchedAt', v_now
    ),
    null,
    null
  );
end;
$function$;

-- 13.5 complete_user_auth_operation_tx
create or replace function public.complete_user_auth_operation_tx(
  p_operation_id uuid,
  p_target_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_op record;
  v_now timestamptz := now();
  v_action text;
  v_profile record;
  v_first text := nullif(left(btrim(coalesce(p_first_name, '')), 100), '');
  v_last text := nullif(left(btrim(coalesce(p_last_name, '')), 100), '');
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'complete_user_auth_operation', p_idempotency_key, p_request_hash, true);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  select * into v_op from public.user_auth_operations where id = p_operation_id for update;
  if not found then
    raise exception 'Operación Auth no encontrada.' using errcode = 'P0002';
  end if;

  if v_op.state not in ('auth_dispatched'::public.user_auth_op_state, 'auth_response_received'::public.user_auth_op_state) then
    raise exception 'Estado inválido para completar operación Auth (actual: %).', v_op.state using errcode = 'SF409';
  end if;

  v_action := case
    when v_op.operation_type = 'invite_user'::public.user_auth_op_type then 'user.invited'
    else 'user.password_reset_sent'
  end;

  update public.user_auth_operations
  set state = 'completed'::public.user_auth_op_state,
      target_user_id = coalesce(p_target_user_id, target_user_id),
      state_history = state_history || jsonb_build_array(
        jsonb_build_object('state', 'completed', 'at', v_now, 'by', p_actor_id, 'targetUserId', p_target_user_id)
      ),
      updated_at = v_now
  where id = p_operation_id;

  if v_op.operation_type = 'invite_user'::public.user_auth_op_type and p_target_user_id is not null then
    select * into v_profile from public.profiles where id = p_target_user_id for update;
    if found then
      update public.profiles
      set invited_operation_id = coalesce(invited_operation_id, p_operation_id),
          first_name = coalesce(v_first, first_name),
          last_name = coalesce(v_last, last_name),
          updated_at = v_now
      where id = p_target_user_id;
    end if;
  end if;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'complete_user_auth_operation',
    p_idempotency_key,
    p_request_hash,
    'user_auth_operation',
    p_operation_id::text,
    v_action,
    jsonb_build_object('state', v_op.state),
    jsonb_build_object('state', 'completed', 'targetUserId', p_target_user_id, 'targetEmail', v_op.target_email),
    coalesce(nullif(btrim(p_reason), ''), 'Operación Auth confirmada por GoTrue'),
    null,
    null,
    jsonb_build_object(
      'operationId', p_operation_id,
      'operationType', v_op.operation_type,
      'targetEmail', v_op.target_email,
      'targetUserId', p_target_user_id,
      'state', 'completed'
    ),
    null,
    null
  );
end;
$function$;

-- 13.6 fail_user_auth_operation_tx
create or replace function public.fail_user_auth_operation_tx(
  p_operation_id uuid,
  p_error_message text,
  p_needs_reconciliation boolean,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_op record;
  v_now timestamptz := now();
  v_target_state public.user_auth_op_state;
  v_action text;
  v_alert_title text := null;
  v_alert_sev text := null;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'fail_user_auth_operation', p_idempotency_key, p_request_hash, true);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  select * into v_op from public.user_auth_operations where id = p_operation_id for update;
  if not found then
    raise exception 'Operación Auth no encontrada.' using errcode = 'P0002';
  end if;

  if v_op.state not in ('pending_auth'::public.user_auth_op_state, 'auth_dispatched'::public.user_auth_op_state) then
    raise exception 'No se puede fallar una operación Auth en estado %.', v_op.state using errcode = 'SF409';
  end if;

  if coalesce(p_needs_reconciliation, false) then
    v_target_state := 'needs_reconciliation'::public.user_auth_op_state;
    v_action := 'user.auth_needs_reconciliation';
    v_alert_title := 'Operación Auth requiere reconciliación (' || v_op.target_email || ')';
    v_alert_sev := 'warning';
  else
    v_target_state := 'failed'::public.user_auth_op_state;
    v_action := case
      when v_op.operation_type = 'invite_user'::public.user_auth_op_type then 'user.invite_failed'
      else 'user.password_reset_failed'
    end;
  end if;

  update public.user_auth_operations
  set state = v_target_state,
      last_error = left(coalesce(nullif(btrim(p_error_message), ''), 'Error indeterminado en GoTrue'), 500),
      state_history = state_history || jsonb_build_array(
        jsonb_build_object('state', v_target_state, 'at', v_now, 'by', p_actor_id, 'error', left(coalesce(p_error_message, ''), 200))
      ),
      updated_at = v_now
  where id = p_operation_id;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'fail_user_auth_operation',
    p_idempotency_key,
    p_request_hash,
    'user_auth_operation',
    p_operation_id::text,
    v_action,
    jsonb_build_object('state', v_op.state),
    jsonb_build_object('state', v_target_state, 'lastError', left(coalesce(p_error_message, ''), 200)),
    coalesce(nullif(btrim(p_error_message), ''), 'Fallo o respuesta ambigua de GoTrue'),
    null,
    null,
    jsonb_build_object(
      'operationId', p_operation_id,
      'operationType', v_op.operation_type,
      'targetEmail', v_op.target_email,
      'state', v_target_state
    ),
    v_alert_title,
    v_alert_sev
  );
end;
$function$;

-- 13.7 reconcile_user_auth_operation_tx (verificación estricta de correlación antes de completar)
create or replace function public.reconcile_user_auth_operation_tx(
  p_operation_id uuid,
  p_outcome text,
  p_target_user_id uuid,
  p_evidence jsonb,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ctx record;
  v_op record;
  v_profile record;
  v_now timestamptz := now();
  v_target_state public.user_auth_op_state;
  v_action text;
  v_corr_match boolean := false;
begin
  select * into v_ctx from private.begin_tx_rpc(p_actor_id, 'reconcile_user_auth_operation', p_idempotency_key, p_request_hash, true);
  if v_ctx.is_replay then
    return v_ctx.cached_response;
  end if;

  if p_outcome not in ('completed', 'failed', 'needs_reconciliation') then
    raise exception 'Resultado de reconciliación inválido.' using errcode = '22023';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'Debe documentar el motivo/evidencia de reconciliación (mínimo 5 caracteres).' using errcode = '22023';
  end if;

  select * into v_op from public.user_auth_operations where id = p_operation_id for update;
  if not found then
    raise exception 'Operación Auth no encontrada.' using errcode = 'P0002';
  end if;

  if v_op.state not in ('auth_dispatched'::public.user_auth_op_state, 'needs_reconciliation'::public.user_auth_op_state) then
    raise exception 'Solo operaciones en auth_dispatched o needs_reconciliation pueden reconciliarse (actual: %).', v_op.state
      using errcode = 'SF409';
  end if;

  if p_outcome = 'completed' then
    if v_op.operation_type = 'invite_user'::public.user_auth_op_type then
      if p_target_user_id is null then
        raise exception 'Para reconciliar invite_user como completed se requiere p_target_user_id.' using errcode = '22023';
      end if;

      select * into v_profile from public.profiles where id = p_target_user_id for update;
      if not found or v_profile.email <> v_op.target_email then
        raise exception 'El perfil indicado no coincide con el correo de la operación.' using errcode = 'SF409';
      end if;

      v_corr_match := (v_profile.invited_operation_id = p_operation_id)
        or (coalesce(p_evidence ->> 'matchedCorrelationId', '') = v_op.correlation_id::text)
        or (coalesce(p_evidence ->> 'matchedOperationId', '') = p_operation_id::text);

      if not v_corr_match then
        raise exception 'Sin correlación verificada para esta invitación; mantenga en needs_reconciliation o marque failed.'
          using errcode = 'SF409';
      end if;

      if v_profile.invited_operation_id is null then
        update public.profiles
        set invited_operation_id = p_operation_id,
            updated_at = v_now
        where id = p_target_user_id;
      end if;
    else
      if coalesce((p_evidence ->> 'providerConfirmed')::boolean, false) is distinct from true then
        raise exception 'Un reset_password no puede marcarse como completed sin confirmación del proveedor; mantenga en needs_reconciliation o marque failed.'
          using errcode = 'SF409';
      end if;
    end if;

    v_target_state := 'completed'::public.user_auth_op_state;
    v_action := 'user.auth_reconciled_completed';
  elsif p_outcome = 'failed' then
    v_target_state := 'failed'::public.user_auth_op_state;
    v_action := 'user.auth_reconciled_failed';
  else
    v_target_state := 'needs_reconciliation'::public.user_auth_op_state;
    v_action := 'user.auth_marked_needs_reconciliation';
  end if;

  update public.user_auth_operations
  set state = v_target_state,
      target_user_id = coalesce(p_target_user_id, target_user_id),
      reconciled_at = v_now,
      reconciled_by = p_actor_id,
      state_history = state_history || jsonb_build_array(
        jsonb_build_object(
          'state', v_target_state,
          'at', v_now,
          'by', p_actor_id,
          'evidence', coalesce(p_evidence, '{}'::jsonb)
        )
      ),
      updated_at = v_now
  where id = p_operation_id;

  return private.finish_tx_rpc(
    p_actor_id,
    v_ctx.actor_role,
    'reconcile_user_auth_operation',
    p_idempotency_key,
    p_request_hash,
    'user_auth_operation',
    p_operation_id::text,
    v_action,
    jsonb_build_object('state', v_op.state),
    jsonb_build_object('state', v_target_state, 'reconciledBy', p_actor_id, 'targetUserId', p_target_user_id),
    btrim(p_reason),
    null,
    null,
    jsonb_build_object(
      'operationId', p_operation_id,
      'operationType', v_op.operation_type,
      'targetEmail', v_op.target_email,
      'state', v_target_state,
      'reconciledAt', v_now
    ),
    null,
    null
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 14. Privilegios estrictos de ejecución (EXCLUSIVO service_role para *_tx)
-- ---------------------------------------------------------------------------
revoke all on function public.create_table_tx(integer, text, integer, integer, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_table_tx(integer, text, integer, integer, text, text, uuid, text, text) to service_role;

revoke all on function public.delete_virgin_table_tx(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.delete_virgin_table_tx(uuid, text, uuid, text, text) to service_role;

revoke all on function public.change_table_capacity_tx(uuid, integer, text, boolean, uuid, text, text) from public, anon, authenticated;
grant execute on function public.change_table_capacity_tx(uuid, integer, text, boolean, uuid, text, text) to service_role;

revoke all on function public.set_table_status_tx(uuid, public.table_status, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_table_status_tx(uuid, public.table_status, text, uuid, text, text) to service_role;

revoke all on function public.initialize_floor_plan_tx(jsonb, boolean, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.initialize_floor_plan_tx(jsonb, boolean, text, uuid, text, text) to service_role;

revoke all on function public.update_operational_settings_tx(integer, integer, integer, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_operational_settings_tx(integer, integer, integer, text, uuid, text, text) to service_role;

revoke all on function public.review_admin_alert_tx(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_admin_alert_tx(uuid, text, uuid, text, text) to service_role;

revoke all on function public.create_reservation_with_tables_tx(text, text, text, integer, timestamptz, integer, uuid[], text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_reservation_with_tables_tx(text, text, text, integer, timestamptz, integer, uuid[], text, uuid, text, text) to service_role;

revoke all on function public.cancel_reservation_tx(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.cancel_reservation_tx(uuid, text, uuid, text, text) to service_role;

revoke all on function public.reassign_reservation_tables_tx(uuid, uuid[], text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.reassign_reservation_tables_tx(uuid, uuid[], text, uuid, text, text) to service_role;

revoke all on function public.seat_reservation_tx(uuid, integer, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.seat_reservation_tx(uuid, integer, text, uuid, text, text) to service_role;

revoke all on function public.no_show_reservation_tx(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.no_show_reservation_tx(uuid, text, uuid, text, text) to service_role;

revoke all on function public.complete_service_tx(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_service_tx(uuid, text, uuid, text, text) to service_role;

revoke all on function public.open_walk_in_session_tx(uuid, integer, integer, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.open_walk_in_session_tx(uuid, integer, integer, text, uuid, text, text) to service_role;

revoke all on function public.extend_table_session_tx(uuid, integer, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.extend_table_session_tx(uuid, integer, text, uuid, text, text) to service_role;

revoke all on function public.close_walk_in_session_tx(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.close_walk_in_session_tx(uuid, text, uuid, text, text) to service_role;

revoke all on function public.release_table_operational_tx(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.release_table_operational_tx(uuid, text, uuid, text, text) to service_role;

revoke all on function public.set_user_profile_status_tx(uuid, public.profile_status, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_user_profile_status_tx(uuid, public.profile_status, text, uuid, text, text) to service_role;

revoke all on function public.transfer_user_profile_role_tx(uuid, public.app_role, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.transfer_user_profile_role_tx(uuid, public.app_role, text, uuid, text, text) to service_role;

revoke all on function public.begin_user_auth_operation_tx(public.user_auth_op_type, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.begin_user_auth_operation_tx(public.user_auth_op_type, text, text, uuid, text, text) to service_role;

revoke all on function public.mark_user_auth_dispatched_tx(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_user_auth_dispatched_tx(uuid, uuid, text, text) to service_role;

revoke all on function public.complete_user_auth_operation_tx(uuid, uuid, text, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_user_auth_operation_tx(uuid, uuid, text, text, text, uuid, text, text) to service_role;

revoke all on function public.fail_user_auth_operation_tx(uuid, text, boolean, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_user_auth_operation_tx(uuid, text, boolean, uuid, text, text) to service_role;

revoke all on function public.reconcile_user_auth_operation_tx(uuid, text, uuid, jsonb, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.reconcile_user_auth_operation_tx(uuid, text, uuid, jsonb, text, uuid, text, text) to service_role;
