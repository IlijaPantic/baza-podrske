import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      trustProxy: true,
      // Body (JSON) limit — our form does not send a large payload; 100 KB is more than enough
      bodyLimit: 100 * 1024,
    }),
  );

  const cookieSecret = process.env.COOKIE_SECRET;
  if (!cookieSecret || cookieSecret.length < 32) {
    throw new Error(
      'COOKIE_SECRET nije postavljen ili je kraći od 32 chars u .env. ' +
        'Generiši: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  await app.register(fastifyCookie, {
    secret: cookieSecret,
    parseOptions: {
      // Default options; individual cookies will be set explicitly in code
    },
  });

  // application/x-www-form-urlencoded and application/json parsers are already registered
  // by @nestjs/platform-fastify (see FastifyAdapter.registerParserMiddleware).

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  console.log(`Kontrola API: http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Greška pri pokretanju:', err);
  process.exit(1);
});
