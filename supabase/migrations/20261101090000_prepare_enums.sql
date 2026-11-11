-- ============================================================================
-- SOFIA · MIGRACIÓN 1 DE 2: PREPARACIÓN IDEMPOTENTE DE TIPOS ENUMERADOS
-- Archivo: 20261101090000_prepare_enums.sql
-- 
-- OBJETIVO Y REQUISITO TRANSACCIONAL:
-- 1. Este archivo debe ejecutarse y CONFIRMARSE (COMMIT) de forma totalmente
--    independiente y previa a la migración estructural (20261101100000_definitive_schema.sql).
-- 2. En PostgreSQL (versiones 12+), las sentencias 'ALTER TYPE ... ADD VALUE'
--    prohíben la referencia al nuevo valor dentro de la misma transacción (error 55P04).
--    Al aislar la creación y actualización de ENUMs en su propio archivo/transacción,
--    PostgreSQL confirma el catálogo en pg_enum antes de que las tablas, funciones
--    y restricciones del esquema definitivo comiencen a compilarse.
-- 3. Idempotente: seguro para ejecutar múltiples veces sin efectos colaterales.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1.1 app_role
-- ----------------------------------------------------------------------------
do $$
declare
  v_type_kind "char";
begin
  select t.typtype
    into v_type_kind
  from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
    and t.typname = 'app_role';

  if not found then

    create type public.app_role as enum (
      'super_admin',
      'operational_admin'
    );

  elsif v_type_kind <> 'e' then

    raise exception
      'El objeto public.app_role existe, pero no es un ENUM. Tipo PostgreSQL: %',
      v_type_kind;

  else

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'app_role'
        and e.enumlabel = 'super_admin'
    ) then
      alter type public.app_role add value 'super_admin';
    end if;

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'app_role'
        and e.enumlabel = 'operational_admin'
    ) then
      alter type public.app_role add value 'operational_admin';
    end if;

  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1.2 profile_status
-- ----------------------------------------------------------------------------
do $$
declare
  v_type_kind "char";
begin
  select t.typtype
    into v_type_kind
  from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
    and t.typname = 'profile_status';

  if not found then

    create type public.profile_status as enum (
      'active',
      'inactive'
    );

  elsif v_type_kind <> 'e' then

    raise exception
      'El objeto public.profile_status existe, pero no es un ENUM. Tipo PostgreSQL: %',
      v_type_kind;

  else

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'profile_status'
        and e.enumlabel = 'active'
    ) then
      alter type public.profile_status add value 'active';
    end if;

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'profile_status'
        and e.enumlabel = 'inactive'
    ) then
      alter type public.profile_status add value 'inactive';
    end if;

  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1.3 table_status
-- ----------------------------------------------------------------------------
do $$
declare
  v_type_kind "char";
begin
  select t.typtype
    into v_type_kind
  from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
    and t.typname = 'table_status';

  if not found then

    create type public.table_status as enum (
      'available',
      'occupied',
      'reserved',
      'out_of_service'
    );

  elsif v_type_kind <> 'e' then

    raise exception
      'El objeto public.table_status existe, pero no es un ENUM. Tipo PostgreSQL: %',
      v_type_kind;

  else

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'table_status'
        and e.enumlabel = 'available'
    ) then
      alter type public.table_status add value 'available';
    end if;

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'table_status'
        and e.enumlabel = 'occupied'
    ) then
      alter type public.table_status add value 'occupied';
    end if;

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'table_status'
        and e.enumlabel = 'reserved'
    ) then
      alter type public.table_status add value 'reserved';
    end if;

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'table_status'
        and e.enumlabel = 'out_of_service'
    ) then
      alter type public.table_status add value 'out_of_service';
    end if;

  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1.4 reservation_status
-- ----------------------------------------------------------------------------
do $$
declare
  v_type_kind "char";
begin
  select t.typtype
    into v_type_kind
  from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
    and t.typname = 'reservation_status';

  if not found then

    create type public.reservation_status as enum (
      'confirmed',
      'seated',
      'completed',
      'cancelled',
      'no_show'
    );

  elsif v_type_kind <> 'e' then

    raise exception
      'El objeto public.reservation_status existe, pero no es un ENUM. Tipo PostgreSQL: %',
      v_type_kind;

  else

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'reservation_status'
        and e.enumlabel = 'confirmed'
    ) then
      alter type public.reservation_status add value 'confirmed';
    end if;

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'reservation_status'
        and e.enumlabel = 'seated'
    ) then
      alter type public.reservation_status add value 'seated';
    end if;

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'reservation_status'
        and e.enumlabel = 'completed'
    ) then
      alter type public.reservation_status add value 'completed';
    end if;

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'reservation_status'
        and e.enumlabel = 'cancelled'
    ) then
      alter type public.reservation_status add value 'cancelled';
    end if;

    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'reservation_status'
        and e.enumlabel = 'no_show'
    ) then
      alter type public.reservation_status add value 'no_show';
    end if;

  end if;
end $$;
