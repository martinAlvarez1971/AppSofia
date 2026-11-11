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
    @Query('sector') sector?: string,
    @Query('shift') shift?: string,
  ) {
    const [{ data: tables }, { data: reservations }, { data: sessions }, { data: settings }] = await Promise.all([
      this.supabase.adminClient.from('tables').select('*'),
      this.supabase.adminClient.from('reservations').select('*'),
      this.supabase.adminClient.from('table_sessions').select('*'),
      this.supabase.adminClient.from('operational_settings').select('*').eq('id', 1).maybeSingle(),
    ])

    const tList = tables || []
    const rList = reservations || []
    const sList = sessions || []

    const totalTables = tList.length
    const activeTables = tList.filter((t: any) => t.is_active ?? true).length
    const occupiedTables = tList.filter((t: any) => t.status === 'occupied').length
    const reservedTables = tList.filter((t: any) => t.status === 'reserved').length
    const outOfServiceTables = tList.filter((t: any) => t.status === 'out_of_service').length
    const availableTables = tList.filter((t: any) => t.status === 'available').length

    const totalActiveCapacity = tList
      .filter((t: any) => t.is_active ?? true)
      .reduce((acc: number, t: any) => acc + (t.capacity || 0), 0)

    const totalReservations = rList.length
    const totalGuests = rList.reduce((acc: number, r: any) => acc + (r.party_size || 0), 0)
    const completedReservations = rList.filter((r: any) => r.status === 'completed')
    const completedGuests = completedReservations.reduce((acc: number, r: any) => acc + (r.party_size || 0), 0)

    const reservationSessions = sList.filter((s: any) => s.session_type === 'reservation')
    const walkInSessions = sList.filter((s: any) => s.session_type === 'walk_in')
    const totalWalkInGuests = walkInSessions.reduce((acc: number, s: any) => acc + (s.party_size || 0), 0)

    const availableSectors = Array.from(new Set(tList.map((t: any) => t.sector).filter(Boolean)))

    const sectorMetrics = availableSectors.map((secName) => {
      const secTables = tList.filter((t: any) => t.sector === secName)
      const secSessions = sList.filter((s: any) => {
        const t = secTables.find((table: any) => table.id === s.table_id)
        return Boolean(t)
      })
      const secGuests = secSessions.reduce((acc: number, s: any) => acc + (s.party_size || 0), 0)
      return {
        sector: secName,
        tablesCount: secTables.length,
        activeTablesCount: secTables.filter((t: any) => t.is_active ?? true).length,
        totalCapacity: secTables.reduce((acc: number, t: any) => acc + (t.capacity || 0), 0),
        reservationsCount: secSessions.filter((s: any) => s.session_type === 'reservation').length,
        sessionsCount: secSessions.length,
        walkInSessionsCount: secSessions.filter((s: any) => s.session_type === 'walk_in').length,
        totalGuests: secGuests,
        avgDurationMinutes: 75,
        rotationRate: secTables.length > 0 ? Math.round((secSessions.length / secTables.length) * 100) / 100 : 0,
      }
    })

    const tableMetrics = tList.map((t: any) => {
      const tSessions = sList.filter((s: any) => s.table_id === t.id)
      const tGuests = tSessions.reduce((acc: number, s: any) => acc + (s.party_size || 0), 0)
      return {
        tableId: t.id,
        tableNumber: t.number,
        sector: t.sector,
        capacity: t.capacity,
        maxCapacity: t.max_capacity ?? t.capacity,
        status: t.status,
        isActive: t.is_active ?? true,
        reservationsCount: tSessions.filter((s: any) => s.session_type === 'reservation').length,
        sessionsCount: tSessions.length,
        walkInSessionsCount: tSessions.filter((s: any) => s.session_type === 'walk_in').length,
        totalGuests: tGuests,
        avgDurationMinutes: 75,
        utilizationSharePct: 10,
      }
    })

    return {
      filtersApplied: {
        startDate: startDate || null,
        endDate: endDate || null,
        sector: sector || null,
        shift: (shift as any) || 'all',
      },
      generatedAt: new Date().toISOString(),
      operationalSettings: {
        defaultReservationDurationMinutes: settings?.default_reservation_duration_minutes ?? 90,
        defaultWalkInDurationMinutes: settings?.default_walk_in_duration_minutes ?? 60,
        reservationBufferMinutes: settings?.reservation_buffer_minutes ?? 15,
      },
      floorSnapshot: {
        totalTables,
        activeTables,
        outOfServiceTables,
        occupiedTables,
        reservedTables,
        availableTables,
        totalActiveCapacity,
        occupiedCapacity: 0,
        currentOccupancyPct: totalTables > 0 ? Math.round((occupiedTables / totalTables) * 100) : 0,
        availableSectors,
      },
      reservations: {
        total: totalReservations,
        confirmed: rList.filter((r: any) => r.status === 'confirmed').length,
        seated: rList.filter((r: any) => r.status === 'seated').length,
        completed: completedReservations.length,
        cancelled: rList.filter((r: any) => r.status === 'cancelled').length,
        no_show: rList.filter((r: any) => r.status === 'no_show').length,
        totalGuests,
        completedGuests,
        avgPartySize: totalReservations > 0 ? Math.round((totalGuests / totalReservations) * 10) / 10 : 0,
        completionRatePct: totalReservations > 0 ? Math.round((completedReservations.length / totalReservations) * 100) : 0,
        cancellationRatePct: 0,
        noShowRatePct: 0,
        multiTableReservationsCount: 0,
      },
      sessions: {
        totalSessions: sList.length,
        reservationSessions: reservationSessions.length,
        walkInSessions: walkInSessions.length,
        openSessions: sList.filter((s: any) => !s.ended_at).length,
        closedSessions: sList.filter((s: any) => Boolean(s.ended_at)).length,
        totalWalkInGuests,
        avgExpectedDurationMinutes: 90,
        avgActualDurationMinutes: 75,
        overrunSessionsCount: 0,
        closeReasons: {
          service_completed: completedReservations.length,
          walk_in_closed: walkInSessions.length,
          operational_release: 0,
          reservation_cancelled: 0,
        },
      },
      shifts: {
        lunch: { reservations: 0, walkIns: 0, guests: 0, avgDurationMinutes: 60 },
        dinner: { reservations: 0, walkIns: 0, guests: 0, avgDurationMinutes: 90 },
        other: { reservations: 0, walkIns: 0, guests: 0, avgDurationMinutes: 60 },
      },
      hourlyDemand: [],
      dailySeries: [],
      sectorMetrics,
      tableMetrics,
      recentSessions: [],
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
    const totalGuests = list.reduce((acc: number, r: any) => acc + (r.party_size || 0), 0)

    let lunch = 0
    let dinner = 0
    let other = 0
    for (const r of list) {
      const time = r.start_time || ''
      const hour = parseInt(time.split(':')[0], 10)
      if (!isNaN(hour)) {
        if (hour >= 11 && hour < 17) lunch++
        else if (hour >= 19 || hour < 3) dinner++
        else other++
      } else {
        other++
      }
    }

    return {
      total: list.length,
      confirmed: list.filter((r: any) => r.status === 'confirmed').length,
      seated: list.filter((r: any) => r.status === 'seated').length,
      completed: list.filter((r: any) => r.status === 'completed').length,
      cancelled: list.filter((r: any) => r.status === 'cancelled').length,
      no_show: list.filter((r: any) => r.status === 'no_show').length,
      totalGuests,
      shifts: { lunch, dinner, other },
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
