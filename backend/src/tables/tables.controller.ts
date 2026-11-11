import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { CurrentUser } from '../auth/current-user.decorator'
import type { AuthenticatedActor } from '../auth/auth.types'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard'
import { TableStatus } from '../generated/prisma/enums'
import {
  CreateTableDto,
  UpdateTableDto,
  UpdateTableOccupancyDto,
  UpdateTableServiceDto,
  UpdateTableStatusDto,
} from './dto/tables.dto'
import { TablesService } from './tables.service'

@Controller('tables')
@UseGuards(SupabaseAuthGuard, RolesGuard)
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  list(
    @Query('sector') sector?: string,
    @Query('minCapacity') minCapacity?: string,
    @Query('status') status?: TableStatus,
    @Query('search') search?: string,
  ) {
    return this.tables.list({
      sector,
      minCapacity: minCapacity ? Number.parseInt(minCapacity, 10) : undefined,
      status,
      search,
    })
  }

  @Get(':id')
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.tables.getById(id)
  }

  @Post()
  @Roles('super_admin')
  create(@CurrentUser() actor: AuthenticatedActor, @Body() input: CreateTableDto) {
    return this.tables.create(actor, input)
  }

  @Patch(':id')
  @Roles('super_admin')
  update(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateTableDto,
  ) {
    return this.tables.update(actor, id, input)
  }

  @Patch(':id/status')
  @Roles('super_admin')
  updateStatus(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateTableStatusDto,
  ) {
    return this.tables.updateStatus(actor, id, input)
  }

  @Patch(':id/service')
  @Roles('super_admin')
  updateService(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateTableServiceDto,
  ) {
    return this.tables.updateService(actor, id, input)
  }

  @Patch(':id/occupancy')
  updateOccupancy(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateTableOccupancyDto,
  ) {
    return this.tables.updateOccupancy(actor, id, input)
  }
}
