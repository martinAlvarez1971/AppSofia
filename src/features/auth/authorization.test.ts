import { describe, expect, it } from 'vitest'
import { getAccessDecision } from './authorization'

const admin = { loading: false, configured: true, userId: 'u1', profile: { role: 'operational_admin' as const, status: 'active' as const }, error: false }

describe('getAccessDecision', () => {
  it('bloquea mientras verifica la sesión o falta configuración', () => {
    expect(getAccessDecision({ ...admin, loading: true })).toBe('loading')
    expect(getAccessDecision({ ...admin, configured: false })).toBe('unconfigured')
  })
  it('requiere sesión y perfil activo', () => {
    expect(getAccessDecision({ ...admin, userId: null })).toBe('unauthenticated')
    expect(getAccessDecision({ ...admin, profile: { role: 'operational_admin', status: 'inactive' } })).toBe('pending')
    expect(getAccessDecision({ ...admin, error: true })).toBe('error')
  })
  it('limita la ruta administrativa al superadmin', () => {
    expect(getAccessDecision(admin, ['super_admin'])).toBe('forbidden')
    expect(getAccessDecision({ ...admin, profile: { role: 'super_admin', status: 'active' } }, ['super_admin'])).toBe('allowed')
  })
})