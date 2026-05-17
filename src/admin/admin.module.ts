import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PollingStationsModule } from '../polling-stations/polling-stations.module';
import { AdminController } from './admin.controller';
import { TotpController } from './totp.controller';
import { NalogController } from './nalog.controller';
import { AdminService } from './admin.service';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [AuthModule, PrismaModule, PollingStationsModule],
  controllers: [AdminController, TotpController, NalogController],
  providers: [AdminService, AdminUsersService],
})
export class AdminModule {}
