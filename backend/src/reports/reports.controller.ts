import {
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common'
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard'
import { SupabaseService } from '../auth/supabase.service'

@Controller('reports')
@UseGuards(SupabaseAuthGuard)
export class ReportsController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('overview')
  async getOverview(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const [{ data: tables }, { data: reservations }, { data: sessions }] = await Promise.all([
      this.supabase.adminClient.from('tables').select('*'),
      this.supabase.adminClient.from('reservations').select('*'),
      this.supabase.adminClient.from('table_sessions').select('*'),
    ])

    const totalTables = (tables || []).length
    const totalReservations = (reservations || []).length
    const totalSessions = (sessions || []).length

    return {
      metrics: {
        totalTables,
        totalReservations,
        totalSessions,
        averageOccupancyRate: totalTables > 0 ? Math.round((totalSessions / totalTables) * 100) / 100 : 0,
      },
      tableRotation: (tables || []).map((t: any) => ({
        tableId: t.id,
        tableNumber: t.number,
        sector: t.sector,
        capacity: t.capacity,
        rotationCount: (sessions || []).filter((s: any) => s.table_id === t.id).length,
      })),
      serviceMix: {
        reservations: (sessions || []).filter((s: any) => s.session_type === 'reservation').length,
        walkIn: (sessions || []).filter((s: any) => s.session_type === 'walk_in').length,
      },
      sessionsLog: (sessions || []).slice(0, 50).map((s: any) => ({
        id: s.id,
        tableId: s.table_id,
        sessionType: s.session_type,
        partySize: s.party_size,
        startedAt: s.started_at,
        endedAt: s.ended_at,
      })),
    }
  }
}

@Controller('reservations-query')
@UseGuards(SupabaseAuthGuard)
export class ReservationsQueryController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('overview')
  async getOverview() {
    const { data: reservations, error } = await this.supabase.adminClient
      .from('reservations')
      .select('*, reservation_tables(table_id, tables(*))')
      .order('reservation_date', { ascending: false })

    if (error) throw new InternalServerErrorException(error.message)

    const list = reservations || []
    return {
      total: list.length,
      confirmed: list.filter((r: any) => r.status === 'confirmed').length,
      seated: list.filter((r: any) => r.status === 'seated').length,
      completed: list.filter((r: any) => r.status === 'completed').length,
      cancelled: list.filter((r: any) => r.status === 'cancelled').length,
      noShow: list.filter((r: any) => r.status === 'no_show').length,
      recent: list.slice(0, 20),
    }
  }

  @Get('search')
  async search(@Query('q') q?: string, @Query('date') date?: string) {
    let query = this.supabase.adminClient
      .from('reservations')
      .select('*, reservation_tables(table_id, tables(*))')

    if (date) query = query.eq('reservation_date', date)
    if (q) {
      query = query.or(`customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%,customer_email.ilike.%${q}%`)
    }

    const { data, error } = await query
    if (error) throw new InternalServerErrorException(error.message)
    return data || []
  }

  @Get('calendar')
  async getCalendar(@Query('month') month?: string) {
    const { data, error } = await this.supabase.adminClient
      .from('reservations')
      .select('id, customer_name, party_size, reservation_date, start_time, end_time, status')

    if (error) throw new InternalServerErrorException(error.message)
    return data || []
  }

  @Get('customers')
  async getCustomers() {
    const { data, error } = await this.supabase.adminClient
      .from('reservations')
      .select('customer_name, customer_phone, customer_email, reservation_date, party_size')

    if (error) throw new InternalServerErrorException(error.message)

    const map = new Map<string, any>()
    for (const r of data || []) {
      const key = r.customer_email || r.customer_phone || r.customer_name
      if (!map.has(key)) {
        map.set(key, {
          name: r.customer_name,
          phone: r.customer_phone,
          email: r.customer_email,
          totalVisits: 0,
          lastVisit: r.reservation_date,
        })
      }
      const existing = map.get(key)
      existing.totalVisits += 1
      if (r.reservation_date > existing.lastVisit) {
        existing.lastVisit = r.reservation_date
      }
    }

    return Array.from(map.values())
  }

  @Get('detail/:id')
  async getDetail(@Param('id') id: string) {
    const { data, error } = await this.supabase.adminClient
      .from('reservations')
      .select('*, reservation_tables(table_id, tables(*))')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new InternalServerErrorException(error.message)
    return data
  }
}
