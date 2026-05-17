import { Module } from '@nestjs/common';
import { PollingStationsModule } from '../polling-stations/polling-stations.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { PublicController } from './public.controller';

@Module({
  imports: [PollingStationsModule, RegistrationsModule],
  controllers: [PublicController],
})
export class PublicModule {}
