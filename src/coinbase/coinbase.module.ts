import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CoinbasePro from 'coinbase-pro-node';

@Module({
  providers: [
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
  ],
  exports: ['COINBASE_CLIENT'],
})
export class CoinbaseModule {}
