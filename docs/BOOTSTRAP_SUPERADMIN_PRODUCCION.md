# SOFIA · Procedimiento Oficial de Activación en Producción

Este documento contiene el procedimiento exacto para activar la integración con el proyecto Supabase existente y designar al Administrador Principal legítimo sin riesgos ni alteraciones accidentales.

---

## Paso 1: Aplicación del Script de Integración en Supabase

1. Abre el [Dashboard de Supabase](https://supabase.com/dashboard) de tu proyecto definitivo.
2. Dirígete a **SQL Editor** -> **New query**.
3. Copia el contenido del archivo `supabase/migrations/20261101_sofia_definitive_integration.sql` y pégalo en el editor.
4. Presiona **Run** (Ejecutar).
   - Este script es **completamente no destructivo**: no elimina tablas, no borra usuarios de `auth.users` ni modifica datos preexistentes.
   - Crea/adapta `profiles`, `audit_logs`, `admin_alerts`, `tables`, `reservations`, `reservation_tables` y las 5 funciones transaccionales ACID con permisos exclusivos para `service_role`.

---

## Paso 2: Designación Controlada del Superadministrador

1. En el Dashboard de Supabase, ve a **Authentication** -> **Users**.
2. Identifica tu cuenta de correo autorizada (ej. `martinalvarez.android@gmail.com`) y asegúrate de que tenga el correo confirmado.
3. Copia su **User UID** (un identificador con formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
4. Ve al **SQL Editor** y ejecuta la siguiente transacción atómica reemplazando `'TU_USER_UID_AQUI'` con el UID copiado:

```sql
begin;

do $bootstrap$
declare
  target_user_id uuid := 'TU_USER_UID_AQUI'; -- <-- Reemplazar por el UID verificado
begin
  -- Bloqueo consultivo de exclusión mutua para evitar carreras
  perform pg_advisory_xact_lock(202610201);

  if target_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Debe colocar un UID válido de auth.users';
  end if;

  if exists (select 1 from public.profiles where role = 'super_admin'::public.app_role and status = 'active'::public.profile_status) then
    raise exception 'Ya existe un Superadministrador activo en el sistema. Operación detenida.';
  end if;

  if not exists (
    select 1 from auth.users
    where id = target_user_id and email_confirmed_at is not null
  ) then
    raise exception 'La cuenta no existe en auth.users o su correo electrónico no ha sido confirmado aún.';
  end if;

  -- Crear o promover el perfil con los privilegios legítimos
  insert into public.profiles (id, email, role, status, updated_at)
  select id, lower(email), 'super_admin'::public.app_role, 'active'::public.profile_status, now()
  from auth.users
  where id = target_user_id
  on conflict (id) do update
  set role = 'super_admin'::public.app_role,
      status = 'active'::public.profile_status,
      updated_at = now();

  -- Registro en auditoría inmutable
  insert into public.audit_logs (
    actor_id, actor_role, action, entity, entity_id,
    new_values, status, reason
  ) values (
    target_user_id, 'super_admin'::public.app_role, 'system.super_admin_bootstrapped',
    'profiles', target_user_id::text,
    jsonb_build_object('role', 'super_admin', 'status', 'active'),
    'success', 'Inicialización oficial del Administrador Principal'
  );
end;
$bootstrap$;

commit;
```

---

## Paso 3: Vinculación de Credenciales en la Aplicación

Para que el backend de SOFIA se conecte en vivo al proyecto definitivo, define las siguientes variables de entorno:

| Variable | Descripción | Dónde se obtiene |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | URL de tu proyecto Supabase (`https://<project-ref>.supabase.co`) | Dashboard -> Project Settings -> API |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave pública (`anon` o `publishable`) para el frontend | Dashboard -> Project Settings -> API |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave secreta de servicio (`service_role`) para el backend | Dashboard -> Project Settings -> API |
| `ENFORCE_SUPABASE_AUTH` | `true` para activar el modo de producción obligatorio | Variable de configuración |

Una vez ingresadas las variables, la aplicación conmutará de inmediato a modo producción sin dependencias de memoria.
