import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CoinbasePro from 'coinbase-pro-node';
import { Knex } from 'knex';
import { CandleService } from '../candle-service.abstract';
import { ProductSymbols } from '../product-symbols.enum';

@Injectable()
export class EthService extends CandleService {
  constructor(
    @Inject('COINBASE_CLIENT') protected client: CoinbasePro,
    @Inject('KNEX_CLIENT') protected knexClient: Knex,
    protected configService: ConfigService,
  ) {
    super(
      client,
      knexClient,
      [ProductSymbols.ETH, ProductSymbols.USD],
      configService,
    );
  }
}
