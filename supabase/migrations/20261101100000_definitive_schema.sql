-- ============================================================================
-- SOFIA · MIGRACIÓN 2 DE 2: ESTRUCTURA RELACIONAL, AUDITORÍA Y FUNCIONES ACID
-- Archivo: 20261101100000_definitive_schema.sql
-- 
-- REQUISITOS Y DEPENDENCIAS:
-- 1. Requiere la ejecución y confirmación previa de 20261101090000_prepare_enums.sql.
-- 2. Preserva el 100% de perfiles existentes en public.profiles y usuarios de auth.users.
-- 3. Preserva el registro histórico de public.audit_logs y sus triggers de inmutabilidad.
-- 4. Ejecución atómica única: BEGIN; ... COMMIT;
-- ============================================================================

-- ============================================================================
-- FASE 2: ESTRUCTURA RELACIONAL, AUDITORÍA, REGLAS RLS Y FUNCIONES ACID
-- Transacción atómica única: si cualquier sentencia falla, todo se revierte.
-- ============================================================================
begin;

-- ----------------------------------------------------------------------------
-- 2. TABLA DE PERFILES (public.profiles)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text check (first_name is null or char_length(first_name) <= 100),
  last_name text check (last_name is null or char_length(last_name) <= 100),
  email text not null check (email = lower(email)),
  role public.app_role not null default 'operational_admin',
  status public.profile_status not null default 'inactive',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Asegurar columnas si la tabla ya existía
alter table public.profiles
  add column if not exists first_name text check (first_name is null or char_length(first_name) <= 100),
  add column if not exists last_name text check (last_name is null or char_length(last_name) <= 100),
  add column if not exists role public.app_role not null default 'operational_admin',
  add column if not exists status public.profile_status not null default 'inactive',
  add column if not exists updated_at timestamptz not null default now();

-- Unicidad de super_admin: solo un superadministrador activo a la vez
create unique index if not exists profiles_single_super_admin
  on public.profiles (role)
  where role = 'super_admin'::public.app_role;

-- Garantizar que el superadministrador siempre esté en estado activo
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_super_admin_must_be_active'
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.profiles
      add constraint profiles_super_admin_must_be_active
      check (
        role <> 'super_admin'::public.app_role
        or status = 'active'::public.profile_status
      );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. FUNCIÓN DE COMPROBACIÓN DE SUPERADMINISTRADOR (SECURITY DEFINER)
-- ----------------------------------------------------------------------------
create or replace function public.is_active_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'super_admin'::public.app_role
      and profile.status = 'active'::public.profile_status
  );
$function$;

revoke all on function public.is_active_super_admin() from public, anon;
grant execute on function public.is_active_super_admin() to authenticated;

-- Políticas RLS en profiles
alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (first_name, last_name) on table public.profiles to authenticated;

drop policy if exists "Profiles are visible to owner or super_admin" on public.profiles;
create policy "Profiles are visible to owner or super_admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_active_super_admin()));

drop policy if exists "Users can update display name" on public.profiles;
create policy "Users can update display name"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Trigger de updated_at para perfiles
create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function public.set_profile_updated_at() from public, anon, authenticated;
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_profile_updated_at();

-- Trigger para nuevos usuarios creados en auth.users
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.email is null then
    return new;
  end if;

  insert into public.profiles (id, first_name, last_name, email, role, status)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), 100), ''),
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'last_name', '')), 100), ''),
    lower(new.email),
    'operational_admin'::public.app_role,
    'inactive'::public.profile_status
  )
  on conflict (id) do update 
    set email = excluded.email, 
        updated_at = now();
  return new;
end;
$function$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_or_email_changed on auth.users;
create trigger on_auth_user_created_or_email_changed
  after insert or update of email on auth.users
  for each row execute function public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- 4. TABLA DE AUDITORÍA INMUTABLE (public.audit_logs)
-- ----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles (id) on delete restrict,
  actor_role public.app_role,
  action varchar(80) not null,
  entity varchar(80) not null,
  entity_id varchar(100) not null,
  old_values jsonb,
  new_values jsonb,
  status varchar(20) not null default 'success',
  reason text,
  related_table_id varchar(50),
  related_reservation_id varchar(50),
  created_at timestamptz not null default now()
);

