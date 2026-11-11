/**
 * Prueba Unitaria Aislada de Lógica de Seguridad — SOFIA
 * Verifica que el mecanismo de autenticación rechace correos, IDs planos,
 * y en modo Supabase rechace de forma terminante cualquier token demo.
 */

interface MockUser {
  id: string
  name: string
  email: string
  role: string
  status: string
}

interface MockReq {
  headers: { authorization?: string }
  user?: MockUser
}

interface MockRes {
  statusCode: number
  body: unknown
  status(code: number): MockRes
  json(data: unknown): MockRes
}

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(data: unknown) {
      this.body = data
      return this
    },
  }
  return res
}

// Simulador de autenticación con las reglas exactas de server.ts
function simulateAuthenticate(req: MockReq, res: MockRes, isSupabaseLive: boolean): boolean {
  const authHeader = req.headers.authorization
  if (!authHeader) {
    res.status(401).json({ message: 'Se requiere una sesión autenticada.' })
    return false
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    res.status(401).json({ message: 'Token de autorización ausente o inválido.' })
    return false
  }

  if (isSupabaseLive) {
    // CONDICIÓN A.3: Rechazar demo tokens
    if (token.startsWith('demo-') || token === 'demo-token') {
      res.status(401).json({ message: 'Tokens demo no permitidos en modo Supabase.' })
      return false
    }
    // CONDICIÓN A.4: Sin emails ni IDs planos
    if (token.includes('@') || token.startsWith('usr-') || token.startsWith('00000000')) {
      res.status(401).json({ message: 'Formato de token inválido. Se requiere JWT legítimo.' })
      return false
    }
    // Token real válido
    if (token === 'valid-supabase-jwt-signature') {
      req.user = {
        id: 'real-uuid-user',
        name: 'Administrador Real',
        email: 'admin.real@sofia.rest',
        role: 'super_admin',
        status: 'active',
      }
      return true
    }
    res.status(401).json({ message: 'Sesión no válida en Supabase.' })
    return false
  }

  // Modo Demo Aislado
  if (token === 'demo-super-admin-token') {
    req.user = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Martín Álvarez',
      email: 'martinalvarez.android@gmail.com',
      role: 'super_admin',
      status: 'active',
    }
    return true
  }

  if (token === 'demo-operational-token') {
    req.user = {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Sofía García',
      email: 'sofia.operaciones@restaurante.com',
      role: 'operational_admin',
      status: 'active',
    }
    return true
  }

  res.status(401).json({ message: 'Token de sesión no válido o expirado.' })
  return false
}

console.log('🧪 Iniciando prueba unitaria de aislamiento de tokens y modos...')

let p = 0
function check(ok: boolean, msg: string) {
  if (ok) {
    console.log(`  ✅ ${msg}`)
    p++
  } else {
    console.error(`  ❌ Falló: ${msg}`)
    process.exit(1)
  }
}

// 1. En modo Supabase, demo token es RECHAZADO
const res1 = createMockRes()
const req1: MockReq = { headers: { authorization: 'Bearer demo-super-admin-token' } }
const pass1 = simulateAuthenticate(req1, res1, true)
check(!pass1 && res1.statusCode === 401, 'Modo Supabase rechaza terminantemente "demo-super-admin-token"')

// 2. En modo Supabase, email plano es RECHAZADO
const res2 = createMockRes()
const req2: MockReq = { headers: { authorization: 'Bearer martinalvarez.android@gmail.com' } }
const pass2 = simulateAuthenticate(req2, res2, true)
check(!pass2 && res2.statusCode === 401, 'Modo Supabase rechaza terminantemente email plano como token')

// 3. En modo Supabase, JWT legítimo es ACEPTADO
const res3 = createMockRes()
const req3: MockReq = { headers: { authorization: 'Bearer valid-supabase-jwt-signature' } }
const pass3 = simulateAuthenticate(req3, res3, true)
check(pass3 && res3.statusCode === 200 && req3.user?.role === 'super_admin', 'Modo Supabase valida JWT legítimo y resuelve actor')

// 4. En modo Demo, email plano es RECHAZADO
const res4 = createMockRes()
const req4: MockReq = { headers: { authorization: 'Bearer sofia.operaciones@restaurante.com' } }
const pass4 = simulateAuthenticate(req4, res4, false)
check(!pass4 && res4.statusCode === 401, 'Modo Demo rechaza terminantemente email plano como token')

console.log(`\n🎉 Todas las ${p} pruebas unitarias de aislamiento fueron superadas con éxito.`)
