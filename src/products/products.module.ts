import { Module } from '@nestjs/common';
import { CoinbaseModule } from 'src/coinbase/coinbase.module';
import { KnexModule } from 'src/knex/knex.module';
import { ProductsService } from './products.service';

@Module({
  imports: [CoinbaseModule, KnexModule],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
