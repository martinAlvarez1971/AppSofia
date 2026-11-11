-- SOFIA · Fase A: Modelo Relacional de Mesas, Reservas y Asignaciones Múltiples
-- Archivo: 20261027150000_create_tables_and_reservations.sql
-- NOTA: Este archivo es una preparación de migración. No debe ejecutarse sin autorización expresa en producción.

-- 1. Enums de Salón y Reserva (Creación idempotente)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'table_status') then
    create type public.table_status as enum ('available', 'occupied', 'reserved', 'out_of_service');
  end if;
  if not exists (select 1 from pg_type where typname = 'reservation_status') then
    create type public.reservation_status as enum ('confirmed', 'seated', 'completed', 'cancelled', 'no_show');
  end if;
end $$;

-- 1.1 Asegurar compatibilidad de tipos en public.audit_logs si fue creado con entity_id tipo uuid
do $$ begin
  alter table public.audit_logs alter column entity_id type varchar(100) using entity_id::text;
exception when others then null;
end $$;

-- 2. Tabla de Mesas (Salón)
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

-- 3. Tabla de Reservas
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

-- 4. Asignación de Mesas a Reservas (Soporta mesas individuales y uniones múltiples)
create table if not exists public.reservation_tables (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  table_id uuid not null references public.tables(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint uq_reservation_table unique (reservation_id, table_id)
);

create index if not exists res_tables_res_idx on public.reservation_tables (reservation_id);
create index if not exists res_tables_tbl_idx on public.reservation_tables (table_id);

-- 5. Control Transaccional de Solapamiento Concurrente (Trigger de Defensa en Profundidad)
-- Adquiere bloqueo pesimista en public.tables, valida estado y rechaza colisiones concurrentes.
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
  -- 1. Bloqueo pesimista de la fila de la mesa en public.tables
  select id, status, is_active into v_table
  from public.tables
  where id = new.table_id
  for update;

  if not found then
    raise exception 'Mesa no encontrada: %', new.table_id using errcode = 'P0002';
  end if;

  -- 2. Validación de estado: rechazar mesas inactivas o fuera de servicio (Prioridad 2 y 5)
  if v_table.is_active = false or v_table.status = 'out_of_service'::public.table_status then
    raise exception 'La mesa seleccionada (ID %) está inactiva o fuera de servicio.', new.table_id
      using errcode = 'P0001';
  end if;

  -- 3. Obtener intervalo de la reserva
  select id, start_time, end_time, status into v_current_res
  from public.reservations
  where id = new.reservation_id;

  if not found then
    raise exception 'Reserva no encontrada: %', new.reservation_id using errcode = 'P0002';
  end if;

  if v_current_res.status not in ('confirmed'::public.reservation_status, 'seated'::public.reservation_status) then
    return new;
  end if;

  -- 4. Comprobar si la mesa ya tiene otra reserva activa en el mismo rango horario
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

-- =========================================================================
-- 6. Funciones Transaccionales ACID para Mutaciones Sensibles (Prioridades 1, 2, 4, 5, 6)
-- Todas las operaciones ejecutan bloqueos, mutaciones, auditoría y alertas
-- dentro de la misma transacción de PostgreSQL, garantizando atomicidad total.
-- =========================================================================

-- 6.1 Modificar capacidad de mesa con control atómico de reservas
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

-- 6.2 Desactivación / Reactivación / Cambio de Estado con Resolución Transaccional
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
      raise exception 'La mesa tiene % reserva(s) confirmada(s). Indique una resolución explícita (cancel o reassign).' using errcode = '23P01';
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

-- 6.3 Cancelación de Reserva con Motivo y Auditoría Atómica
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

  -- Liberar mesas asociadas si no tienen otra reserva confirmada activa
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
        and r2.status = 'confirmed'::public.reservation_status
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

-- 6.4 Creación Transaccional de Reserva con Múltiples Mesas y Control de Zona Horaria
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

  -- Prioridad 6: Zona Horaria America/Argentina/Buenos_Aires (UTC-3)
  v_end_time := p_start_time + (p_duration_minutes || ' minutes')::interval;
  v_res_date := (p_start_time at time zone 'America/Argentina/Buenos_Aires')::date;

  -- Bloqueo pesimista determinista en orden ascendente de UUID (evita deadlocks)
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

  -- Prioridad 5: Integridad de comensales vs capacidad combinada
  if v_total_capacity < p_guests_count then
    raise exception 'La capacidad combinada de las mesas (%) es menor a la cantidad de comensales (%).', v_total_capacity, p_guests_count
      using errcode = '23P01';
  end if;

  -- Prioridad 2: Detección de solapamiento en cualquier mesa seleccionada
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

  -- Actualizar estado de las mesas a reservadas de forma atómica en base de datos
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

-- Privilegios de ejecución de funciones transaccionales: EXCLUSIVO service_role
-- Para impedir que clientes autenticados directos invoquen las RPC y suplanten p_actor_id / p_created_by,
-- se revoca el acceso a PUBLIC, anon y authenticated. La invocación se realiza exclusivamente
-- desde el backend validado (server.ts) vía service_role.
revoke all on function public.change_table_capacity_tx(uuid, integer, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.change_table_capacity_tx(uuid, integer, text, boolean, uuid) to service_role;

revoke all on function public.set_table_status_tx(uuid, public.table_status, text, text, uuid) from public, anon, authenticated;
grant execute on function public.set_table_status_tx(uuid, public.table_status, text, text, uuid) to service_role;

revoke all on function public.cancel_reservation_tx(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cancel_reservation_tx(uuid, text, uuid) to service_role;

revoke all on function public.create_reservation_with_tables_tx(text, text, text, integer, timestamptz, integer, uuid[], text, uuid) from public, anon, authenticated;
grant execute on function public.create_reservation_with_tables_tx(text, text, text, integer, timestamptz, integer, uuid[], text, uuid) to service_role;

-- =========================================================================
-- 7. Políticas RLS Idempotentes (Drop Policy If Exists previo a cada Create Policy)
-- =========================================================================
alter table public.tables enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_tables enable row level security;

revoke all on table public.tables from public, anon;
revoke all on table public.reservations from public, anon;
revoke all on table public.reservation_tables from public, anon;

-- Mesas: lectura para personal activo
drop policy if exists "Tables are viewable by active authenticated staff" on public.tables;
create policy "Tables are viewable by active authenticated staff"
on public.tables for select to authenticated
using (exists (
  select 1 from public.profiles
  where id = (select auth.uid()) and status = 'active'::public.profile_status
));

-- Mesas: inserción exclusiva de super_admin
drop policy if exists "Superadmin can insert tables" on public.tables;
create policy "Superadmin can insert tables"
on public.tables for insert to authenticated
with check ((select public.is_active_super_admin()));

-- Mesas: actualización para personal activo
drop policy if exists "Staff can update tables" on public.tables;
create policy "Staff can update tables"
on public.tables for update to authenticated
using (exists (
  select 1 from public.profiles
  where id = (select auth.uid()) and status = 'active'::public.profile_status
));

-- Reservas: lectura para personal activo
drop policy if exists "Reservations are viewable by active staff" on public.reservations;
create policy "Reservations are viewable by active staff"
on public.reservations for select to authenticated
using (exists (
  select 1 from public.profiles
  where id = (select auth.uid()) and status = 'active'::public.profile_status
));

-- Reservas: creación para personal activo
drop policy if exists "Reservations can be created by active staff" on public.reservations;
create policy "Reservations can be created by active staff"
on public.reservations for insert to authenticated
with check (exists (
  select 1 from public.profiles
  where id = (select auth.uid()) and status = 'active'::public.profile_status
));

-- Reservas: actualización para personal activo
drop policy if exists "Reservations can be updated by active staff" on public.reservations;
create policy "Reservations can be updated by active staff"
on public.reservations for update to authenticated
using (exists (
  select 1 from public.profiles
  where id = (select auth.uid()) and status = 'active'::public.profile_status
));

-- Asignación de mesas a reservas: lectura para personal activo
drop policy if exists "Reservation tables viewable by active staff" on public.reservation_tables;
create policy "Reservation tables viewable by active staff"
on public.reservation_tables for select to authenticated
using (exists (
  select 1 from public.profiles
  where id = (select auth.uid()) and status = 'active'::public.profile_status
));

-- Asignación de mesas a reservas: gestión para personal activo
drop policy if exists "Reservation tables manageable by active staff" on public.reservation_tables;
create policy "Reservation tables manageable by active staff"
on public.reservation_tables for all to authenticated
using (exists (
  select 1 from public.profiles
  where id = (select auth.uid()) and status = 'active'::public.profile_status
));

-- =========================================================================
-- 6.5 Configuración Atómica del Plano del Salón (Transaccional)
-- Garantiza que el plano anterior NO se borre hasta que el nuevo plano
-- esté 100% validado y guardado en la base de datos (rollback automático en fallo).
-- =========================================================================
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
  v_active_res_count integer := 0;
  v_num integer;
  v_cap integer;
  v_max_cap integer;
  v_sec text;
  v_inserted_count integer := 0;
  v_audit_id uuid;
begin
  select id, role into v_actor
  from public.profiles where id = p_actor_id and status = 'active'::public.profile_status;
  if not found or v_actor.role <> 'super_admin'::public.app_role then
    raise exception 'Solo un Superadministrador puede inicializar o reemplazar el plano de mesas.' using errcode = '42501';
  end if;

  if p_tables is null or jsonb_array_length(p_tables) = 0 then
    raise exception 'Debe incluir al menos una mesa para configurar el plano.' using errcode = '22023';
  end if;

  if p_wipe then
    select count(*) into v_active_res_count
    from public.reservations
    where status in ('confirmed'::public.reservation_status, 'seated'::public.reservation_status);

    if v_active_res_count > 0 then
      raise exception 'No es posible reemplazar el plano anterior porque existen % reserva(s) confirmada(s) activas. Cancélelas o resuélvalas antes de generar un nuevo plano. El plano anterior permanece intacto.', v_active_res_count
        using errcode = '23P01';
    end if;

    -- En esta transacción ACID, si la inserción posterior falla, este delete se revierte automáticamente.
    delete from public.reservation_tables;
    delete from public.tables;
  end if;

  for v_item in select * from jsonb_array_elements(p_tables)
  loop
    v_num := (v_item->>'number')::integer;
    v_cap := (v_item->>'capacity')::integer;
    v_max_cap := coalesce((v_item->>'maxCapacity')::integer, v_cap);
    v_sec := coalesce(btrim(v_item->>'sector'), 'Salón Principal');

    if v_num is null or v_num <= 0 then
      raise exception 'Número de mesa inválido en la lista.' using errcode = '22003';
    end if;

    if v_cap is null or v_cap < 1 or v_cap > 30 then
      raise exception 'Capacidad inválida para Mesa % (debe ser 1 a 30).' using errcode = '22003';
    end if;

    insert into public.tables (number, capacity, max_capacity, sector, status, is_active)
    values (v_num, v_cap, v_max_cap, v_sec, 'available'::public.table_status, true);

    v_inserted_count := v_inserted_count + 1;
  end loop;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity, entity_id,
    new_values, status, reason
  ) values (
    v_actor.id, v_actor.role,
    case when p_wipe then 'floorplan.reinitialized_from_scratch' else 'floorplan.batch_tables_added' end,
    'tables', 'salon-layout',
    jsonb_build_object('count', v_inserted_count, 'wipe', p_wipe),
    'success', coalesce(btrim(p_reason), 'Configuración de plano de salón')
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'success', true,
    'count', v_inserted_count,
    'wipe', p_wipe
  );
end;
$function$;

revoke execute on function public.initialize_floor_plan_tx(jsonb, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.initialize_floor_plan_tx(jsonb, boolean, text, uuid) to service_role;

