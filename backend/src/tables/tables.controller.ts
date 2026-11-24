import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  InternalServerErrorException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import crypto from 'node:crypto'
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { CurrentUser } from '../auth/current-user.decorator'
import { SupabaseService } from '../auth/supabase.service'
import type { AuthenticatedActor } from '../auth/auth.types'

@Controller('tables')
@UseGuards(SupabaseAuthGuard)
export class TablesController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  async getTables() {
    const { data: tablesData, error } = await this.supabase.adminClient
      .from('tables')
      .select('*')
      .order('number', { ascending: true })

    if (error) {
      throw new InternalServerErrorException(error.message)
    }

    const [{ data: resData }, { data: sessData }] = await Promise.all([
      this.supabase.adminClient
        .from('reservations')
        .select('id, status, reservation_tables(table_id)')
        .in('status', ['confirmed', 'seated']),
      this.supabase.adminClient
        .from('table_sessions')
        .select('*')
        .is('ended_at', null),
    ])

    const openSessionByTable = new Map<string, any>()
    for (const s of sessData || []) {
      openSessionByTable.set(s.table_id, {
        id: s.id,
        tableId: s.table_id,
        sessionType: s.session_type,
        serverName: s.server_name,
        partySize: s.party_size,
        startedAt: s.started_at,
        estimatedEndAt: s.estimated_end_at,
        reservationId: s.reservation_id,
      })
    }

    const enriched = (tablesData || []).map((t: any) => {
      const count = (resData || []).filter((r: any) =>
        r.reservation_tables?.some((rt: { table_id: string }) => rt.table_id === t.id),
      ).length
      const cap = t.capacity
      const shape = t.shape || (cap <= 2 ? 'round' : cap <= 4 ? 'square' : 'rectangle')
      const activeSession = openSessionByTable.get(t.id) || null
      return {
        id: t.id,
        number: t.number,
        sector: t.sector,
        capacity: t.capacity,
        maxCapacity: t.max_capacity ?? t.maxCapacity ?? t.capacity,
        status: t.status,
        isActive: t.is_active ?? t.isActive ?? true,
        shape,
        occupiedSince: activeSession?.startedAt || t.occupied_since || null,
        serverName: t.server_name || null,
        activeSession,
        upcomingReservationsCount: count,
      }
    })

    return enriched
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  async createTable(
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
  ) {
    const tableNum = parseInt(body.number, 10)
    if (isNaN(tableNum) || tableNum <= 0) {
      throw new BadRequestException('El número de mesa debe ser un entero positivo mayor a cero.')
    }
    const cap = parseInt(body.capacity, 10)
    if (isNaN(cap) || cap < 1 || cap > 20) {
      throw new BadRequestException('La capacidad de la mesa debe estar entre 1 y 20 personas.')
    }
    const maxCap = body.maxCapacity ? parseInt(body.maxCapacity, 10) : cap
    const sector = String(body.sector || 'Principal').trim()
    const shape = body.shape || (cap <= 2 ? 'round' : cap <= 4 ? 'square' : 'rectangle')
    const reason = String(body.reason || 'Alta de nueva mesa en plano del salón').trim()

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'create_table_tx',
      {
        p_number: tableNum,
        p_capacity: cap,
        p_max_capacity: maxCap,
        p_sector: sector,
        p_shape: shape,
        p_reason: reason,
        p_actor_id: user.id,
      },
    )

    if (txError) {
      const { data, error } = await this.supabase.adminClient
        .from('tables')
        .insert({
          number: tableNum,
          capacity: cap,
          max_capacity: maxCap,
          sector,
          shape,
          status: 'available',
          is_active: true,
        })
        .select()
        .single()
      if (error) throw new BadRequestException(error.message)
      return data
    }

