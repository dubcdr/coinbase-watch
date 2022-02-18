import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import CoinbasePro from 'coinbase-pro-node';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EthMinuteCandle } from './eth/eth.entity';
import { EthService } from './eth/eth.service';


@Module({
  imports: [
    ConfigModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        username: configService.get('POSTGRES_USER'),
        password: configService.get('POSTGRES_PASSWORD'),
        database: 'dubcdr',
        synchronize: true,
        entities: [EthMinuteCandle]
      })
    }),
    TypeOrmModule.forFeature([EthMinuteCandle])
  ],
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
      }
    },
    EthService
  ],
})
export class AppModule { }
