# Inicializar el primer administrador principal

Procedimiento manual para una persona autorizada con acceso al Dashboard/SQL Editor de Supabase. No hay endpoint público ni cuenta con contraseña predeterminada. Verificá el proyecto destino antes de ejecutar instrucciones.

## Preparación

1. Revisá y aplicá, en orden, `supabase/migrations/20261020120000_create_profiles.sql` y `supabase/migrations/20261020200000_user_management_audit.sql` en el proyecto correcto.
2. Desactivá el registro público en Supabase Auth.
3. Desde el Dashboard de Auth, creá o invitá la cuenta responsable mediante un mecanismo seguro de establecimiento de contraseña.
4. Confirmá el UUID en `auth.users`, verificá que el correo esté confirmado y que el trigger haya creado un perfil `operational_admin` e `inactive`.
5. Sustituí el UUID de ceros del bloque siguiente por el UUID verificado. No cambies las condiciones de seguridad.

## Asignación única

Ejecutá una sola vez en el SQL Editor del proyecto revisado. La transacción serializa inicializaciones concurrentes, comprueba que no exista `super_admin`, verifica la cuenta Auth y su correo confirmado, y solo promueve un perfil en su estado inicial esperado.

```sql
begin;

do $bootstrap$
declare
  target_user_id uuid := '00000000-0000-0000-0000-000000000000';
begin
  perform pg_advisory_xact_lock(202610201);
  if target_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Reemplazá el UUID de ejemplo por el UUID verificado';
  end if;
  if exists (select 1 from public.profiles where role = 'super_admin'::public.app_role) then
    raise exception 'Ya existe un perfil super_admin; se cancela el bootstrap';
  end if;
  if not exists (
    select 1 from auth.users
    where id = target_user_id and email_confirmed_at is not null
  ) then
    raise exception 'La cuenta Auth no existe o su correo no está confirmado';
  end if;
  update public.profiles
  set role = 'super_admin'::public.app_role,
      status = 'active'::public.profile_status
  where id = target_user_id
    and role = 'operational_admin'::public.app_role
    and status = 'inactive'::public.profile_status;
  if not found then
    raise exception 'El perfil no existe o no está en el estado inicial esperado';
  end if;
end;
$bootstrap$;

commit;
```

Ante cualquier error, la transacción se revierte. No elimines la comprobación de administrador existente para reintentar; investigá primero. La futura gestión de cuentas deberá usar backend confiable, auditoría y pruebas, nunca `service_role` en React.
