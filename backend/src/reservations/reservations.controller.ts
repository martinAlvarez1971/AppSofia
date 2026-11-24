import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  InternalServerErrorException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import crypto from 'node:crypto'
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { SupabaseService } from '../auth/supabase.service'
import type { AuthenticatedActor } from '../auth/auth.types'

@Controller('reservations')
@UseGuards(SupabaseAuthGuard)
export class ReservationsController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  async getReservations() {
    const { data, error } = await this.supabase.adminClient
      .from('reservations')
      .select('*, reservation_tables(table_id, tables(*))')
      .order('reservation_date', { ascending: false })
      .order('start_time', { ascending: true })

    if (error) {
      throw new InternalServerErrorException(error.message)
    }

    const mapped = (data || []).map((r: any) => {
      const tables = (r.reservation_tables || []).map((rt: any) => rt.tables).filter(Boolean)
      const tableIds = (r.reservation_tables || []).map((rt: any) => rt.table_id)
      const tableNumbers = tables.map((t: any) => t.number).filter((n: any) => typeof n === 'number')
      const start = new Date(r.start_time)
      const timeFormatted = isNaN(start.getTime())
        ? ''
        : start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
      return {
        id: r.id,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        customerEmail: r.customer_email,
        guestsCount: r.guests_count,
        partySize: r.guests_count,
        reservationDate: r.reservation_date,
        startTime: r.start_time,
        endTime: r.end_time,
        time: `${r.reservation_date} ${timeFormatted} hs`,
        durationMinutes: r.duration_minutes,
        status: r.status,
        notes: r.notes || '',
        cancellationReason: r.cancellation_reason,
        tableId: tableIds[0] || null,
        tableNumber: tableNumbers[0] || null,
        tableIds,
        tableNumbers,
        tables,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }
    })

