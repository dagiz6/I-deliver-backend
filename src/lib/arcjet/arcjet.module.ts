import { Global, Module } from '@nestjs/common';
import { ArcjetModule as ArcjetNestModule, shield, slidingWindow } from '@arcjet/nest';

@Global()
@Module({
  imports: [
    ArcjetNestModule.forRoot({
      isGlobal: true,
      key: process.env.ARCJET_KEY || '',
      rules: [
        shield({ mode: 'LIVE' }),
        slidingWindow({
          mode: 'LIVE',
          interval: '1m',
          max: 60, // Limit to 60 requests per minute
        }),
      ],
    }),
  ],
  exports: [ArcjetNestModule],
})
export class ArcjetModule {}
