import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';
import { SubmitRateLimitService } from './submit-rate-limit.service';
import { FormTokenService } from './form-token.service';

@Module({
  imports: [PrismaModule],
  controllers: [RegistrationsController],
  providers: [RegistrationsService, SubmitRateLimitService, FormTokenService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
