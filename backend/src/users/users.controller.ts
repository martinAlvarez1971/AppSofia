import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { CurrentUser } from '../auth/current-user.decorator'
import type { AuthenticatedActor } from '../auth/auth.types'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard'
import { CreateUserDto, UpdateUserRoleDto, UpdateUserStatusDto } from './dto/user.dto'
import { UsersService } from './users.service'

@Controller('users')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('super_admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedActor) {
    return this.users.list(actor)
  }

  @Post()
  create(@CurrentUser() actor: AuthenticatedActor, @Body() input: CreateUserDto) {
    return this.users.create(actor, input)
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateUserStatusDto,
  ) {
    return this.users.updateStatus(actor, id, input.status)
  }

  @Patch(':id/role')
  updateRole(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateUserRoleDto,
  ) {
    return this.users.updateRole(actor, id, input.role)
  }

  @Post(':id/reset-password')
  resetPassword(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.users.resetPassword(actor, id)
  }
}