    return txData
  }

  @Post('initialize-floorplan')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  async initializeFloorPlan(
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-idempotency-key') xIdempotencyKey?: string,
  ) {
    const rawTables = Array.isArray(body.tables) ? body.tables : []
    if (rawTables.length === 0) {
      throw new BadRequestException('Debe ingresar al menos una mesa para configurar el plano.')
    }
    const reason = String(body.reason || 'Configuración inicial del plano del salón').trim()
    const wipeExisting = Boolean(body.wipeExisting)

    const numbersSeen = new Set<number>()
    const sanitizedTables: Array<{
      number: number
      capacity: number
      maxCapacity: number
      sector: string
      shape: 'round' | 'square' | 'rectangle'
    }> = []

    for (const item of rawTables) {
      const num = parseInt(item.number, 10)
      if (isNaN(num) || num <= 0) {
        throw new BadRequestException(`Número de mesa inválido: ${item.number}. Debe ser mayor a 0.`)
      }
      if (numbersSeen.has(num)) {
        throw new BadRequestException(`Número de mesa duplicado: Mesa ${num}. Cada mesa debe tener un número identificatorio único.`)
      }
      numbersSeen.add(num)

      const cap = parseInt(item.capacity, 10)
      if (isNaN(cap) || cap < 1 || cap > 30) {
        throw new BadRequestException(`Capacidad de la Mesa ${num} inválida. Debe ser entre 1 y 30 personas.`)
      }

      const sec = (item.sector && typeof item.sector === 'string' && item.sector.trim().length > 0)
        ? item.sector.trim()
        : 'Salón Principal'

      const maxCap = Math.max(cap, parseInt(item.maxCapacity, 10) || cap)
      const shp = (item.shape === 'round' || item.shape === 'square' || item.shape === 'rectangle')
        ? item.shape
        : (cap <= 2 ? 'round' : cap <= 4 ? 'square' : 'rectangle')

      sanitizedTables.push({
        number: num,
        capacity: cap,
        maxCapacity: maxCap,
        sector: sec,
        shape: shp,
      })
    }

    const rawKey = (idempotencyKey || xIdempotencyKey || '').trim()
    const p_idempotency_key = rawKey.length >= 8 && rawKey.length <= 128
      ? rawKey
      : `sofia-init-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`

    const p_request_hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ op: 'initialize_floor_plan', tables: sanitizedTables, wipe: wipeExisting, reason }))
      .digest('hex')

    const { error: txError } = await this.supabase.adminClient.rpc(
      'initialize_floor_plan_tx',
      {
        p_tables: sanitizedTables,
        p_wipe: wipeExisting,
        p_reason: reason,
        p_actor_id: user.id,
        p_idempotency_key,
        p_request_hash,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    const [{ data: freshTables, error: tFetchErr }, { data: openSess }] = await Promise.all([
      this.supabase.adminClient.from('tables').select('*').order('number', { ascending: true }),
      this.supabase.adminClient.from('table_sessions').select('*').is('ended_at', null),
    ])

    if (tFetchErr) {
      throw new InternalServerErrorException(`Plano guardado, pero falló la lectura de mesas: ${tFetchErr.message}`)
    }

    const sessMap = new Map<string, any>()
    for (const s of openSess || []) {
      sessMap.set(s.table_id, {
        id: s.id,
        tableId: s.table_id,
        sessionType: s.session_type,
        guestsCount: s.guests_count,
        startedAt: s.started_at,
        expectedDurationMinutes: s.expected_duration_minutes,
        estimatedEndAt: s.estimated_end_at,
        endedAt: s.ended_at,
        closeReason: s.close_reason,
        notes: s.notes,
      })
    }

    const formatted = (freshTables || []).map((r: any) => {
      const activeSession = sessMap.get(r.id) || null
      return {
        id: r.id,
        number: r.number,
        sector: r.sector,
        capacity: r.capacity,
        maxCapacity: r.max_capacity ?? r.maxCapacity ?? r.capacity,
        status: r.status,
        isActive: r.is_active ?? r.isActive ?? true,
        shape: r.shape || (r.capacity <= 2 ? 'round' : r.capacity <= 4 ? 'square' : 'rectangle'),
        occupiedSince: activeSession?.startedAt || null,
        activeSession,
        upcomingReservationsCount: 0,
      }
    })

    return {
      message: 'Nuevo plano guardado con éxito en PostgreSQL.',
      count: formatted.length,
      tables: formatted,
    }
  }

  @Get(':id/check-capacity')
  async checkCapacity(@Param('id') id: string) {
    const { data, error } = await this.supabase.adminClient.rpc(
      'check_table_capacity_change',
      { p_table_id: id },
    )
    if (error) {
      return { allowed: true, warning: null }
    }
    return data
  }

  @Patch(':id/capacity')
  async updateCapacity(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
  ) {
    const capacity = parseInt(body.capacity, 10)
    const maxCapacity = body.maxCapacity ? parseInt(body.maxCapacity, 10) : capacity
    const reason = String(body.reason || 'Actualización de capacidad de mesa').trim()

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'update_table_capacity_tx',
      {
        p_table_id: id,
        p_new_capacity: capacity,
        p_new_max_capacity: maxCapacity,
        p_reason: reason,
        p_actor_id: user.id,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    return txData
  }

  @Get(':id/check-deactivation')
  async checkDeactivation(@Param('id') id: string) {
    const { data, error } = await this.supabase.adminClient.rpc(
      'check_table_deactivation',
      { p_table_id: id },
    )
    if (error) {
      return { allowed: true, warning: null }
    }
    return data
  }

  @Patch(':id/status')
  async setStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
  ) {
    const { status, isActive, reason = 'Cambio de estado o disponibilidad de mesa' } = body

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'set_table_status_tx',
      {
        p_table_id: id,
        p_status: status || null,
        p_is_active: typeof isActive === 'boolean' ? isActive : null,
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    return txData
  }

  @Post(':id/walk-in')
  async assignWalkIn(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
  ) {
    const { partySize, serverName, notes, durationMinutes, reason = 'Asignación espontánea walk-in' } = body

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'assign_walk_in_tx',
      {
        p_table_id: id,
        p_party_size: parseInt(partySize, 10),
        p_server_name: serverName ? String(serverName).trim() : null,
        p_notes: notes ? String(notes).trim() : null,
        p_duration_minutes: durationMinutes ? parseInt(durationMinutes, 10) : null,
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    return txData
  }

  @Post(':id/release-operational')
  async releaseOperational(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
  ) {
    const { reason = 'Liberación operativa de mesa' } = body || {}

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'release_table_operational_tx',
      {
        p_table_id: id,
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    return txData
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  async deleteTable(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
  ) {
    const { reason = 'Eliminación de mesa del plano' } = body || {}

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'delete_table_tx',
      {
        p_table_id: id,
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    return txData
  }
}

@Controller('table-sessions')
@UseGuards(SupabaseAuthGuard)
export class TableSessionsController {
  constructor(private readonly supabase: SupabaseService) {}

  @Patch(':id/extend')
  async extendSession(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
  ) {
    const { additionalMinutes, reason = 'Extensión de sesión de mesa' } = body

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'extend_table_session_tx',
      {
        p_session_id: id,
        p_additional_minutes: parseInt(additionalMinutes, 10),
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    return txData
  }

  @Post(':id/close')
  async closeSession(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
  ) {
    const { reason = 'Cierre de sesión de mesa' } = body || {}

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'close_table_session_tx',
      {
        p_session_id: id,
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    return txData
  }
}
