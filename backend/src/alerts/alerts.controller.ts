import {
  BadRequestException,
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common'
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { CurrentUser } from '../auth/current-user.decorator'
import { SupabaseService } from '../auth/supabase.service'
import type { AuthenticatedActor } from '../auth/auth.types'

@Controller('alerts')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('super_admin')
export class AlertsController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  async getAlerts(
    @Query('status') status?: string,
    @Query('severity') severity?: string,
  ) {
    let query = this.supabase.adminClient
      .from('admin_alerts')
      .select('*, audit:audit_logs(*)')
      .order('created_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }
    if (severity && severity !== 'all') {
      query = query.eq('severity', severity)
    }

    const { data, error } = await query
    if (error) {
      throw new InternalServerErrorException(error.message)
    }

    const allAlerts = data || []
    const summary = {
      total: allAlerts.length,
      pending: allAlerts.filter((a: any) => a.status === 'pending').length,
      reviewed: allAlerts.filter((a: any) => a.status === 'reviewed').length,
      critical: allAlerts.filter((a: any) => a.severity === 'critical' && a.status === 'pending').length,
      warning: allAlerts.filter((a: any) => a.severity === 'warning' && a.status === 'pending').length,
    }

    return { alerts: allAlerts, summary }
  }

  @Patch(':id/review')
  async reviewAlert(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body('reason') reason?: string,
  ) {
    const finalReason = typeof reason === 'string' && reason.trim()
      ? reason.trim()
      : 'Revisión administrativa de alerta'

    const { data: txData, error: txError } = await this.supabase.adminClient.rpc(
      'review_admin_alert_tx',
      {
        p_alert_id: id,
        p_reason: finalReason,
        p_actor_id: user.id,
      },
    )

    if (txError) {
      const { data, error } = await this.supabase.adminClient
        .from('admin_alerts')
        .update({
          status: 'reviewed',
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw new InternalServerErrorException(error.message)
      return { ...data, reviewedByName: user.email }
    }

    return { ...txData, reviewedByName: user.email }
  }
}
