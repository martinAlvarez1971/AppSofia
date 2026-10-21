import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AppRole as PrismaAppRole, ProfileStatus } from '../generated/prisma/enums'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SupabaseService } from '../auth/supabase.service'
import type { AuthenticatedActor } from '../auth/auth.types'
import { CreateUserDto, UserRoleDto, UserStatusDto } from './dto/user.dto'

const inactiveBan = '876000h'

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  async list(actor: AuthenticatedActor) {
    const profiles = await this.prisma.$transaction(async (tx) => {
      await this.acquireUserManagementLock(tx)
      await this.assertActiveSuperAdmin(actor.id, tx)
      return tx.profile.findMany({ orderBy: { createdAt: 'desc' } })
    })
    return profiles.map((profile) => this.toUser(profile))
  }

  async create(actor: AuthenticatedActor, input: CreateUserDto) {
    await this.assertActiveSuperAdmin(actor.id)
    if (input.role === UserRoleDto.super_admin) {
      throw new ConflictException(
        'El principal es único. Creá primero una cuenta operativa y transferí el rol desde esa cuenta una vez que esté activa.',
      )
    }

    if (await this.prisma.profile.findUnique({ where: { email: input.email } })) {
      throw new ConflictException('Ya existe un perfil con ese correo.')
    }

    let invitedUserId: string
    try {
      const { data, error } = await this.supabase.adminClient.auth.admin.inviteUserByEmail(
        input.email,
        {
          data: { first_name: input.firstName, last_name: input.lastName },
          redirectTo: this.config.getOrThrow<string>('INVITATION_REDIRECT_URL'),
        },
      )
      if (error || !data.user) {
        if (error?.status === 422 || error?.code === 'email_exists') {
          throw new ConflictException('Ya existe una cuenta con ese correo.')
        }
        throw new BadGatewayException('Supabase no pudo enviar la invitación.')
      }
      invitedUserId = data.user.id
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadGatewayException) throw error
      throw new BadGatewayException('Supabase no pudo enviar la invitación.')
    }

    try {
      const profile = await this.prisma.$transaction(async (tx) => {
        await this.acquireUserManagementLock(tx)
        await this.assertActiveSuperAdmin(actor.id, tx)
        const created = await tx.profile.findUnique({ where: { id: invitedUserId } })
        if (!created) throw new BadGatewayException('Supabase no creó el perfil esperado.')

        const updated = await tx.profile.update({
          where: { id: invitedUserId },
          data: {
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            role: PrismaAppRole.operational_admin,
            status: ProfileStatus.active,
          },
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'user.invited',
            entity: 'profile',
            entityId: updated.id,
            oldValues: { role: created.role, status: created.status },
            newValues: {
              firstName: updated.firstName,
              lastName: updated.lastName,
              email: updated.email,
              role: updated.role,
              status: updated.status,
            },
          },
        })
        return updated
      })
      return { user: this.toUser(profile), invitationSent: true }
    } catch (error) {
      try {
        await this.suspendWithoutDeleting(invitedUserId)
      } catch {
        throw new ServiceUnavailableException(
          'No se pudo finalizar la invitación ni confirmar el bloqueo de la cuenta. Revisá el usuario en Supabase Auth antes de reintentar.',
        )
      }
      throw error
    }
  }

  async updateStatus(actor: AuthenticatedActor, id: string, status: UserStatusDto) {
    let previousStatus: ProfileStatus | null = null
    let authChanged = false
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await this.acquireUserManagementLock(tx)
        await this.assertActiveSuperAdmin(actor.id, tx)
        const current = await tx.profile.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('No se encontró esa cuenta.')
        if (current.id === actor.id) throw new ConflictException('No podés desactivar tu propia cuenta.')
        if (current.role === PrismaAppRole.super_admin && status === UserStatusDto.inactive) {
          throw new ConflictException('Transferí primero el rol principal a una cuenta activa.')
        }
        if (current.status === status) return current

        const { error: authError } = await this.supabase.adminClient.auth.admin.updateUserById(id, {
          ban_duration: status === UserStatusDto.inactive ? inactiveBan : 'none',
        })
        if (authError) throw new BadGatewayException('Supabase no pudo actualizar el acceso de la cuenta.')
        previousStatus = current.status
        authChanged = true

        const result = await tx.profile.updateMany({
          where: { id, status: current.status },
          data: { status },
        })
        if (result.count !== 1) throw new ConflictException('La cuenta cambió mientras se procesaba la solicitud.')
        const profile = await tx.profile.findUniqueOrThrow({ where: { id } })
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'user.status_changed',
            entity: 'profile',
            entityId: id,
            oldValues: { status: current.status },
            newValues: { status: profile.status },
          },
        })
        return profile
      })
      return this.toUser(updated)
    } catch (error) {
      if (authChanged && previousStatus) {
        try {
          await this.restoreAuthBan(id, previousStatus)
        } catch {
          throw new ServiceUnavailableException(
            'PostgreSQL rechazó el cambio y no se pudo confirmar la compensación en Supabase Auth. Revisá el estado de la cuenta antes de reintentar.',
          )
        }
      }
      throw error
    }
  }

  async updateRole(actor: AuthenticatedActor, id: string, role: UserRoleDto) {
    if (id === actor.id) throw new ConflictException('No podés cambiar tu propio rol desde esta operación.')

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.acquireUserManagementLock(tx)
        await this.assertActiveSuperAdmin(actor.id, tx)
        const target = await tx.profile.findUnique({ where: { id } })
        if (!target) throw new NotFoundException('No se encontró esa cuenta.')
        if (target.status !== ProfileStatus.active) {
          throw new ConflictException('Solo se puede transferir el rol principal a una cuenta activa.')
        }
        if (target.role === role) return { user: target, currentUserDemoted: false }

        if (role === UserRoleDto.super_admin) {
          const principal = await tx.profile.findFirst({ where: { role: PrismaAppRole.super_admin } })
          if (principal && principal.id !== actor.id) {
            throw new ConflictException('Ya existe otro administrador principal.')
          }
          const actorProfile = await tx.profile.update({
            where: { id: actor.id },
            data: { role: PrismaAppRole.operational_admin },
          })
          const updated = await tx.profile.update({
            where: { id },
            data: { role: PrismaAppRole.super_admin },
          })
          await tx.auditLog.createMany({
            data: [
              {
                actorId: actor.id,
                action: 'user.role_changed',
                entity: 'profile',
                entityId: actor.id,
                oldValues: { role: PrismaAppRole.super_admin },
                newValues: { role: actorProfile.role },
              },
              {
                actorId: actor.id,
                action: 'user.role_changed',
                entity: 'profile',
                entityId: id,
                oldValues: { role: target.role },
                newValues: { role: updated.role },
              },
            ],
          })
          return { user: updated, currentUserDemoted: true }
        }

        if (target.role === PrismaAppRole.super_admin) {
          throw new ConflictException('Transferí primero el rol principal a otra cuenta activa.')
        }
        const updated = await tx.profile.update({
          where: { id },
          data: { role: PrismaAppRole.operational_admin },
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'user.role_changed',
            entity: 'profile',
            entityId: id,
            oldValues: { role: target.role },
            newValues: { role: updated.role },
          },
        })
        return { user: updated, currentUserDemoted: false }
      })
      return { ...this.toUser(result.user), currentUserDemoted: result.currentUserDemoted }
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        throw new ConflictException('Solo puede existir un administrador principal.')
      }
      throw error
    }
  }

  async resetPassword(actor: AuthenticatedActor, id: string) {
    if (id === actor.id) throw new ConflictException('Usá la recuperación de contraseña de tu propia cuenta.')
    await this.prisma.$transaction(async (tx) => {
      await this.acquireUserManagementLock(tx)
      await this.assertActiveSuperAdmin(actor.id, tx)
      const profile = await tx.profile.findUnique({ where: { id } })
      if (!profile) throw new NotFoundException('No se encontró esa cuenta.')
      if (profile.status !== ProfileStatus.active) {
        throw new ConflictException('La cuenta está desactivada; habilitala antes de restablecer el acceso.')
      }

      const { error } = await this.supabase.publicClient.auth.resetPasswordForEmail(profile.email, {
        redirectTo: this.config.getOrThrow<string>('PASSWORD_RESET_REDIRECT_URL'),
      })
      if (error) throw new BadGatewayException('Supabase no pudo enviar el enlace de recuperación.')

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'user.password_reset_requested',
          entity: 'profile',
          entityId: id,
          newValues: { delivery: 'email' },
        },
      })
    })
    return { message: 'Se envió un enlace de recuperación al correo de la cuenta.' }
  }

  private findProfile(id: string) {
    return this.prisma.profile.findUnique({ where: { id } }).then((profile) => {
      if (!profile) throw new NotFoundException('No se encontró esa cuenta.')
      return profile
    })
  }

  private async acquireUserManagementLock(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(202610202001)`
  }

  private async assertActiveSuperAdmin(
    id: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const profile = await tx.profile.findUnique({
      where: { id },
      select: { role: true, status: true },
    })
    if (!profile || profile.status !== ProfileStatus.active || profile.role !== PrismaAppRole.super_admin) {
      throw new ForbiddenException('La cuenta ya no tiene permisos de administrador principal.')
    }
  }

  private async suspendWithoutDeleting(id: string) {
    try {
      const { error } = await this.supabase.adminClient.auth.admin.updateUserById(id, { ban_duration: inactiveBan })
      if (error) throw error
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo confirmar el bloqueo de la cuenta invitada; revisá su estado en Supabase Auth.',
      )
    }
  }

  private async restoreAuthBan(id: string, oldStatus: ProfileStatus) {
    try {
      const { error } = await this.supabase.adminClient.auth.admin.updateUserById(id, {
        ban_duration: oldStatus === ProfileStatus.inactive ? inactiveBan : 'none',
      })
      if (error) throw error
    } catch {
      throw new ServiceUnavailableException('No se pudo restaurar el estado de acceso en Supabase Auth.')
    }
  }

  private isUniqueConstraint(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
  }

  private toUser(profile: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string
    role: PrismaAppRole
    status: ProfileStatus
    createdAt: Date
  }) {
    return {
      id: profile.id,
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      role: profile.role,
      status: profile.status,
      createdAt: profile.createdAt,
    }
  }
}