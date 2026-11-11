import { Module } from '@nestjs/common'
import { SettingsController } from './settings.controller'
import { SupabaseModule } from '../auth/supabase.module'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [SupabaseModule, PrismaModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
