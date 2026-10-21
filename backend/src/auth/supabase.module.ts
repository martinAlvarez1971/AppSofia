import { Global, Module } from '@nestjs/common'
import { SupabaseService } from './supabase.service'
import { SupabaseAuthGuard } from './supabase-auth.guard'
import { RolesGuard } from './roles.guard'

@Global()
@Module({
  providers: [SupabaseService, SupabaseAuthGuard, RolesGuard],
  exports: [SupabaseService, SupabaseAuthGuard, RolesGuard],
})
export class SupabaseModule {}