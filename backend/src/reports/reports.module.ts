import { Module } from '@nestjs/common'
import { ReportsController, ReservationsQueryController } from './reports.controller'
import { SupabaseModule } from '../auth/supabase.module'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [SupabaseModule, PrismaModule],
  controllers: [ReportsController, ReservationsQueryController],
})
export class ReportsModule {}
