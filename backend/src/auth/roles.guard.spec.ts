import { ForbiddenException, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'
import { RolesGuard } from './roles.guard'

function contextFor(role?: 'super_admin' | 'operational_admin') {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  } as unknown as ExecutionContext
}

describe('RolesGuard', () => {
  it('permite al super_admin', () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(['super_admin']) } as unknown as Reflector
    expect(new RolesGuard(reflector).canActivate(contextFor('super_admin'))).toBe(true)
  })

  it('responde 403 para el administrador operativo', () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(['super_admin']) } as unknown as Reflector
    expect(() => new RolesGuard(reflector).canActivate(contextFor('operational_admin')))
      .toThrow(ForbiddenException)
  })

  it('no impone rol si el handler no declara roles', () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(undefined) } as unknown as Reflector
    expect(new RolesGuard(reflector).canActivate(contextFor('operational_admin'))).toBe(true)
  })
})