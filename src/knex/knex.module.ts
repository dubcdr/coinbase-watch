import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import knex from 'knex';

@Module({
  providers: [
    {
      provide: 'KNEX_CLIENT',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return knex({
          client: 'pg',
          connection: {
            host: 'localhost',
            port: 5432,
            user: configService.get('POSTGRES_USER'),
            password: configService.get('POSTGRES_PASSWORD'),
            database: configService.get('POSTGRES_DB'),
          },
        });
      },
    },
  ],
  exports: ['KNEX_CLIENT'],
})
export class KnexModule {}
