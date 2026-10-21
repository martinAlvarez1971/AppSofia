# Arquitectura de SOFIA · Fase 1

## Capas

- `src/app/`: composición de providers y rutas.
- `src/components/`: navegación, identidad visual y estados compartidos.
- `src/features/auth/`: sesión Supabase, acceso, recuperación y autorización de rutas.
- `src/features/dashboard/` y `src/features/users/`: panel y cliente de la API de cuentas.
- `src/lib/`: cliente Supabase opcional.
- `src/styles/`: estilos responsive.
- `supabase/migrations/`: cambios SQL versionados.
- `backend/src/auth/`: validación JWT, guard de roles y cliente Supabase server-side.
- `backend/src/users/`: DTOs y endpoints administrativos.
- `backend/src/prisma/` y `backend/prisma/`: persistencia, modelos y auditoría.

## Autenticación y permisos

Supabase Auth es la autoridad de identidad. El cliente oficial restaura y persiste sesiones con sus mecanismos de navegador; SOFIA no almacena contraseñas. El cliente consulta el perfil y bloquea rutas si la cuenta no está activa. Ese control es UX, no autorización: cada tabla futura debe imponer RLS y las operaciones privilegiadas deben ejecutarse en un backend confiable.

`public.profiles.id` referencia `auth.users.id`. Tras la migración pendiente, los roles son `super_admin` y `operational_admin`; los perfiles nuevos parten inactivos. El backend valida cada bearer token con Supabase Auth y vuelve a consultar estado/rol en PostgreSQL. Solo un `super_admin` activo puede llamar a `/api/users`.

`public.is_active_super_admin()` es `SECURITY DEFINER`, fija `search_path` vacío, califica objetos y comprueba únicamente `auth.uid()`. No recibe un UUID arbitrario y evita una consulta recursiva a `profiles` dentro de su propia política. Su ejecución se concede solo a `authenticated`.

## Límites de esta fase

- La clave publishable/anon es pública por diseño y solo resulta segura junto con RLS. No se incluye `service_role` en el cliente.
- Registro público, URLs permitidas, proveedores y correo son ajustes externos de Supabase que deben verificarse manualmente.
- La presencia de variables no prueba conectividad.
- `audit_logs` conserva actor, acción, entidad y valores anteriores/nuevos; RLS niega acceso directo y un trigger bloquea UPDATE/DELETE. La migración de usuarios/auditoría está versionada y debe aplicarse antes de arrancar la API.
- Las invitaciones se envían por Supabase Auth; no se almacenan contraseñas temporales. La clave `service_role` y `DATABASE_URL` solo existen en `backend/.env`.
- La transferencia de `super_admin` es única y revoca el rol del actor en la misma transacción; el frontend cierra su sesión después.
- Mesas, reservas y analítica quedan pendientes.

## Decisiones que condicionan reservas

Antes de modelarlas hay que acordar duración, zona horaria del local, estados que bloquean disponibilidad, asignaciones múltiples y cancelación. La exclusión de solapamientos debe ser transaccional en PostgreSQL, no un chequeo exclusivamente en navegador.

## Evolución

1. Gestión segura de cuentas y pruebas de autorización en Supabase.
2. Mesas, capacidades, horarios y combinaciones.
3. Reservas, concurrencia y auditoría.
4. Estadísticas basadas en datos reales.
5. Voz después de estabilizar entrada de texto y confirmación de cada acción.