-- Asegurar columnas aditivas si la tabla audit_logs ya existía previamente en producción
alter table public.audit_logs
  add column if not exists actor_role public.app_role,
  add column if not exists status varchar(20) not null default 'success',
  add column if not exists reason text,
  add column if not exists related_table_id varchar(50),
  add column if not exists related_reservation_id varchar(50);

-- Conversión controlada de entity_id a varchar(100) sin silenciar excepciones fatales
do $$
declare
  v_col_type text;
begin
  select data_type into v_col_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'audit_logs'
    and column_name = 'entity_id';

  if v_col_type = 'uuid' then
    alter table public.audit_logs alter column entity_id type varchar(100) using entity_id::text;
  elsif v_col_type in ('character varying', 'text') then
    -- Estructura ya compatible con varchar(100), no requiere alteración
    null;
  elsif v_col_type is not null then
    raise exception 'Tipo de columna inesperado en public.audit_logs.entity_id: % (se esperaba uuid o varchar)', v_col_type using errcode = '42804';
  end if;
end $$;

-- Índices de consulta de auditoría
create index if not exists audit_logs_entity_created_at_idx on public.audit_logs (entity, entity_id, created_at desc);
create index if not exists audit_logs_actor_created_at_idx on public.audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action);
create index if not exists audit_logs_related_table_idx on public.audit_logs (related_table_id);
create index if not exists audit_logs_related_res_idx on public.audit_logs (related_reservation_id);

-- Inmutabilidad estricta de auditoría: rechazar UPDATE, DELETE y TRUNCATE
alter table public.audit_logs enable row level security;
revoke all on table public.audit_logs from public, anon, authenticated;

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'Audit logs are strictly immutable and cannot be updated, deleted or truncated' using errcode = '55000';
end;
$function$;

revoke all on function public.prevent_audit_log_mutation() from public, anon, authenticated;
drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_log_mutation();

drop trigger if exists audit_logs_no_truncate on public.audit_logs;
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function public.prevent_audit_log_mutation();

