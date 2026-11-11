-- ============================================================================
-- SOFIA · CARGA INICIAL DE MESAS INTELIGENTES DEL SALÓN
-- Ejecutar en el SQL Editor de Supabase si deseas inicializar las 13 mesas
-- arquitectónicas con sus sectores, capacidades y geometrías.
--
-- GARANTÍA: Utiliza ON CONFLICT (number) DO NOTHING para no sobrescribir mesas existentes.
-- ============================================================================

insert into public.tables (number, sector, capacity, max_capacity, status, is_active, updated_at)
values
  -- Sector 1: Salón Principal
  (1, 'Salón Principal', 4, 4, 'available'::public.table_status, true, now()),
  (2, 'Salón Principal', 2, 2, 'available'::public.table_status, true, now()),
  (3, 'Salón Principal', 6, 8, 'available'::public.table_status, true, now()),
  (4, 'Salón Principal', 4, 6, 'available'::public.table_status, true, now()),
  (5, 'Salón Principal', 8, 10, 'available'::public.table_status, true, now()),

  -- Sector 2: Afuera o Exterior
  (6, 'Afuera o Exterior', 4, 4, 'available'::public.table_status, true, now()),
  (7, 'Afuera o Exterior', 4, 4, 'available'::public.table_status, true, now()),
  (8, 'Afuera o Exterior', 6, 6, 'available'::public.table_status, true, now()),

  -- Sector 3: Terraza
  (9, 'Terraza', 2, 2, 'available'::public.table_status, true, now()),
  (10, 'Terraza', 4, 4, 'available'::public.table_status, true, now()),
  (11, 'Terraza', 4, 5, 'available'::public.table_status, true, now()),

  -- Sector 4: Salón Chico
  (12, 'Salón Chico', 4, 4, 'available'::public.table_status, true, now()),
  (13, 'Salón Chico', 6, 8, 'available'::public.table_status, true, now())
on conflict (number) do nothing;
