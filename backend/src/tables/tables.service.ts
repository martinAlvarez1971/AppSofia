import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { AuthenticatedActor } from '../auth/auth.types'
import { TableOccupancy, TableStatus } from '../generated/prisma/enums'
import type {
  CreateTableDto,
  UpdateTableDto,
  UpdateTableOccupancyDto,
  UpdateTableServiceDto,
  UpdateTableStatusDto,
} from './dto/tables.dto'

export type TableDerivedState =
  | 'free'
  | 'occupied'
  | 'has_future_reservation'
  | 'out_of_service'
  | 'inactive'

export interface EnrichedTable {
  id: string
  number: string
  capacity: number
  minCapacity: number
  sector: string | null
  status: TableStatus
  isOutOfService: boolean
  currentOccupancy: TableOccupancy
  derivedState: TableDerivedState
  nextReservation?: {
    id: string
    customerName: string
    startTime: string
    endTime: string
    partySize: number
  } | null
  createdAt: string
  updatedAt: string
}

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters?: {
    sector?: string
    minCapacity?: number
    status?: TableStatus
    search?: string
  }): Promise<EnrichedTable[]> {
    const now = new Date()
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)

    const endOfToday = new Date(now)
    endOfToday.setHours(23, 59, 59, 999)

    const tables = await this.prisma.restaurantTable.findMany({
      where: {
        ...(filters?.sector ? { sector: filters.sector } : {}),
        ...(filters?.minCapacity ? { capacity: { gte: filters.minCapacity } } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.search
          ? {
              OR: [
                { number: { contains: filters.search, mode: 'insensitive' } },
                { sector: { contains: filters.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        reservations: {
          where: {
            reservation: {
              status: { in: ['confirmed', 'seated'] },
              endTime: { gte: now },
              startTime: { lte: endOfToday },
            },
          },
          include: {
            reservation: true,
          },
          orderBy: {
            reservation: { startTime: 'asc' },
          },
        },
      },
      orderBy: [{ sector: 'asc' }, { number: 'asc' }],
    })

    return tables.map((t) => {
      const activeRes = t.reservations.map((r) => r.reservation)
      const currentRes = activeRes.find(
        (r) => r.startTime <= now && r.endTime > now,
      )
      const nextRes = activeRes.find((r) => r.startTime > now)

      let derivedState: TableDerivedState = 'free'
      if (t.status === TableStatus.inactive) {
        derivedState = 'inactive'
      } else if (t.isOutOfService) {
        derivedState = 'out_of_service'
      } else if (t.currentOccupancy === TableOccupancy.occupied || currentRes) {
        derivedState = 'occupied'
      } else if (nextRes) {
        derivedState = 'has_future_reservation'
      }

      const relevantRes = currentRes || nextRes

      return {
        id: t.id,
        number: t.number,
        capacity: t.capacity,
        minCapacity: t.minCapacity,
        sector: t.sector,
        status: t.status,
        isOutOfService: t.isOutOfService,
        currentOccupancy: t.currentOccupancy,
        derivedState,
        nextReservation: relevantRes
          ? {
              id: relevantRes.id,
              customerName: relevantRes.customerName,
              startTime: relevantRes.startTime.toISOString(),
              endTime: relevantRes.endTime.toISOString(),
              partySize: relevantRes.partySize,
            }
          : null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      }
    })
  }

  async getById(id: string) {
    const table = await this.prisma.restaurantTable.findUnique({
      where: { id },
      include: {
        reservations: {
          where: {
            reservation: {
              status: { in: ['confirmed', 'seated'] },
              endTime: { gte: new Date() },
            },
          },
          include: { reservation: true },
          orderBy: { reservation: { startTime: 'asc' } },
        },
      },
    })
    if (!table) throw new NotFoundException('Mesa no encontrada')
    return table
  }

  async create(actor: AuthenticatedActor, input: CreateTableDto) {
    const trimmedNumber = input.number.trim()
    const existing = await this.prisma.restaurantTable.findUnique({
      where: { number: trimmedNumber },
    })
    if (existing) {
      throw new ConflictException(`Ya existe una mesa con el número "${trimmedNumber}".`)
    }

    const minCap = input.minCapacity ?? 1
    if (minCap > input.capacity) {
      throw new ConflictException('La capacidad mínima no puede superar la capacidad máxima.')
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.restaurantTable.create({
        data: {
          number: trimmedNumber,
          capacity: input.capacity,
          minCapacity: minCap,
          sector: input.sector?.trim() || null,
        },
      })

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'table.created',
          entity: 'restaurant_table',
          entityId: created.id,
          newValues: {
            number: created.number,
            capacity: created.capacity,
            sector: created.sector,
          },
        },
      })

      return created
    })
  }

  async update(actor: AuthenticatedActor, id: string, input: UpdateTableDto) {
    const current = await this.prisma.restaurantTable.findUnique({ where: { id } })
    if (!current) throw new NotFoundException('Mesa no encontrada.')

    let trimmedNumber = current.number
    if (input.number && input.number.trim() !== current.number) {
      trimmedNumber = input.number.trim()
      const existing = await this.prisma.restaurantTable.findUnique({
        where: { number: trimmedNumber },
      })
      if (existing && existing.id !== id) {
        throw new ConflictException(`Ya existe otra mesa con el número "${trimmedNumber}".`)
      }
    }

    const capacity = input.capacity ?? current.capacity
    const minCapacity = input.minCapacity ?? current.minCapacity
    if (minCapacity > capacity) {
      throw new ConflictException('La capacidad mínima no puede superar la capacidad máxima.')
    }

    const sector = input.sector !== undefined ? input.sector.trim() || null : current.sector

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.restaurantTable.update({
        where: { id },
        data: {
          number: trimmedNumber,
          capacity,
          minCapacity,
          sector,
        },
      })

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'table.updated',
          entity: 'restaurant_table',
          entityId: id,
          oldValues: {
            number: current.number,
            capacity: current.capacity,
            minCapacity: current.minCapacity,
            sector: current.sector,
          },
          newValues: {
            number: updated.number,
            capacity: updated.capacity,
            minCapacity: updated.minCapacity,
            sector: updated.sector,
          },
        },
      })

      return updated
    })
  }

  async updateStatus(actor: AuthenticatedActor, id: string, input: UpdateTableStatusDto) {
    const current = await this.prisma.restaurantTable.findUnique({ where: { id } })
    if (!current) throw new NotFoundException('Mesa no encontrada.')

    if (input.status === TableStatus.inactive && current.status === TableStatus.active) {
      // Verificar si tiene reservas futuras confirmadas
      const futureReservationsCount = await this.prisma.reservationTable.count({
        where: {
          tableId: id,
          reservation: {
            status: { in: ['confirmed', 'seated'] },
            endTime: { gt: new Date() },
          },
        },
      })
      if (futureReservationsCount > 0) {
        throw new ConflictException(
          'No podés desactivar una mesa con reservas futuras activas. Reasigná o cancelá las reservas primero.',
        )
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.restaurantTable.update({
        where: { id },
        data: { status: input.status },
      })

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'table.status_changed',
          entity: 'restaurant_table',
          entityId: id,
          oldValues: { status: current.status },
          newValues: { status: updated.status },
        },
      })

      return updated
    })
  }

  async updateService(actor: AuthenticatedActor, id: string, input: UpdateTableServiceDto) {
    const current = await this.prisma.restaurantTable.findUnique({ where: { id } })
    if (!current) throw new NotFoundException('Mesa no encontrada.')

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.restaurantTable.update({
        where: { id },
        data: { isOutOfService: input.isOutOfService },
      })

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'table.service_changed',
          entity: 'restaurant_table',
          entityId: id,
          oldValues: { isOutOfService: current.isOutOfService },
          newValues: { isOutOfService: updated.isOutOfService },
        },
      })

      return updated
    })
  }

  async updateOccupancy(actor: AuthenticatedActor, id: string, input: UpdateTableOccupancyDto) {
    const current = await this.prisma.restaurantTable.findUnique({ where: { id } })
    if (!current) throw new NotFoundException('Mesa no encontrada.')

    if (current.status !== TableStatus.active || current.isOutOfService) {
      throw new ConflictException('No se puede cambiar la ocupación de una mesa fuera de servicio o inactiva.')
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.restaurantTable.update({
        where: { id },
        data: { currentOccupancy: input.currentOccupancy },
      })

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'table.occupancy_changed',
          entity: 'restaurant_table',
          entityId: id,
          oldValues: { currentOccupancy: current.currentOccupancy },
          newValues: { currentOccupancy: updated.currentOccupancy },
        },
      })

      return updated
    })
  }
}
