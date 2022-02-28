import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EthService } from './eth/eth.service';
import { ProductsModule } from './products/products.module';
import { CoinbaseModule } from './coinbase/coinbase.module';
import { KnexModule } from './knex/knex.module';

export const KNEX_CLIENT = 'KNEX_CLIENT';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CoinbaseModule,
    KnexModule,
    ProductsModule,
  ],
  controllers: [AppController],
  providers: [AppService, EthService],
})
export class AppModule {}
