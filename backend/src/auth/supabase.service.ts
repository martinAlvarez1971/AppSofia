import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

@Injectable()
export class SupabaseService {
  readonly publicClient: SupabaseClient
  readonly adminClient: SupabaseClient

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('SUPABASE_URL')
    this.publicClient = createClient(
      url,
      config.getOrThrow<string>('SUPABASE_PUBLISHABLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
    )
    this.adminClient = createClient(
      url,
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
    )
  }
}