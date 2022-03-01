import { Module } from '@nestjs/common';
import { CandleModule } from 'src/candle/candle.module';
import { CoinbaseModule } from 'src/coinbase/coinbase.module';
import { ProductsModule } from 'src/products/products.module';
import { HistoricService } from './historic.service';

@Module({
  imports: [CandleModule, CoinbaseModule, ProductsModule],
  providers: [HistoricService],
})
export class HistoricModule {}
