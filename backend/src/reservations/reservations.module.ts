import { Module } from '@nestjs/common'
import { ReservationsController } from './reservations.controller'
import { SupabaseModule } from '../auth/supabase.module'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [SupabaseModule, PrismaModule],
  controllers: [ReservationsController],
})
export class ReservationsModule {}
