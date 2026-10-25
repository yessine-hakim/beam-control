import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: 'http://localhost:5173' });
  app.enableShutdownHooks();
  // Not PORT: dev launchers set PORT for the web app.
  const port = Number(process.env.SERVER_PORT) || 3000;
  await app.listen(port);
  console.log(`Beam Control server on http://localhost:${port}`);
}

void bootstrap();
