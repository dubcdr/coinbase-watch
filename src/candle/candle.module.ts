import { Module } from '@nestjs/common';
import { CoinbaseModule } from 'src/coinbase/coinbase.module';
import { KnexModule } from 'src/knex/knex.module';
import { ProductsModule } from 'src/products/products.module';
import { CandleService } from './candle.service';

@Module({
  imports: [KnexModule, CoinbaseModule, ProductsModule],
  providers: [CandleService],
  exports: [CandleService],
})
export class CandleModule {}
