import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CoinbasePro, {
  Candle,
  CandleGranularity,
  ProductEvent,
} from 'coinbase-pro-node';
import { addSeconds, isEqual } from 'date-fns';
import { Knex } from 'knex';
import {
  interval,
  Observable,
  Subject,
  switchMap,
  tap,
  takeUntil,
  from,
  catchError,
  of,
  map,
  forkJoin,
} from 'rxjs';
import { DbCandle } from './db-candle.interface';
import { ProductSymbols } from './product-symbols.enum';

export abstract class CandleService implements OnModuleInit {
  private readonly logger: Logger;
  product: string;
  private _numCandles: any;

  constructor(
    protected client: CoinbasePro,
    protected knexClient: Knex,
    protected symbols: ProductSymbols[],
    protected configService: ConfigService,
  ) {
    this.product = `${symbols[0]}-${symbols[1]}`;
    this.logger = new Logger(this.product);
    this._numCandles = parseInt(this.configService.get('NUM_CANDLES'));
    this.logger.log(
      `does num candles come in as a number ${typeof this._numCandles}`,
    );
  }

  async onModuleInit() {
    await this._initTables();
    (await this._getHistoricData())
      .pipe(
        tap(() => {
          this.logger.log('GOT HISTORIC DATA');
        }),
      )
      .subscribe(() => {
        this._setupListeners();
      });
  }

  private async _getHistoricData() {
    // number of historical candles to get
    const numCandles = this._numCandles;
    this.logger.log(
      `Starting to fetch ${numCandles} candles for ${this._getGranularityValues().join(
        ' ',
      )}`,
    );
    const observables = {};
    for (const granularity of this._getGranularityValues()) {
      const date = new Date();
      const mostRecentCandle = await this._findCandleExtreme(granularity, true);
      this.logger.log(
        `Most recent candle for ${granularity} granularity is ${mostRecentCandle === undefined ? 'None' : mostRecentCandle
        }`,
      );
      let startDate: Date;
      if (mostRecentCandle === undefined) {
        startDate = addSeconds(date, -1 * numCandles * granularity);
      } else {
        startDate = mostRecentCandle;
      }
      this.logger.log(
        `Starting to fetch historical data for granularity ${granularity} between ${startDate} and ${date}`,
      );
      const observable = this._getHistoricDataForGranularity(
        startDate,
        date,
        granularity,
      ).pipe(
        switchMap((candles) => {
          return this.writeCandles(candles, granularity);
        }),
      );
      observables[`${granularity}`] = observable;
    }

    return forkJoin(observables);
  }

  // candle granularity is in seconds
  // can fetch 300 candles in one api call
  _getHistoricDataForGranularity(
    start: Date,
    end: Date,
    granularity: CandleGranularity,
  ): Observable<Candle[]> {
    const intervalTime = 299 * granularity;
    const finished = new Subject<void>();
    let tempEnd = addSeconds(start, intervalTime);
    return interval(1000).pipe(
      takeUntil(finished),
      switchMap(() => {
        return this.client.rest.product.getCandles('ETH-USD', {
          granularity,
          start: start.toISOString(),
          end: tempEnd.toISOString(),
        });
      }),
      tap(() => {
        start = tempEnd;
        tempEnd = addSeconds(start, intervalTime);

        if (start > end) {
          finished.next();
          finished.complete();
        }
      }),
    );
  }

  private _setupListeners() {
    this.client.rest.on(
      ProductEvent.NEW_CANDLE,
      (productId: string, g: CandleGranularity, candle: Candle) => {
        this.logger.log('Recent candle', productId, g, candle.openTimeInISO);
        this.writeCandles([candle], g).subscribe();
      },
    );

    this.logger.log(`Add global handler for candle listening...`);
    for (const granularity of this._getGranularityValues()) {
      this.logger.log(`Initilizing listener for ${granularity} granularity...`);
      this._setupListen(granularity);
    }
  }

  private _setupListen(granularity: CandleGranularity) {
    this._findCandleExtreme(granularity, true).then((candle) => {
      if (candle === undefined) {
        throw new Error('We should have captured some input before listener');
      }
      this.client.rest.product.watchCandles(
        this.product,
        granularity,
        candle.toISOString(),
      );
    });
  }

  writeCandles(
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
    if (candles.length > 0) {
      this.logger.log(
        `Attempting to write candles for ${candles[0].openTimeInISO} - ${candles[candles.length - 1].openTimeInISO
        }`,
      );
    }
    return from(
      this.knexClient(this._getProductDbName(granularity)).insert(candleData),
    ).pipe(
      catchError((err) => {
        if (this.isUniqueErr(err)) {
          return this.handleUniqueError(candles, granularity);
        }

        throw 'Unhandled write candle error: ' + err;
      }),
    );
  }
  async isUniqueErr(_err: Error) {
    return true;
  }

  handleUniqueError(
    candles: Candle[],
    granularity: CandleGranularity,
  ): Observable<number[]> {
    this.logger.log(`Handling unique error`);
    const previousPromise = this.knexClient<DbCandle>(
      this._getProductDbName(granularity),
    )
      .whereBetween('open_timestamp', [
        candles[0].openTimeInISO,
        candles[candles.length - 1].openTimeInISO,
      ])
      .orderBy('open_timestamp', 'asc');

    return from(previousPromise).pipe(
      map((previous) => {
        if (previous.length === candles.length) {
          this.logger.log(
            `Candles already exist between ${candles[0].openTimeInISO} and ${candles[candles.length - 1].openTimeInISO
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
          return this.writeCandles(retries, granularity);
        } else {
          return retries;
        }
      }),
    );
  }

  private async _initTables() {
    for await (const granularity of this._getGranularityValues()) {
      const tableName: string = this._getProductDbName(granularity);

      if (await this.knexClient.schema.hasTable(tableName)) {
        await this.knexClient.schema.dropTable(tableName);
      }
      await this.knexClient.schema.createTableLike(
        tableName,
        'candle',
        (_t) => { },
      );
      this.logger.log(`${tableName} created...`);
    }
  }

  // UTILITY METHODS
  private _getGranularityValues(): number[] {
    return Object.keys(CandleGranularity)
      .map((g) => parseInt(g))
      .filter((g) => !isNaN(g));
  }

  private async _findCandleExtreme(
    granularity: CandleGranularity,
    mostRecent: boolean,
  ): Promise<Date | undefined> {
    const latestCandle = await this.knexClient<DbCandle>(
      this._getProductDbName(granularity),
    )
      .orderBy('open_timestamp', mostRecent ? 'desc' : 'asc')
      .limit(1)
      .select('open_timestamp');

    if (latestCandle.length === 0) {
      return undefined;
    }

    return latestCandle[0].open_timestamp;
  }

  private _getProductDbName(granularity: CandleGranularity): string {
    let str = this.product.toLowerCase();
    str = str.replace('-', '_');
    str = `${str}_${granularity}`;
    return str;
  }
}
