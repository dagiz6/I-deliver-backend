import { Module } from '@nestjs/common';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from '../../lib/auth/auth';

@Module({
  imports: [
    BetterAuthModule.forRoot({
      auth,
      disableGlobalAuthGuard: false,
    }),
  ],
  exports: [BetterAuthModule],
})
export class AuthModule {}
