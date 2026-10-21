# SOFIA API

API NestJS separada del frontend. Administra perfiles de Supabase Auth y escribe auditoría en PostgreSQL usando Prisma. La clave `SUPABASE_SERVICE_ROLE_KEY` solo se carga en este proceso y nunca se publica al navegador.

## Requisitos

- Node.js `>=22.12.0` y npm.
- Migración `20261020200000_user_management_audit.sql` aplicada al proyecto Supabase.
- URL de conexión de PostgreSQL. Usá la URL del pooler para la aplicación y la directa para Prisma CLI/migraciones.

## Configuración local

Desde la raíz:

```powershell
Copy-Item backend/.env.example backend/.env
```

Completá `backend/.env` con valores obtenidos de Supabase. No copies la clave `service_role` a `.env.local`, `VITE_*`, código React ni al repositorio. `DATABASE_URL` y `DIRECT_URL` contienen credenciales de PostgreSQL y deben mantenerse privadas.

En Auth de Supabase, habilitá la plantilla de invitación y permití `http://localhost:5173/auth/accept-invitation` como redirect. Para reset, permití `http://localhost:5173/auth/reset-password`. La ruta de invitación usa la sesión que Supabase establece desde el enlace para recibir una contraseña elegida por el usuario.

## Aplicar la migración pendiente

Revisá el destino y el SQL antes de ejecutar. Desde la raíz del proyecto:

```powershell
npx supabase migration list --linked
npx supabase db push --linked --skip-vault
```

No ejecutes el segundo comando contra producción sin autorización. Esta migración renombra `admin` a `operational_admin` y crea `audit_logs`; no crea usuarios ni datos de negocio. Prisma no aplica migraciones: el historial de esquema se gestiona con Supabase CLI.

## Ejecutar

```powershell
npm install --prefix backend
npm run prisma:validate --prefix backend
npm run dev:api
```

En otra terminal:

```powershell
npm run dev
```

La API escucha en `http://localhost:3000/api`. El cliente React usa `VITE_API_URL` (por defecto, `http://localhost:3000/api`).

## Endpoints

Todas las rutas requieren `Authorization: Bearer <access_token>` de Supabase Auth y el perfil debe estar activo. Todas las rutas de usuarios requieren además `super_admin`; el backend vuelve a consultar rol y estado en PostgreSQL en cada solicitud.

- `GET /api/users`: lista cuentas, rol, estado y fecha de creación.
- `POST /api/users`: invita un administrador operativo. Envía un enlace de invitación; no acepta ni almacena contraseñas temporales. Crear un `super_admin` por invitación se rechaza: transferí el rol a una cuenta operativa ya activa.
- `PATCH /api/users/:id/status`: activa o desactiva sin borrar la cuenta. Supabase Auth bloquea/desbloquea la cuenta y cada cambio se audita.
- `PATCH /api/users/:id/role`: transfiere el rol principal a otro usuario activo; el actor actual pasa a operativo en la misma transacción y debe cerrar sesión.
- `POST /api/users/:id/reset-password`: envía un enlace de recuperación por correo; no devuelve ni registra contraseñas.

La auditoría guarda actor, acción, entidad, UUID, valores anteriores/nuevos y fecha. La tabla usa RLS sin acceso directo de usuarios finales y bloquea UPDATE/DELETE. Las entradas se crean en la misma transacción PostgreSQL que los cambios de perfil.

## Pruebas externas pendientes

Para verificar integración real, usá un Supabase de prueba y valida: operativos reciben `403`; el principal puede listar/invitar; suspender una cuenta invalida el acceso al API; transferir el rol deja un solo principal; cada acción deja su fila de auditoría. No uses cuentas ni datos reales para esas pruebas.
