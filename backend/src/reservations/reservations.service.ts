import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { AuthenticatedActor } from '../auth/auth.types'
import { ReservationStatus, TableStatus } from '../generated/prisma/enums'
import type { CheckAvailabilityDto, CreateReservationDto } from './dto/reservations.dto'

@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters?: { date?: string; status?: ReservationStatus }) {
    let dateFilter = {}
    if (filters?.date) {
      const startOfDay = new Date(`${filters.date}T00:00:00.000Z`)
      const endOfDay = new Date(`${filters.date}T23:59:59.999Z`)
      dateFilter = {
        startTime: { gte: startOfDay, lte: endOfDay },
      }
    }

    return this.prisma.reservation.findMany({
      where: {
        ...dateFilter,
        ...(filters?.status ? { status: filters.status } : {}),
      },
      include: {
        tables: {
          include: {
            table: true,
          },
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: { startTime: 'asc' },
    })
  }

  async checkAvailability(query: CheckAvailabilityDto) {
    const start = new Date(query.startTime)
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Fecha/hora de inicio inválida.')
    }

    const duration = query.durationMinutes ?? 120
    const end = new Date(start.getTime() + duration * 60 * 1000)

    const tables = await this.prisma.restaurantTable.findMany({
      where: {
        status: TableStatus.active,
        isOutOfService: false,
      },
      orderBy: [{ sector: 'asc' }, { number: 'asc' }],
    })

    const overlappingBookings = await this.prisma.reservationTable.findMany({
      where: {
        reservation: {
          status: { in: [ReservationStatus.confirmed, ReservationStatus.seated] },
          startTime: { lt: end },
          endTime: { gt: start },
        },
      },
      include: {
        reservation: {
          select: {
            id: true,
            customerName: true,
            startTime: true,
            endTime: true,
            partySize: true,
          },
        },
      },
    })

    const bookedTableMap = new Map<string, typeof overlappingBookings[0]['reservation']>()
    for (const booking of overlappingBookings) {
      bookedTableMap.set(booking.tableId, booking.reservation)
    }

    const result = tables.map((table) => {
      const conflict = bookedTableMap.get(table.id)
      return {
        table: {
          id: table.id,
          number: table.number,
          capacity: table.capacity,
          minCapacity: table.minCapacity,
          sector: table.sector,
        },
        available: !conflict,
        conflict: conflict
          ? {
              reservationId: conflict.id,
              customerName: conflict.customerName,
              startTime: conflict.startTime.toISOString(),
              endTime: conflict.endTime.toISOString(),
              partySize: conflict.partySize,
            }
          : null,
      }
    })

    const availableTables = result.filter((t) => t.available)
    const totalAvailableCapacity = availableTables.reduce((sum, t) => sum + t.table.capacity, 0)

    return {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      durationMinutes: duration,
      partySize: query.partySize ?? null,
      totalAvailableCapacity,
      canAccommodate: query.partySize ? totalAvailableCapacity >= query.partySize : true,
      tables: result,
    }
  }

  async create(actor: AuthenticatedActor, input: CreateReservationDto) {
    const start = new Date(input.startTime)
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Fecha/hora de inicio inválida.')
    }

    let end: Date
    if (input.endTime) {
      end = new Date(input.endTime)
    } else {
      const duration = input.durationMinutes ?? 120
      end = new Date(start.getTime() + duration * 60 * 1000)
    }

    if (end <= start) {
      throw new BadRequestException('La hora de fin debe ser posterior a la de inicio.')
    }

    const uniqueTableIds = [...new Set(input.tableIds)].sort()
    if (!uniqueTableIds.length) {
      throw new BadRequestException('Debés seleccionar al menos una mesa.')
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Obtener y validar mesas
      const tables = await tx.restaurantTable.findMany({
        where: { id: { in: uniqueTableIds } },
      })

      if (tables.length !== uniqueTableIds.length) {
        throw new NotFoundException('Una o más mesas seleccionadas no existen.')
      }

      for (const table of tables) {
        if (table.status !== TableStatus.active) {
          throw new ConflictException(`La mesa "${table.number}" no está activa.`)
        }
        if (table.isOutOfService) {
          throw new ConflictException(`La mesa "${table.number}" está marcada fuera de servicio.`)
        }
      }

      // 2. Validar capacidad agregada
      const totalCapacity = tables.reduce((sum, t) => sum + t.capacity, 0)
      if (totalCapacity < input.partySize) {
        throw new ConflictException(
          `Capacidad insuficiente: las mesas seleccionadas suman ${totalCapacity} lugares, pero la reserva es para ${input.partySize} personas.`,
        )
      }

      // 3. Comprobar solapamientos atómicamente
      const conflicts = await tx.reservationTable.findMany({
        where: {
          tableId: { in: uniqueTableIds },
          reservation: {
            status: { in: [ReservationStatus.confirmed, ReservationStatus.seated] },
            startTime: { lt: end },
            endTime: { gt: start },
          },
        },
        include: {
          table: true,
          reservation: true,
        },
      })

      if (conflicts.length > 0) {
        const conflictedNumbers = [...new Set(conflicts.map((c) => c.table.number))].join(', ')
        throw new ConflictException(
          `Conflicto de horario: las siguientes mesas ya están reservadas en el intervalo solicitado: ${conflictedNumbers}`,
        )
      }

      // 4. Crear reserva y asignaciones
      const reservation = await tx.reservation.create({
        data: {
          customerName: input.customerName.trim(),
          customerPhone: input.customerPhone?.trim() || null,
          customerEmail: input.customerEmail?.trim() || null,
          partySize: input.partySize,
          startTime: start,
          endTime: end,
          notes: input.notes?.trim() || null,
          createdBy: actor.id,
          tables: {
            create: uniqueTableIds.map((tableId) => ({ tableId })),
          },
        },
        include: {
          tables: {
            include: { table: true },
          },
        },
      })

      // 5. Registrar auditoría inmutable
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'reservation.created',
          entity: 'reservation',
          entityId: reservation.id,
          newValues: {
            customerName: reservation.customerName,
            partySize: reservation.partySize,
            startTime: reservation.startTime.toISOString(),
            endTime: reservation.endTime.toISOString(),
            tableNumbers: tables.map((t) => t.number),
            totalCapacity,
          },
        },
      })

      return reservation
    })
  }

  async cancel(actor: AuthenticatedActor, id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { tables: { include: { table: true } } },
    })
    if (!reservation) throw new NotFoundException('Reserva no encontrada.')

    if (reservation.status === ReservationStatus.cancelled) {
      throw new ConflictException('La reserva ya se encuentra cancelada.')
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.reservation.update({
        where: { id },
        data: { status: ReservationStatus.cancelled },
      })

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'reservation.cancelled',
          entity: 'reservation',
          entityId: id,
          oldValues: { status: reservation.status },
          newValues: { status: updated.status },
        },
      })

      return updated
    })
  }
}
