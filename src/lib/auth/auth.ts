import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: [
    'http://localhost:3000',
  ],
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'CUSTOMER',
        input: true,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Force role to CUSTOMER or DELIVERY_PARTNER only.
          // Block ADMIN self-assignment during public registration.
          let assignedRole = user.role;
          if (assignedRole !== 'DELIVERY_PARTNER' && assignedRole !== 'CUSTOMER') {
            assignedRole = 'CUSTOMER';
          }
          return {
            data: {
              ...user,
              role: assignedRole,
            },
          };
        },
      },
    },
  },
});
