import { SetMetadata } from '@nestjs/common'

export const ROLES_KEY = 'sofia:required-roles'
export type AppRole = 'super_admin' | 'operational_admin'
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles)