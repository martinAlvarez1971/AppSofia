-- SOFIA · Fase 2A: Auditoría Persistente y Centro Privado de Alertas Administrativas
-- Fecha: 2026-10-27

-- 1. Ampliar public.audit_logs con metadatos contextuales de actor y entidades de sala
alter table public.audit_logs
  add column if not exists actor_role public.app_role,
  add column if not exists status varchar(20) not null default 'success',
  add column if not exists reason text,
  add column if not exists related_table_id varchar(50),
  add column if not exists related_reservation_id varchar(50);

-- Índices de consulta de auditoría
create index if not exists audit_logs_action_idx on public.audit_logs (action);
create index if not exists audit_logs_related_table_idx on public.audit_logs (related_table_id);
create index if not exists audit_logs_related_res_idx on public.audit_logs (related_reservation_id);

-- 2. Centro Privado de Alertas Administrativas (exclusivo para super_admin)
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

-- 3. Políticas RLS en admin_alerts
alter table public.admin_alerts enable row level security;
revoke all on table public.admin_alerts from public, anon, authenticated;

-- Solo el superadministrador activo puede consultar las alertas
create policy "Admin alerts visible exclusively to active super_admin"
on public.admin_alerts for select to authenticated
using ((select public.is_active_super_admin()));

-- Solo el superadministrador activo puede marcar alertas como revisadas
create policy "Only active super_admin can review alerts"
on public.admin_alerts for update to authenticated
using ((select public.is_active_super_admin()))
with check ((select public.is_active_super_admin()));

-- Nota de seguridad:
-- Los triggers previos `audit_logs_immutable` y `audit_logs_no_truncate`
-- protegen estrictamente a `audit_logs` frente a mutaciones o eliminaciones.
