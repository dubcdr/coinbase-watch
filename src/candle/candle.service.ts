import { Inject, Injectable, Logger } from '@nestjs/common';
import CoinbasePro, {
  Candle,
  CandleGranularity,
  ProductEvent,
} from 'coinbase-pro-node';
import { format, isEqual } from 'date-fns';
import { Knex } from 'knex';
import { from, Observable, map, of, switchMap, tap, catchError } from 'rxjs';
import { DbCandle } from 'src/db-candle.interface';
import { ProductsService } from 'src/products/products.service';
import { formatDateForLog } from 'src/utils/format-date.fn';

@Injectable()
export class CandleService {
  private readonly logger: Logger = new Logger();

  constructor(
    @Inject('COINBASE_CLIENT') private client: CoinbasePro,
    @Inject('KNEX_CLIENT') private knexClient: Knex,
    private productService: ProductsService,
  ) {}

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

  public writeCandles(
    product: string,
    candles: Candle[],
    granularity: CandleGranularity,
  ): Observable<number[]> {
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

    return from(
      this.knexClient(
        this.productService.getProductDbName(product, granularity),
      ).insert(candleData),
    ).pipe(
      catchError((err) => {
        const errDetails = {
          granularity,
          startDate: candles[0]?.openTimeInISO,
          endTime: candles[candles.length - 1]?.openTimeInISO,
        };
        this.logger.error('Error trying to write to write candle.', errDetails);
        this.logger.error(JSON.stringify(err, null, 2));
        if (this._isUniqueError(err)) {
          return this._handleUniqueError(product, candles, granularity);
        }

        throw 'Unhandled write candle error: ' + err;
      }),
      tap(() => {
        this.logger.log(
          `${granularity} candles for ${formatDateForLog(
            startDate,
          )} - ${formatDateForLog(endDate)}`,
        );
      }),
    );
  }

  public setupListeners() {
    this.logger.log(`Add global handler for candle listening...`);
    this.client.rest.on(
      ProductEvent.NEW_CANDLE,
      (productId: string, g: CandleGranularity, candle: Candle) => {
        this.logger.log('Recent candle', productId, g, candle.openTimeInISO);
        this.writeCandles(productId, [candle], g).subscribe();
      },
    );

    for (const product of this.productService.products) {
      for (const granularity of this.productService.getGranularityValues()) {
        this.logger.log(
          `Initilizing listener for ${granularity} granularity...`,
        );
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

  private _handleUniqueError(
    product: string,
    candles: Candle[],
    granularity: CandleGranularity,
  ): Observable<number[]> {
    this.logger.log(`Handling unique error`);
    const previousPromise = this.knexClient<DbCandle>(
      this.productService.getProductDbName(product, granularity),
    )
      .whereBetween('open_timestamp', [
        candles[0]?.openTimeInISO,
        candles[candles.length - 1]?.openTimeInISO,
      ])
      .orderBy('open_timestamp', 'asc');

    return from(previousPromise).pipe(
      map((previous) => {
        if (previous.length === candles.length) {
          this.logger.log(
            `Candles already exist between ${candles[0]?.openTimeInISO} and ${
              candles[candles.length - 1]?.openTimeInISO
            }`,
          );
          return of([] as number[]);
        }

        const retries = candles.filter(
          (apiCandle) =>
            !previous.some((dbCandle) =>
              isEqual(
                dbCandle.open_timestamp,
                new Date(apiCandle.openTimeInISO),
              ),
            ),
        );

        return retries;
      }),
      switchMap((retries) => {
        if (Array.isArray(retries)) {
          return this.writeCandles(product, retries, granularity);
        } else {
          return retries;
        }
      }),
    );
  }

  private async _isUniqueError(_err: Error) {
    return true;
  }
}
