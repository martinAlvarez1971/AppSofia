create type public.app_role as enum ('super_admin', 'admin');
create type public.profile_status as enum ('active', 'inactive');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text check (first_name is null or char_length(first_name) <= 100),
  last_name text check (last_name is null or char_length(last_name) <= 100),
  email text not null unique check (email = lower(email)),
  role public.app_role not null default 'admin',
  status public.profile_status not null default 'inactive',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_single_super_admin
on public.profiles (role)
where role = 'super_admin'::public.app_role;

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (first_name, last_name) on table public.profiles to authenticated;
grant usage on type public.app_role, public.profile_status to authenticated;

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

create policy "Profiles are visible to their owner or an active super admin"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_active_super_admin()));

create policy "Users can update only their own display name"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

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
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_profile_updated_at();

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

  insert into public.profiles (id, first_name, last_name, email)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), 100), ''),
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'last_name', '')), 100), ''),
    lower(new.email)
  )
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$function$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
create trigger on_auth_user_created_or_email_changed
after insert or update of email on auth.users
for each row execute function public.handle_new_auth_user();
