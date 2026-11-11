import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { PrismaModule } from './prisma/prisma.module'
import { SupabaseModule } from './auth/supabase.module'
import { UsersModule } from './users/users.module'

import { TablesModule } from './tables/tables.module'
import { ReservationsModule } from './reservations/reservations.module'

const requiredEnvironment = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'INVITATION_REDIRECT_URL',
  'PASSWORD_RESET_REDIRECT_URL',
]

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: (environment: Record<string, string | undefined>) => {
        const missing = requiredEnvironment.filter((key) => !environment[key]?.trim())
        if (missing.length) {
          throw new Error(`Backend configuration is missing: ${missing.join(', ')}`)
        }
        return environment
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    SupabaseModule,
    UsersModule,
    TablesModule,
    ReservationsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}