import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { SupabaseService } from './supabase.service'
import type { UserRequest } from './auth.types'

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<UserRequest>()
    const authorization = request.headers.authorization
    const match = typeof authorization === 'string'
      ? /^Bearer\s+(\S+)$/i.exec(authorization)
      : null
    if (!match) throw new UnauthorizedException('Se requiere una sesión válida.')

    let user: { id: string; email?: string } | null = null
    try {
      const result = await this.supabase.publicClient.auth.getUser(match[1])
      user = result.error ? null : result.data.user
    } catch {
      throw new UnauthorizedException('No se pudo validar la sesión.')
    }
    if (!user?.email) throw new UnauthorizedException('La sesión no es válida o venció.')

    const profile = await this.prisma.profile.findUnique({
      where: { id: user.id },
      select: { id: true, role: true, status: true },
    })
    if (!profile || profile.status !== 'active') {
      throw new ForbiddenException('La cuenta está inactiva o no tiene un perfil habilitado.')
    }

    request.user = { id: profile.id, email: user.email, role: profile.role }
    return true
  }
}