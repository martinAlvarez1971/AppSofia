alter type public.app_role rename value 'admin' to 'operational_admin';

alter table public.profiles
  add constraint profiles_super_admin_must_be_active
  check (
    role <> 'super_admin'::public.app_role
    or status = 'active'::public.profile_status
  );

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles (id) on delete restrict,
  action varchar(80) not null,
  entity varchar(80) not null,
  entity_id uuid not null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_created_at_idx
  on public.audit_logs (entity, entity_id, created_at desc);
create index audit_logs_actor_created_at_idx
  on public.audit_logs (actor_id, created_at desc);

alter table public.audit_logs enable row level security;
revoke all on table public.audit_logs from public, anon, authenticated;

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'Audit logs are immutable';
end;
$function$;

revoke all on function public.prevent_audit_log_mutation() from public, anon, authenticated;

create trigger audit_logs_immutable
before update or delete on public.audit_logs
for each row execute function public.prevent_audit_log_mutation();

create trigger audit_logs_no_truncate
before truncate on public.audit_logs
for each statement execute function public.prevent_audit_log_mutation();
