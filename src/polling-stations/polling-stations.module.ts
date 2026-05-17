import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PollingStationsService } from './polling-stations.service';

@Module({
  imports: [PrismaModule],
  providers: [PollingStationsService],
  exports: [PollingStationsService],
})
export class PollingStationsModule {}