-- ----------------------------------------------------------------------------
-- 5. CENTRO PRIVADO DE ALERTAS ADMINISTRATIVAS (public.admin_alerts)
-- ----------------------------------------------------------------------------
create table if not exists public.admin_alerts (
  id uuid primary key default gen_random_uuid(),
  audit_log_id uuid not null references public.audit_logs (id) on delete cascade,
  title varchar(150) not null,
  severity varchar(20) not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  status varchar(20) not null default 'pending' check (status in ('pending', 'reviewed')),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists admin_alerts_status_idx on public.admin_alerts (status, created_at desc);
create index if not exists admin_alerts_audit_log_idx on public.admin_alerts (audit_log_id);

alter table public.admin_alerts enable row level security;
revoke all on table public.admin_alerts from public, anon;
grant select, update on table public.admin_alerts to authenticated;

drop policy if exists "Admin alerts visible exclusively to active super_admin" on public.admin_alerts;
create policy "Admin alerts visible exclusively to active super_admin"
  on public.admin_alerts for select to authenticated
  using ((select public.is_active_super_admin()));

drop policy if exists "Only active super_admin can review alerts" on public.admin_alerts;
create policy "Only active super_admin can review alerts"
  on public.admin_alerts for update to authenticated
  using ((select public.is_active_super_admin()))
  with check ((select public.is_active_super_admin()));

-- ----------------------------------------------------------------------------
-- 6. CATÁLOGO DE MESAS (public.tables)
-- ----------------------------------------------------------------------------
create table if not exists public.tables (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique check (number > 0),
  sector varchar(60) not null default 'Salón Principal',
  capacity integer not null check (capacity > 0 and capacity <= 30),
  max_capacity integer not null check (max_capacity >= capacity and max_capacity <= 40),
  status public.table_status not null default 'available',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tables_number_idx on public.tables (number);
create index if not exists tables_sector_idx on public.tables (sector);
create index if not exists tables_status_idx on public.tables (status);

alter table public.tables enable row level security;
revoke all on table public.tables from public, anon;
grant select on table public.tables to authenticated;

drop policy if exists "Tables are viewable by active staff" on public.tables;
create policy "Tables are viewable by active staff"
  on public.tables for select to authenticated
  using (exists (
    select 1 from public.profiles 
    where profiles.id = (select auth.uid()) and profiles.status = 'active'::public.profile_status
  ));

-- ----------------------------------------------------------------------------
-- 7. AGENDA DE RESERVAS (public.reservations)
-- ----------------------------------------------------------------------------
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  customer_name varchar(120) not null check (char_length(btrim(customer_name)) >= 2),
  customer_phone varchar(40),
  customer_email varchar(120),
  guests_count integer not null check (guests_count > 0 and guests_count <= 50),
  reservation_date date not null,
  start_time timestamptz not null,
  end_time timestamptz not null check (end_time > start_time),
  duration_minutes integer not null default 120 check (duration_minutes >= 30 and duration_minutes <= 360),
  status public.reservation_status not null default 'confirmed',
  notes text,
  created_by uuid references public.profiles(id),
  cancelled_by uuid references public.profiles(id),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reservations_date_idx on public.reservations (reservation_date, start_time);
create index if not exists reservations_status_idx on public.reservations (status);

alter table public.reservations enable row level security;
revoke all on table public.reservations from public, anon;
grant select on table public.reservations to authenticated;

drop policy if exists "Reservations are viewable by active staff" on public.reservations;
create policy "Reservations are viewable by active staff"
  on public.reservations for select to authenticated
  using (exists (
    select 1 from public.profiles 
    where profiles.id = (select auth.uid()) and profiles.status = 'active'::public.profile_status
  ));

-- ----------------------------------------------------------------------------
-- 8. ASIGNACIÓN N:M DE MESAS A RESERVAS (public.reservation_tables)
-- ----------------------------------------------------------------------------
create table if not exists public.reservation_tables (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  table_id uuid not null references public.tables(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint uq_reservation_table unique (reservation_id, table_id)
);

create index if not exists res_tables_res_idx on public.reservation_tables (reservation_id);
create index if not exists res_tables_tbl_idx on public.reservation_tables (table_id);

alter table public.reservation_tables enable row level security;
revoke all on table public.reservation_tables from public, anon;
grant select on table public.reservation_tables to authenticated;

drop policy if exists "Reservation tables are viewable by active staff" on public.reservation_tables;
create policy "Reservation tables are viewable by active staff"
  on public.reservation_tables for select to authenticated
  using (exists (
    select 1 from public.profiles 
    where profiles.id = (select auth.uid()) and profiles.status = 'active'::public.profile_status
  ));

-- ----------------------------------------------------------------------------
-- 9. TRIGGER DE DEFENSA EN PROFUNDIDAD: CONTROL ANTI-SOLAPAMIENTO
-- ----------------------------------------------------------------------------
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

  if v_current_res.status not in ('confirmed'::public.reservation_status, 'seated'::public.reservation_status) then
    return new;
  end if;

  select count(*) into v_conflict_count
  from public.reservation_tables rt
  join public.reservations r on r.id = rt.reservation_id
  where rt.table_id = new.table_id
    and rt.reservation_id <> new.reservation_id
    and r.status in ('confirmed'::public.reservation_status, 'seated'::public.reservation_status)
    and (r.start_time < v_current_res.end_time and r.end_time > v_current_res.start_time);

  if v_conflict_count > 0 then
    raise exception 'Conflicto de asignación: La mesa % ya cuenta con una reserva activa en esa franja horaria.', new.table_id
      using errcode = '23P01';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_check_table_overlap on public.reservation_tables;
create trigger trg_check_table_overlap
  before insert or update on public.reservation_tables
  for each row execute function public.check_table_overlap();

-- ----------------------------------------------------------------------------
-- 10. LAS 4 FUNCIONES RPC TRANSACCIONALES ACID (Exclusivas de service_role)
-- ----------------------------------------------------------------------------

-- 10.1 change_table_capacity_tx
create or replace function public.change_table_capacity_tx(
  p_table_id uuid,
  p_new_capacity integer,
  p_reason text,
  p_force boolean,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_table record;
  v_actor record;
  v_conflicts integer := 0;
  v_new_max integer;
  v_audit_id uuid;
  v_alert_id uuid;
  v_alert_title text;
  v_alert_severity text;
begin
  select id, first_name, last_name, email, role, status into v_actor
  from public.profiles where id = p_actor_id and status = 'active'::public.profile_status;
  if not found then
    raise exception 'Actor no autorizado o inactivo.' using errcode = '42501';
  end if;

  if p_new_capacity < 1 or p_new_capacity > 30 then
    raise exception 'Capacidad inválida: debe ser entre 1 y 30.' using errcode = '22003';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'Se requiere un motivo detallado (mínimo 5 caracteres).' using errcode = '22023';
  end if;

  select * into v_table
  from public.tables
  where id = p_table_id
  for update;
  if not found then
    raise exception 'Mesa no encontrada.' using errcode = 'P0002';
  end if;

  select count(*) into v_conflicts
  from public.reservations r
  join public.reservation_tables rt on rt.reservation_id = r.id
  where rt.table_id = p_table_id
    and r.status in ('confirmed'::public.reservation_status, 'seated'::public.reservation_status)
    and r.guests_count > p_new_capacity;

  if v_conflicts > 0 and not coalesce(p_force, false) then
    raise exception 'Conflicto de capacidad: existen % reserva(s) con más comensales que la nueva capacidad.', v_conflicts
      using errcode = '23P01';
  end if;

  v_new_max := greatest(p_new_capacity, v_table.max_capacity);

  update public.tables
  set capacity = p_new_capacity,
      max_capacity = v_new_max,
      updated_at = now()
  where id = p_table_id;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity, entity_id,
    old_values, new_values, status, reason, related_table_id
  ) values (
    v_actor.id,
    v_actor.role,
    'table.capacity_changed',
    'table',
    p_table_id::text,
    jsonb_build_object('capacity', v_table.capacity, 'max_capacity', v_table.max_capacity),
    jsonb_build_object('capacity', p_new_capacity, 'max_capacity', v_new_max),
    'success',
    btrim(p_reason),
    p_table_id::text
  ) returning id into v_audit_id;

  if v_conflicts > 0 then
    v_alert_severity := 'critical';
    v_alert_title := 'Mesa ' || v_table.number || ': capacidad reducida a ' || p_new_capacity || ' con ' || v_conflicts || ' reserva(s) en conflicto';
  else
    v_alert_severity := 'warning';
    v_alert_title := 'Mesa ' || v_table.number || ': capacidad modificada de ' || v_table.capacity || ' a ' || p_new_capacity;
  end if;

  insert into public.admin_alerts (
    audit_log_id, title, severity, status
  ) values (
    v_audit_id, v_alert_title, v_alert_severity, 'pending'
  ) returning id into v_alert_id;

  return jsonb_build_object(
    'id', v_table.id,
    'number', v_table.number,
    'sector', v_table.sector,
    'capacity', p_new_capacity,
    'maxCapacity', v_new_max,
    'status', v_table.status,
    'isActive', v_table.is_active,
    'conflictsCount', v_conflicts,
    'auditId', v_audit_id,
    'alertId', v_alert_id
  );
end;
$function$;

-- 10.2 set_table_status_tx
create or replace function public.set_table_status_tx(
  p_table_id uuid,
  p_status public.table_status,
  p_reason text,
  p_resolution text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_table record;
  v_actor record;
  v_future_res record;
  v_audit_id uuid;
  v_cancel_audit_id uuid;
  v_res_count integer := 0;
begin
  select id, first_name, last_name, email, role, status into v_actor
  from public.profiles where id = p_actor_id and status = 'active'::public.profile_status;
  if not found then
    raise exception 'Actor no autorizado o inactivo.' using errcode = '42501';
  end if;

  select * into v_table
  from public.tables
  where id = p_table_id
  for update;
  if not found then
    raise exception 'Mesa no encontrada.' using errcode = 'P0002';
  end if;

  -- Desactivación
  if p_status = 'out_of_service'::public.table_status then
    if p_reason is null or length(btrim(p_reason)) < 5 then
      raise exception 'Para desactivar una mesa es obligatorio declarar el motivo técnico u operativo (mínimo 5 caracteres).' using errcode = '22023';
    end if;

    select count(*) into v_res_count
    from public.reservations r
    join public.reservation_tables rt on rt.reservation_id = r.id
    where rt.table_id = p_table_id
      and r.status = 'confirmed'::public.reservation_status;

    if v_res_count > 0 and (p_resolution is null or p_resolution = '') then
      raise exception 'La mesa tiene % reserva(s) confirmada(s). Indique una resolución explícita (cancel o reassign).', v_res_count using errcode = '23P01';
    end if;

    if p_resolution = 'cancel' then
      for v_future_res in
        select r.id, r.customer_name
        from public.reservations r
        join public.reservation_tables rt on rt.reservation_id = r.id
        where rt.table_id = p_table_id and r.status = 'confirmed'::public.reservation_status
        for update of r
      loop
        update public.reservations
        set status = 'cancelled'::public.reservation_status,
            cancellation_reason = 'Mesa ' || v_table.number || ' desactivada: ' || btrim(p_reason),
            cancelled_by = v_actor.id,
            updated_at = now()
        where id = v_future_res.id;

        insert into public.audit_logs (
          actor_id, actor_role, action, entity, entity_id,
          old_values, new_values, status, reason, related_table_id, related_reservation_id
        ) values (
          v_actor.id, v_actor.role, 'reservation.cancelled_due_to_table_deactivation',
          'reservation', v_future_res.id::text,
          jsonb_build_object('status', 'confirmed', 'tableId', p_table_id),
          jsonb_build_object('status', 'cancelled'),
          'success',
          'Mesa ' || v_table.number || ' desactivada: ' || btrim(p_reason),
          p_table_id::text, v_future_res.id::text
        ) returning id into v_cancel_audit_id;

        insert into public.admin_alerts (
          audit_log_id, title, severity, status
        ) values (
          v_cancel_audit_id,
          'Reserva cancelada para ' || v_future_res.customer_name || ' por desactivación de Mesa ' || v_table.number,
          'critical', 'pending'
        );
      end loop;
    end if;

    update public.tables
    set status = 'out_of_service'::public.table_status,
        is_active = false,
        updated_at = now()
    where id = p_table_id;

    insert into public.audit_logs (
      actor_id, actor_role, action, entity, entity_id,
      old_values, new_values, status, reason, related_table_id
    ) values (
      v_actor.id, v_actor.role, 'table.deactivated', 'table', p_table_id::text,
      jsonb_build_object('status', v_table.status, 'isActive', v_table.is_active),
      jsonb_build_object('status', 'out_of_service', 'isActive', false),
      'success', btrim(p_reason), p_table_id::text
    ) returning id into v_audit_id;

    insert into public.admin_alerts (
      audit_log_id, title, severity, status
    ) values (
      v_audit_id,
      'Mesa ' || v_table.number || ' (' || v_table.sector || ') fuera de servicio',
      'warning', 'pending'
    );

    return jsonb_build_object(
      'id', v_table.id,
      'number', v_table.number,
      'sector', v_table.sector,
      'capacity', v_table.capacity,
      'maxCapacity', v_table.max_capacity,
      'status', 'out_of_service',
      'isActive', false,
      'cancelledReservationsCount', v_res_count
    );
  end if;

  -- Reactivación
  if v_table.status = 'out_of_service'::public.table_status and p_status = 'available'::public.table_status then
    update public.tables
    set status = 'available'::public.table_status,
        is_active = true,
        updated_at = now()
    where id = p_table_id;

    insert into public.audit_logs (
      actor_id, actor_role, action, entity, entity_id,
      old_values, new_values, status, reason, related_table_id
    ) values (
      v_actor.id, v_actor.role, 'table.reactivated', 'table', p_table_id::text,
      jsonb_build_object('status', v_table.status, 'isActive', false),
      jsonb_build_object('status', 'available', 'isActive', true),
      'success', coalesce(nullif(btrim(p_reason), ''), 'Reactivación operativa de mesa'), p_table_id::text
    ) returning id into v_audit_id;

    insert into public.admin_alerts (
      audit_log_id, title, severity, status
    ) values (
      v_audit_id,
      'Mesa ' || v_table.number || ' reactivada para el servicio',
      'info', 'pending'
    );

    return jsonb_build_object(
      'id', v_table.id,
      'number', v_table.number,
      'sector', v_table.sector,
      'capacity', v_table.capacity,
      'maxCapacity', v_table.max_capacity,
      'status', 'available',
      'isActive', true
    );
  end if;

  -- Cambio de estado cotidiano
  update public.tables
  set status = p_status, updated_at = now()
  where id = p_table_id;

  return jsonb_build_object(
    'id', v_table.id,
    'number', v_table.number,
    'sector', v_table.sector,
    'capacity', v_table.capacity,
    'maxCapacity', v_table.max_capacity,
    'status', p_status,
    'isActive', v_table.is_active
  );
end;
$function$;

-- 10.3 cancel_reservation_tx
create or replace function public.cancel_reservation_tx(
  p_reservation_id uuid,
  p_reason text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_res record;
  v_actor record;
  v_audit_id uuid;
  v_tbl_number integer;
  v_tbl_id uuid;
begin
  select id, role into v_actor
  from public.profiles where id = p_actor_id and status = 'active'::public.profile_status;
  if not found then
    raise exception 'Actor no autorizado o inactivo.' using errcode = '42501';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 4 then
    raise exception 'Debe ingresar el motivo de cancelación de la reserva (mínimo 4 caracteres).' using errcode = '22023';
  end if;

  select * into v_res
  from public.reservations
  where id = p_reservation_id
  for update;
  if not found then
    raise exception 'Reserva no encontrada.' using errcode = 'P0002';
  end if;

  if v_res.status = 'cancelled'::public.reservation_status then
    raise exception 'La reserva ya se encuentra cancelada.' using errcode = '23P01';
  end if;

  select t.id, t.number into v_tbl_id, v_tbl_number
  from public.reservation_tables rt
  join public.tables t on t.id = rt.table_id
  where rt.reservation_id = p_reservation_id
  limit 1;

  update public.reservations
  set status = 'cancelled'::public.reservation_status,
      cancellation_reason = btrim(p_reason),
      cancelled_by = v_actor.id,
      updated_at = now()
  where id = p_reservation_id;

  -- Liberar mesas asociadas si no tienen otra reserva activa o comensales sentados en ese horario
  update public.tables
  set status = 'available'::public.table_status,
      updated_at = now()
  where id in (select table_id from public.reservation_tables where reservation_id = p_reservation_id)
    and status = 'reserved'::public.table_status
    and not exists (
      select 1
      from public.reservation_tables rt2
      join public.reservations r2 on r2.id = rt2.reservation_id
      where rt2.table_id = tables.id
        and r2.id <> p_reservation_id
        and r2.status in ('confirmed'::public.reservation_status, 'seated'::public.reservation_status)
        and (r2.start_time < v_res.end_time and r2.end_time > v_res.start_time)
    );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity, entity_id,
    old_values, new_values, status, reason, related_table_id, related_reservation_id
  ) values (
    v_actor.id, v_actor.role, 'reservation.cancelled', 'reservation', p_reservation_id::text,
    jsonb_build_object('status', v_res.status),
    jsonb_build_object('status', 'cancelled'),
    'success', btrim(p_reason), v_tbl_id::text, p_reservation_id::text
  ) returning id into v_audit_id;

  insert into public.admin_alerts (
    audit_log_id, title, severity, status
  ) values (
    v_audit_id,
    'Cancelación de reserva: ' || v_res.customer_name || coalesce(' (Mesa ' || v_tbl_number || ')', ''),
    'warning', 'pending'
  );

  return jsonb_build_object(
    'id', v_res.id,
    'customerName', v_res.customer_name,
    'guestsCount', v_res.guests_count,
    'status', 'cancelled',
    'cancellationReason', btrim(p_reason),
    'cancelledBy', v_actor.id
  );
end;
$function$;

-- 10.4 create_reservation_with_tables_tx
create or replace function public.create_reservation_with_tables_tx(
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_guests_count integer,
  p_start_time timestamptz,
  p_duration_minutes integer,
  p_table_ids uuid[],
  p_notes text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor record;
  v_end_time timestamptz;
  v_res_date date;
  v_total_capacity integer := 0;
  v_tbl_count integer := 0;
  v_conflicts integer := 0;
  v_res_id uuid;
  v_tid uuid;
  v_audit_id uuid;
begin
  select id, role into v_actor
  from public.profiles where id = p_created_by and status = 'active'::public.profile_status;
  if not found then
    raise exception 'Actor no autorizado o inactivo.' using errcode = '42501';
  end if;

  if p_customer_name is null or length(btrim(p_customer_name)) < 2 then
    raise exception 'Nombre del cliente requerido (mínimo 2 caracteres).' using errcode = '22023';
  end if;

  if p_guests_count is null or p_guests_count < 1 or p_guests_count > 50 then
    raise exception 'Cantidad de comensales inválida (debe ser 1 a 50).' using errcode = '22003';
  end if;

  if p_duration_minutes is null or p_duration_minutes < 30 or p_duration_minutes > 360 then
    raise exception 'Duración de reserva inválida (debe ser 30 a 360 minutos).' using errcode = '22003';
  end if;

  if p_table_ids is null or cardinality(p_table_ids) = 0 then
    raise exception 'Debe asignar al menos una mesa a la reserva.' using errcode = '22023';
  end if;

  -- Zona Horaria Oficial: America/Argentina/Buenos_Aires (UTC-3) con corte operativo a las 05:00 hs (trasnochada)
  v_end_time := p_start_time + (p_duration_minutes || ' minutes')::interval;
  v_res_date := ((p_start_time at time zone 'America/Argentina/Buenos_Aires') - interval '5 hours')::date;

  -- Bloqueo pesimista determinista en orden ascendente de UUID
  select coalesce(sum(capacity), 0), count(*)
  into v_total_capacity, v_tbl_count
  from (
    select capacity, status, is_active
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
    raise exception 'La capacidad combinada de las mesas (%) es menor a la cantidad de comensales (%).', v_total_capacity, p_guests_count
      using errcode = '23P01';
  end if;

  select count(*) into v_conflicts
  from public.reservation_tables rt
  join public.reservations r on r.id = rt.reservation_id
  where rt.table_id = any(p_table_ids)
    and r.status in ('confirmed'::public.reservation_status, 'seated'::public.reservation_status)
    and (r.start_time < v_end_time and r.end_time > p_start_time);

  if v_conflicts > 0 then
    raise exception 'Conflicto de asignación: una o más mesas seleccionadas ya cuentan con reservas activas en ese rango horario.'
      using errcode = '23P01';
  end if;

  insert into public.reservations (
    customer_name, customer_phone, customer_email,
    guests_count, reservation_date, start_time, end_time,
    duration_minutes, status, notes, created_by
  ) values (
    btrim(p_customer_name), p_customer_phone, p_customer_email,
    p_guests_count, v_res_date, p_start_time, v_end_time,
    p_duration_minutes, 'confirmed'::public.reservation_status, p_notes, v_actor.id
  ) returning id into v_res_id;

  foreach v_tid in array p_table_ids
  loop
    insert into public.reservation_tables (reservation_id, table_id)
    values (v_res_id, v_tid);
  end loop;

  update public.tables
  set status = 'reserved'::public.table_status,
      updated_at = now()
  where id = any(p_table_ids)
    and status = 'available'::public.table_status;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity, entity_id,
    new_values, status, reason, related_reservation_id
  ) values (
    v_actor.id, v_actor.role, 'reservation.created', 'reservation', v_res_id::text,
    jsonb_build_object('customerName', p_customer_name, 'guestsCount', p_guests_count, 'tableIds', p_table_ids),
    'success', 'Creación y asignación atómica de reserva', v_res_id::text
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'id', v_res_id,
    'customerName', p_customer_name,
    'guestsCount', p_guests_count,
    'reservationDate', v_res_date,
    'startTime', p_start_time,
    'endTime', v_end_time,
    'durationMinutes', p_duration_minutes,
    'status', 'confirmed',
    'tableIds', p_table_ids,
    'auditId', v_audit_id
  );
end;
$function$;

-- 10.5 initialize_floor_plan_tx
create or replace function public.initialize_floor_plan_tx(
  p_tables jsonb,
  p_wipe boolean,
  p_reason text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor record;
  v_item jsonb;
  v_num integer;
  v_cap integer;
  v_max_cap integer;
  v_sec text;
  v_incoming_numbers integer[] := '{}';
  v_removed_ids uuid[];
  v_active_conflicts integer := 0;
  v_audit_id uuid;
begin
  select id, role into v_actor
  from public.profiles where id = p_actor_id and status = 'active'::public.profile_status;
  if not found or v_actor.role <> 'super_admin'::public.app_role then
    raise exception 'Operación reservada exclusivamente para el Administrador Principal activo.' using errcode = '42501';
  end if;

  if p_tables is null or jsonb_array_length(p_tables) = 0 then
    raise exception 'Debe proporcionar al menos una mesa para el plano.' using errcode = '22023';
  end if;

  -- Extraer números entrantes
  for v_item in select * from jsonb_array_elements(p_tables)
  loop
    v_incoming_numbers := array_append(v_incoming_numbers, (v_item->>'number')::integer);
  end loop;

  -- Si se reemplaza el plano (p_wipe = true), comprobar si las mesas ELIMINADAS tienen reservas confirmadas activas
  if coalesce(p_wipe, false) then
    select array_agg(id) into v_removed_ids
    from public.tables
    where not (number = any(v_incoming_numbers));

    if v_removed_ids is not null and cardinality(v_removed_ids) > 0 then
      select count(*) into v_active_conflicts
      from public.reservations r
      join public.reservation_tables rt on rt.reservation_id = r.id
      where rt.table_id = any(v_removed_ids)
        and r.status in ('confirmed'::public.reservation_status, 'seated'::public.reservation_status);

      if v_active_conflicts > 0 then
        raise exception 'No es posible eliminar mesas del plano porque poseen % reserva(s) confirmada(s) activas. Cancele o reasigne esas reservas antes de eliminarlas.', v_active_conflicts
          using errcode = '23P01';
      end if;

      -- Eliminar solo las relaciones y mesas efectivamente retiradas del plano
      delete from public.reservation_tables where table_id = any(v_removed_ids);
      delete from public.tables where id = any(v_removed_ids);
    end if;
  end if;

  -- Upsert de las mesas del plano conservando IDs de las existentes
  for v_item in select * from jsonb_array_elements(p_tables)
  loop
    v_num := (v_item->>'number')::integer;
    v_cap := (v_item->>'capacity')::integer;
    v_max_cap := coalesce((v_item->>'maxCapacity')::integer, v_cap);
    v_sec := coalesce(nullif(btrim(v_item->>'sector'), ''), 'Salón Principal');

    insert into public.tables (number, sector, capacity, max_capacity, status, is_active, updated_at)
    values (v_num, v_sec, v_cap, v_max_cap, 'available'::public.table_status, true, now())
    on conflict (number) do update
    set sector = excluded.sector,
        capacity = excluded.capacity,
        max_capacity = excluded.max_capacity,
        updated_at = now();
  end loop;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity, entity_id,
    new_values, status, reason
  ) values (
    v_actor.id, v_actor.role, 'floorplan.reinitialized', 'tables', 'salon-layout',
    jsonb_build_object('tablesCount', jsonb_array_length(p_tables), 'wipeExisting', p_wipe),
    'success', coalesce(nullif(btrim(p_reason), ''), 'Actualización de plano arquitectónico de salón')
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'status', 'success',
    'count', jsonb_array_length(p_tables),
    'auditId', v_audit_id
  );
end;
$function$;

-- Privilegios de ejecución de funciones: EXCLUSIVO service_role
revoke all on function public.change_table_capacity_tx(uuid, integer, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.change_table_capacity_tx(uuid, integer, text, boolean, uuid) to service_role;

revoke all on function public.set_table_status_tx(uuid, public.table_status, text, text, uuid) from public, anon, authenticated;
grant execute on function public.set_table_status_tx(uuid, public.table_status, text, text, uuid) to service_role;

revoke all on function public.cancel_reservation_tx(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cancel_reservation_tx(uuid, text, uuid) to service_role;

revoke all on function public.create_reservation_with_tables_tx(text, text, text, integer, timestamptz, integer, uuid[], text, uuid) from public, anon, authenticated;
grant execute on function public.create_reservation_with_tables_tx(text, text, text, integer, timestamptz, integer, uuid[], text, uuid) to service_role;

revoke all on function public.initialize_floor_plan_tx(jsonb, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.initialize_floor_plan_tx(jsonb, boolean, text, uuid) to service_role;

-- ============================================================================
-- FIN DE LA TRANSACCIÓN ATÓMICA
-- ============================================================================
commit;
