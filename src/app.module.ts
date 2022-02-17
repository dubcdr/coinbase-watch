import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import CoinbasePro from 'coinbase-pro-node';
import { AppController } from './app.controller';
import { AppService } from './app.service';


@Module({
  imports: [
    ConfigModule.forRoot()
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
    }
  ],
})
export class AppModule { }
