import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProductsModule } from './products/products.module';
import { CoinbaseModule } from './coinbase/coinbase.module';
import { KnexModule } from './knex/knex.module';
import { HistoricModule } from './historic/historic.module';
import { CandleModule } from './candle/candle.module';

export const KNEX_CLIENT = 'KNEX_CLIENT';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CoinbaseModule,
    KnexModule,
    ProductsModule,
    HistoricModule,
    CandleModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
