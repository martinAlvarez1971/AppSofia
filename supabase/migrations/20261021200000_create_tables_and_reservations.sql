-- Migración de Fase 2: Gestión de Mesas y Reservas
-- SOFIA · Restaurante

create type public.table_status as enum ('active', 'inactive');
create type public.table_occupancy as enum ('free', 'occupied');
create type public.reservation_status as enum ('confirmed', 'seated', 'completed', 'cancelled', 'no_show');

-- 1. Tabla de Mesas
create table public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  number varchar(20) not null unique,
  capacity integer not null check (capacity >= 1 and capacity <= 30),
  min_capacity integer not null default 1 check (min_capacity >= 1 and min_capacity <= capacity),
  sector varchar(50),
  status public.table_status not null default 'active',
  is_out_of_service boolean not null default false,
  current_occupancy public.table_occupancy not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index restaurant_tables_sector_idx on public.restaurant_tables (sector);
create index restaurant_tables_status_idx on public.restaurant_tables (status, is_out_of_service);

-- Trigger updated_at para restaurant_tables
create or replace function public.set_restaurant_tables_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

create trigger restaurant_tables_set_updated_at
before update on public.restaurant_tables
for each row execute function public.set_restaurant_tables_updated_at();

-- 2. Tabla de Reservas
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  customer_name varchar(120) not null check (char_length(customer_name) >= 2),
  customer_phone varchar(30),
  customer_email varchar(120),
  party_size integer not null check (party_size >= 1 and party_size <= 50),
  start_time timestamptz not null,
  end_time timestamptz not null check (end_time > start_time),
  status public.reservation_status not null default 'confirmed',
  notes text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reservations_time_status_idx on public.reservations (start_time, end_time, status);
create index reservations_created_by_idx on public.reservations (created_by);

-- Trigger updated_at para reservations
create or replace function public.set_reservations_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

create trigger reservations_set_updated_at
before update on public.reservations
for each row execute function public.set_reservations_updated_at();

-- 3. Tabla intermedia: Asignación de Mesas a Reservas (M:N)
create table public.reservation_tables (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  table_id uuid not null references public.restaurant_tables (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint reservation_tables_unique_table_per_reservation unique (reservation_id, table_id)
);

create index reservation_tables_table_id_idx on public.reservation_tables (table_id);
create index reservation_tables_reservation_id_idx on public.reservation_tables (reservation_id);

-- 4. Seguridad RLS
alter table public.restaurant_tables enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_tables enable row level security;

-- Permisos sobre restaurant_tables:
-- Todos los usuarios autenticados activos pueden leer mesas
grant select on table public.restaurant_tables to authenticated;
grant usage on type public.table_status, public.table_occupancy to authenticated;

create policy "Tables are viewable by active authenticated staff"
on public.restaurant_tables for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.status = 'active'::public.profile_status
  )
);

-- Inserción, actualización y borrado de mesas solo para super_admin
create policy "Tables can be managed only by active super admin"
on public.restaurant_tables for all to authenticated
using (public.is_active_super_admin())
with check (public.is_active_super_admin());

-- Permisos sobre reservations:
grant select, insert, update on table public.reservations to authenticated;
grant usage on type public.reservation_status to authenticated;

create policy "Reservations viewable by active staff"
on public.reservations for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.status = 'active'::public.profile_status
  )
);

create policy "Reservations manageable by active staff"
on public.reservations for insert to authenticated
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.status = 'active'::public.profile_status
  )
);

create policy "Reservations updatable by active staff"
on public.reservations for update to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.status = 'active'::public.profile_status
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.status = 'active'::public.profile_status
  )
);

-- Permisos sobre reservation_tables:
grant select, insert, update, delete on table public.reservation_tables to authenticated;

create policy "Reservation tables viewable by active staff"
on public.reservation_tables for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.status = 'active'::public.profile_status
  )
);

create policy "Reservation tables manageable by active staff"
on public.reservation_tables for all to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.status = 'active'::public.profile_status
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.status = 'active'::public.profile_status
  )
);