    return mapped
  }

  @Post()
  async createReservation(
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-idempotency-key') xIdempotencyKey?: string,
  ) {
    const customerName = String(body.customerName || '').trim()
    if (!customerName || customerName.length < 2) {
      throw new BadRequestException('El nombre del cliente debe tener al menos 2 caracteres.')
    }

    const guests = parseInt(body.guestsCount ?? body.partySize, 10)
    if (isNaN(guests) || guests < 1 || guests > 50) {
      throw new BadRequestException('La cantidad de comensales debe estar entre 1 y 50.')
    }

    let duration: number | null = null
    if (body.durationMinutes !== undefined && body.durationMinutes !== null && body.durationMinutes !== '') {
      duration = parseInt(body.durationMinutes, 10)
      if (isNaN(duration) || duration < 30 || duration > 360) {
        throw new BadRequestException('La duración debe estar entre 30 y 360 minutos.')
      }
    }

    const tableIds = Array.isArray(body.tableIds)
      ? body.tableIds
      : body.tableId
        ? [body.tableId]
        : []
    if (tableIds.length === 0) {
      throw new BadRequestException('Debe seleccionar al menos una mesa para la reserva.')
    }

    const parsedStart = new Date(body.startTime)
    if (isNaN(parsedStart.getTime())) {
      throw new BadRequestException('Fecha y hora de inicio no válidas.')
    }
    const isoStart = parsedStart.toISOString()

    const rawKey = (idempotencyKey || xIdempotencyKey || '').trim()
    const p_idempotency_key = rawKey.length >= 8 && rawKey.length <= 128
      ? rawKey
      : `sofia-res-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`

    const cleanPhone = body.customerPhone ? String(body.customerPhone).trim() : null
    const cleanEmail = body.customerEmail ? String(body.customerEmail).trim() : null
    const cleanNotes = body.notes ? String(body.notes).trim() : null

    const p_request_hash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          op: 'create_reservation',
          customerName,
          customerPhone: cleanPhone,
          customerEmail: cleanEmail,
          guestsCount: guests,
          startTime: isoStart,
          durationMinutes: duration,
          tableIds,
          notes: cleanNotes,
        }),
      )
      .digest('hex')

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'create_reservation_with_tables_tx',
      {
        p_customer_name: customerName,
        p_customer_phone: cleanPhone,
        p_customer_email: cleanEmail,
        p_guests_count: guests,
        p_start_time: isoStart,
        p_duration_minutes: duration,
        p_table_ids: tableIds,
        p_notes: cleanNotes,
        p_created_by: user.id,
        p_idempotency_key,
        p_request_hash,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    const { data: tblMeta } = await this.supabase.adminClient
      .from('tables')
      .select('id, number')
      .in('id', tableIds)
      .order('number', { ascending: true })

    return {
      ...(txData || {}),
      tableId: tblMeta?.[0]?.id || tableIds[0],
      tableNumber: tblMeta?.[0]?.number || 0,
      tableIds,
      tableNumbers: (tblMeta || []).map((t: any) => t.number),
    }
  }

  @Post(':id/reassign-tables')
  async reassignTables(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-idempotency-key') xIdempotencyKey?: string,
  ) {
    const { newTableIds = [], tableIds = [], reason = 'Reasignación de mesas de reserva' } = body
    const finalTableIds = Array.isArray(newTableIds) && newTableIds.length > 0
      ? newTableIds
      : Array.isArray(tableIds)
        ? tableIds
        : []

    if (finalTableIds.length === 0) {
      throw new BadRequestException('Debe especificar al menos una mesa.')
    }

    const rawKey = (idempotencyKey || xIdempotencyKey || '').trim()
    const p_idempotency_key = rawKey.length >= 8 && rawKey.length <= 128
      ? rawKey
      : `sofia-reassign-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`

    const p_request_hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ op: 'reassign_tables', reservationId: id, tableIds: finalTableIds }))
      .digest('hex')

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'reassign_reservation_tables_tx',
      {
        p_reservation_id: id,
        p_new_table_ids: finalTableIds,
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
        p_idempotency_key,
        p_request_hash,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    return txData
  }

  @Post(':id/seat')
  async seatReservation(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-idempotency-key') xIdempotencyKey?: string,
  ) {
    const { expectedDurationMinutes, notes } = body || {}
    const rawKey = (idempotencyKey || xIdempotencyKey || '').trim()
    const p_idempotency_key = rawKey.length >= 8 && rawKey.length <= 128
      ? rawKey
      : `sofia-seat-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`

    const p_request_hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ op: 'seat_reservation', reservationId: id, expectedDurationMinutes, notes }))
      .digest('hex')

    const expDur = expectedDurationMinutes ? parseInt(expectedDurationMinutes, 10) : null

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'seat_reservation_tx',
      {
        p_reservation_id: id,
        p_expected_duration_minutes: expDur,
        p_notes: notes ? String(notes).trim() : null,
        p_actor_id: user.id,
        p_idempotency_key,
        p_request_hash,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    return txData
  }

  @Post(':id/no-show')
  async markNoShow(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-idempotency-key') xIdempotencyKey?: string,
  ) {
    const { reason = 'Cliente no se presentó a la reserva' } = body || {}
    const rawKey = (idempotencyKey || xIdempotencyKey || '').trim()
    const p_idempotency_key = rawKey.length >= 8 && rawKey.length <= 128
      ? rawKey
      : `sofia-noshow-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`

    const p_request_hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ op: 'mark_no_show', reservationId: id, reason }))
      .digest('hex')

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'mark_reservation_no_show_tx',
      {
        p_reservation_id: id,
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
        p_idempotency_key,
        p_request_hash,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    return txData
  }

  @Post(':id/complete-service')
  async completeService(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-idempotency-key') xIdempotencyKey?: string,
  ) {
    const { notes } = body || {}
    const rawKey = (idempotencyKey || xIdempotencyKey || '').trim()
    const p_idempotency_key = rawKey.length >= 8 && rawKey.length <= 128
      ? rawKey
      : `sofia-complete-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`

    const p_request_hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ op: 'complete_service', reservationId: id, notes }))
      .digest('hex')

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'complete_service_tx',
      {
        p_reservation_id: id,
        p_notes: notes ? String(notes).trim() : null,
        p_actor_id: user.id,
        p_idempotency_key,
        p_request_hash,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    return txData
  }

  @Post(':id/cancel')
  async cancelReservation(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-idempotency-key') xIdempotencyKey?: string,
  ) {
    const { reason = 'Cancelación de reserva' } = body || {}
    const rawKey = (idempotencyKey || xIdempotencyKey || '').trim()
    const p_idempotency_key = rawKey.length >= 8 && rawKey.length <= 128
      ? rawKey
      : `sofia-cancel-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`

    const p_request_hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ op: 'cancel_reservation', reservationId: id, reason }))
      .digest('hex')

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'cancel_reservation_tx',
      {
        p_reservation_id: id,
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
        p_idempotency_key,
        p_request_hash,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    return txData
  }
}
