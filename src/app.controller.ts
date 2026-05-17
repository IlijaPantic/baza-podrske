import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'kontrola',
      time: new Date().toISOString(),
    };
  }

  @Get('health/db')
  async healthDb() {
    const ok = await this.prisma.ping();
    if (!ok) {
      throw new ServiceUnavailableException('Database not reachable');
    }
    return {
      status: 'ok',
      database: 'up',
      time: new Date().toISOString(),
    };
  }
}
