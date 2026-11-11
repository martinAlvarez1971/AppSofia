import {
  BadRequestException,
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
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
      return {
        id: r.id,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        customerEmail: r.customer_email,
        partySize: r.party_size,
        reservationDate: r.reservation_date,
        startTime: r.start_time,
        endTime: r.end_time,
        status: r.status,
        notes: r.notes,
        tableId: tableIds[0] || null,
        tableIds,
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
  ) {
    const {
      customerName,
      customerPhone,
      customerEmail,
      partySize,
      reservationDate,
      startTime,
      durationMinutes,
      tableIds,
      notes,
      reason = 'Creación de reserva',
    } = body

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'create_reservation_tx',
      {
        p_customer_name: customerName ? String(customerName).trim() : 'Cliente',
        p_customer_phone: customerPhone ? String(customerPhone).trim() : null,
        p_customer_email: customerEmail ? String(customerEmail).trim() : null,
        p_party_size: parseInt(partySize, 10),
        p_reservation_date: reservationDate,
        p_start_time: startTime,
        p_duration_minutes: durationMinutes ? parseInt(durationMinutes, 10) : null,
        p_table_ids: Array.isArray(tableIds) ? tableIds : [],
        p_notes: notes ? String(notes).trim() : null,
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
      },
    )

    if (txError) {
      throw new BadRequestException(txError.message)
    }

    return txData
  }

  @Post(':id/reassign-tables')
  async reassignTables(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
  ) {
    const { newTableIds, reason = 'Reasignación de mesas de reserva' } = body

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'reassign_reservation_tables_tx',
      {
        p_reservation_id: id,
        p_new_table_ids: Array.isArray(newTableIds) ? newTableIds : [],
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
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
  ) {
    const { serverName, reason = 'Ubicación de clientes en mesa' } = body || {}

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'seat_reservation_tx',
      {
        p_reservation_id: id,
        p_server_name: serverName ? String(serverName).trim() : null,
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
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
  ) {
    const { reason = 'Cliente no se presentó a la reserva' } = body || {}

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'mark_reservation_no_show_tx',
      {
        p_reservation_id: id,
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
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
  ) {
    const { reason = 'Finalización de servicio de reserva' } = body || {}

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'complete_reservation_service_tx',
      {
        p_reservation_id: id,
        p_reason: String(reason).trim(),
        p_actor_id: user.id,
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
  ) {
    const { reason = 'Cancelación de reserva' } = body || {}

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'cancel_reservation_tx',
      {
        p_reservation_id: id,
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
