import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { LoginRateLimitService } from './rate-limit.service';
import { TotpService } from './totp.service';
import { PendingLoginTokenService } from './pending-login-token.service';
import { AuthController } from './auth.controller';
import { SessionGuard } from './guards/session.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { CrAdminGuard } from './guards/cr-admin.guard';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    LoginRateLimitService,
    TotpService,
    PendingLoginTokenService,
    SessionGuard,
    CsrfGuard,
    CrAdminGuard,
  ],
  // Exported so the admin panel module can use guards and sessions
  exports: [
    AuthService,
    SessionsService,
    TotpService,
    PendingLoginTokenService,
    SessionGuard,
    CsrfGuard,
    CrAdminGuard,
  ],
})
export class AuthModule {}
