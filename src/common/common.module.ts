import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IpSaltService } from './ip-salt.service';

/**
 * Global module with shared services needed by multiple
 * features (registrations, audit, and later exports).
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [IpSaltService],
  exports: [IpSaltService],
})
export class CommonModule {}
