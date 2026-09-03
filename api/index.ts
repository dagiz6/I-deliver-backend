import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';

const server = express();
let cachedApp: any;

async function bootstrap() {
  if (!cachedApp) {
    // Import compiled AppModule from dist to ensure decorator metadata is preserved
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../dist/src/app.module');
    cachedApp = await NestFactory.create(
      AppModule,
      new ExpressAdapter(server),
      { bodyParser: false },
    );
    await cachedApp.init();
  }
  return cachedApp;
}

export default async function handler(req: any, res: any) {
  await bootstrap();
  server(req, res);
}
