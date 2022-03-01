import { Inject, Injectable } from '@nestjs/common';
import CoinbasePro, {
  Candle,
  CandleGranularity,
  ProductEvent,
} from 'coinbase-pro-node';
import { isEqual } from 'date-fns';
import { Knex } from 'knex';
import { from, Observable, map, of, switchMap, tap, catchError } from 'rxjs';
import { DbCandle } from 'src/db-candle.interface';
import { IntervalLogData, LoggerService } from 'src/logger/logger.service';
import { ProductsService } from 'src/products/products.service';

@Injectable()
export class CandleService {
  constructor(
    @Inject('COINBASE_CLIENT') private client: CoinbasePro,
    @Inject('KNEX_CLIENT') private knexClient: Knex,
    private productService: ProductsService,
    private logger: LoggerService,
  ) {
    logger.setContext('Candle');
  }

  public async findCandleExtreme(
    product: string,
    granularity: CandleGranularity,
    mostRecent: boolean,
  ): Promise<Date | undefined> {
    const latestCandle = await this.knexClient<DbCandle>(
      this.productService.getProductDbName(product, granularity),
    )
      .orderBy('open_timestamp', mostRecent ? 'desc' : 'asc')
      .limit(1)
      .select('open_timestamp');

    if (latestCandle.length === 0) {
      return undefined;
    }

    return latestCandle[0].open_timestamp;
  }

  public async writeCandles(
    product: string,
    candles: Candle[],
    granularity: CandleGranularity,
  ): Promise<Record<string, any>> {
    const candleData = candles.map((candle) => ({
      open_timestamp: candle.openTimeInISO,
      high: candle.high,
      low: candle.low,
      open: candle.open,
      close: candle.close,
      volume: candle.volume,
    }));
    if (candles.length === 0) {
      this.logger.log('Tried to write empty array');
      return of([]);
    }
    const startDate = new Date(candles[0].openTimeInISO);
    const endDate = new Date(candles[candles.length - 1].openTimeInISO);
    try {
      await this.knexClient(
        this.productService.getProductDbName(product, granularity),
      ).insert(candleData);
    } catch (error) {
      if (this._isUniqueError(error)) {
        await this._handleUniqueError(product, candles, granularity);
      }
    }

    const logData: IntervalLogData = {
      action: `Inserted ${candles.length}`,
      start: startDate,
      end: endDate,
      product,
      granularity,
    };
    this.logger.logProduct(logData);
  }

  public setupListeners() {
    this.logger.log(`Add global handler for candle listening...`);
    this.client.rest.on(
      ProductEvent.NEW_CANDLE,
      (productId: string, g: CandleGranularity, candle: Candle) => {
        const logData: IntervalLogData = {
          start: new Date(candle.openTimeInISO),
          product: productId,
          granularity: g,
          action: 'Received candle',
        };
        this.logger.logProduct(logData);
        this.writeCandles(productId, [candle], g);
      },
    );

    for (const product of this.productService.products) {
      for (const granularity of this.productService.getGranularityValues()) {
        const logData: IntervalLogData = {
          granularity,
          product,
          action: 'Initializing listener',
        };
        this.logger.logProduct(logData);
        this._setupListen(product, granularity);
      }
    }
  }

  private _setupListen(product: string, granularity: CandleGranularity) {
    this.findCandleExtreme(product, granularity, true).then((candle) => {
      if (candle === undefined) {
        throw new Error('We should have captured some input before listener');
      }
      this.client.rest.product.watchCandles(
        product,
        granularity,
        candle.toISOString(),
      );
    });
  }

  private async _handleUniqueError(
    product: string,
    candles: Candle[],
    granularity: CandleGranularity,
  ) {
    this.logger.log(`Handling unique error`);
    const loadedCandles = await this.knexClient<DbCandle>(
      this.productService.getProductDbName(product, granularity),
    )
      .whereBetween('open_timestamp', [
        candles[0]?.openTimeInISO,
        candles[candles.length - 1]?.openTimeInISO,
      ])
      .orderBy('open_timestamp', 'asc');
    if (loadedCandles.length === candles.length) {
      const logData: IntervalLogData = {
        product,
        granularity,
        start: new Date(candles[0]?.openTimeInISO),
        end: new Date(candles[candles.length - 1]?.openTimeInISO),
        action: 'Candles already exist',
      };
      this.logger.logProduct(logData);
      return of([] as number[]);
    }

    const retries = candles.filter(
      (apiCandle) =>
        !loadedCandles.some((dbCandle) =>
          isEqual(dbCandle.open_timestamp, new Date(apiCandle.openTimeInISO)),
        ),
    );
    await this.writeCandles(product, retries, granularity);
  }

  private async _isUniqueError(err: Error) {
    return err.message.includes('exits');
  }
}
