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
import { RolesGuard } from '../auth/roles.guard'
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard'
import { ReservationStatus } from '../generated/prisma/enums'
import { CheckAvailabilityDto, CreateReservationDto } from './dto/reservations.dto'
import { ReservationsService } from './reservations.service'

@Controller('reservations')
@UseGuards(SupabaseAuthGuard, RolesGuard)
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  list(@Query('date') date?: string, @Query('status') status?: ReservationStatus) {
    return this.reservations.list({ date, status })
  }

  @Get('availability')
  checkAvailability(@Query() query: CheckAvailabilityDto) {
    return this.reservations.checkAvailability(query)
  }

  @Post()
  create(@CurrentUser() actor: AuthenticatedActor, @Body() input: CreateReservationDto) {
    return this.reservations.create(actor, input)
  }

  @Patch(':id/cancel')
  cancel(@CurrentUser() actor: AuthenticatedActor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.reservations.cancel(actor, id)
  }
}
