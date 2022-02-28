import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import CoinbasePro from 'coinbase-pro-node';
import knex from 'knex';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EthService } from './eth/eth.service';

export const KNEX_CLIENT = 'KNEX_CLIENT';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: 'COINBASE_CLIENT',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const client = new CoinbasePro({
          apiKey: configService.get('API_KEY'),
          apiSecret: configService.get('API_SECRET'),
          passphrase: configService.get('API_PASSPHRASE'),
          useSandbox: false,
        });
        return client;
      },
    },
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

    EthService,
  ],
})
export class AppModule {}
