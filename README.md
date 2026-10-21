# SOFIA

SOFIA usa React, TypeScript y Vite en el frontend, Supabase Auth para identidad, PostgreSQL y un backend NestJS/Prisma para administración privilegiada. Esta entrega incorpora autenticación, gestión de cuentas y auditoría; las funciones de mesas y reservas aún no están implementadas.

## Requisitos e instalación

- Node.js `>=22.12.0` y npm.

```powershell
npm ci
npm ci --prefix backend
Copy-Item .env.example .env.local
Copy-Item backend/.env.example backend/.env
```

Completá `.env.local` con la URL y la clave pública *publishable* del proyecto Supabase:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

Se aceptan claves públicas `anon` heredadas. No pongas `service_role`, claves secretas ni credenciales administrativas en `VITE_*`: Vite las expone al navegador. `.env.local` está excluido de Git y `.env.example` no contiene credenciales. Sin variables, SOFIA deshabilita el acceso; si están presentes, la conectividad todavía no se considera verificada.

## Configurar Supabase

1. Creá o seleccioná un proyecto Supabase y obtené URL y clave publishable desde su configuración de API.
2. Desactivá el registro público en Auth. Las cuentas se invitan desde el backend.
3. Instalá Supabase CLI siguiendo su documentación oficial, iniciá sesión y vinculá el proyecto desde esta carpeta:

   ```powershell
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

   `db push` aplica migraciones pendientes al proyecto vinculado. Revisá primero el SQL y el destino. La migración de gestión de usuarios `20261020200000_user_management_audit.sql` está versionada pero todavía requiere aplicación autorizada.
4. En Auth, configurá la URL del sitio y permití `http://localhost:5173/auth/reset-password` y `http://localhost:5173/auth/accept-invitation` como redirecciones.
5. Completá `.env.local` y reiniciá Vite. Configurá `backend/.env` siguiendo [backend/README.md](backend/README.md); `SUPABASE_SERVICE_ROLE_KEY` y `DATABASE_URL` son exclusivamente del servidor.
6. Inicializá el primer administrador siguiendo [docs/INICIALIZAR_SUPER_ADMIN.md](docs/INICIALIZAR_SUPER_ADMIN.md).

Los perfiles iniciales se crean inactivos; el backend invita administradores y actualiza estado/rol con auditoría. Las invitaciones envían enlace por correo en lugar de contraseñas temporales.

## Desarrollo y verificaciones

```powershell
npm run dev
npm run dev:api
npm run typecheck
npm run lint
npm test
npm run build
npm run build:api
```

Las pruebas locales no requieren Supabase. Las pruebas reales de RLS requieren un proyecto de prueba aislado y cuentas de ambos roles; no uses datos reales. No hay despliegue configurado.

## Alcance

Mesas, reservas, combinaciones, estadísticas y voz siguen pendientes. La pantalla de cuentas usa NestJS; la autorización efectiva verifica JWT, estado y rol en backend/PostgreSQL y no depende de ocultar la navegación. Ver [backend/README.md](backend/README.md) y [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).
