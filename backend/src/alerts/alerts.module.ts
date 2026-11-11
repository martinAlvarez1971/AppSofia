import { Module } from '@nestjs/common'
import { AlertsController } from './alerts.controller'
import { SupabaseModule } from '../auth/supabase.module'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [SupabaseModule, PrismaModule],
  controllers: [AlertsController],
})
export class AlertsModule {}
