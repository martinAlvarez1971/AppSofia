import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { TablesController } from './tables.controller'
import { TablesService } from './tables.service'

@Module({
  imports: [PrismaModule],
  controllers: [TablesController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
