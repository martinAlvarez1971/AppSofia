import {
  BadRequestException,
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Put,
  UseGuards,
} from '@nestjs/common'
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { CurrentUser } from '../auth/current-user.decorator'
import { SupabaseService } from '../auth/supabase.service'
import type { AuthenticatedActor } from '../auth/auth.types'

@Controller('settings')
@UseGuards(SupabaseAuthGuard)
export class SettingsController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('operational')
  async getOperationalSettings() {
    const { data, error } = await this.supabase.adminClient
      .from('operational_settings')
      .select('default_reservation_duration_minutes, default_walk_in_duration_minutes, reservation_buffer_minutes, updated_at')
      .eq('id', 1)
      .maybeSingle()

    if (error) {
      throw new InternalServerErrorException(error.message)
    }

    if (!data) {
      return {
        defaultReservationDurationMinutes: 90,
        defaultWalkInDurationMinutes: 60,
        reservationBufferMinutes: 15,
        updatedAt: new Date().toISOString(),
      }
    }

    return {
      defaultReservationDurationMinutes: data.default_reservation_duration_minutes,
      defaultWalkInDurationMinutes: data.default_walk_in_duration_minutes,
      reservationBufferMinutes: data.reservation_buffer_minutes,
      updatedAt: data.updated_at,
    }
  }

  @Put('operational')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  async updateOperationalSettings(
    @CurrentUser() user: AuthenticatedActor,
    @Body() body: any,
  ) {
    const resDur = parseInt(body.defaultReservationDurationMinutes, 10)
    const walkDur = parseInt(body.defaultWalkInDurationMinutes, 10)
    const buffer = parseInt(body.reservationBufferMinutes, 10)
    const reason = typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim()
      : 'Actualización de parámetros operativos del salón'

    if (isNaN(resDur) || resDur < 30 || resDur > 360) {
      throw new BadRequestException('La duración por defecto de reservas debe estar entre 30 y 360 minutos.')
    }
    if (isNaN(walkDur) || walkDur < 30 || walkDur > 360) {
      throw new BadRequestException('La duración por defecto de walk-in debe estar entre 30 y 360 minutos.')
    }
    if (isNaN(buffer) || buffer < 0 || buffer > 60) {
      throw new BadRequestException('El buffer entre reservas debe estar entre 0 y 60 minutos.')
    }

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'update_operational_settings_tx',
      {
        p_default_reservation_duration_minutes: resDur,
        p_default_walk_in_duration_minutes: walkDur,
        p_reservation_buffer_minutes: buffer,
        p_reason: reason,
        p_actor_id: user.id,
      },
    )

    if (txError) {
      const { data, error } = await this.supabase.adminClient
        .from('operational_settings')
        .upsert({
          id: 1,
          default_reservation_duration_minutes: resDur,
          default_walk_in_duration_minutes: walkDur,
          reservation_buffer_minutes: buffer,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (error) throw new InternalServerErrorException(error.message)
      return {
        defaultReservationDurationMinutes: data.default_reservation_duration_minutes,
        defaultWalkInDurationMinutes: data.default_walk_in_duration_minutes,
        reservationBufferMinutes: data.reservation_buffer_minutes,
        updatedAt: data.updated_at,
      }
    }

    return txData
  }
}
