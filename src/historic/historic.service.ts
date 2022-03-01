import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import CoinbasePro, { Candle, CandleGranularity } from 'coinbase-pro-node';
import { addDays, addSeconds } from 'date-fns';
import {
  forkJoin,
  interval,
  catchError,
  Observable,
  Subject,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { CandleService } from 'src/candle/candle.service';
import { ProductsService } from 'src/products/products.service';
import { formatDateForLog } from 'src/utils/format-date.fn';

@Injectable()
export class HistoricService implements OnModuleInit {
  private logger = new Logger('Historic');
  constructor(
    @Inject('COINBASE_CLIENT') private client: CoinbasePro,
    private productService: ProductsService,
    private candleService: CandleService,
  ) {}

  async onModuleInit() {
    return new Promise((resolve, reject) => {
      this._getHistoricData().then((subj) => {
        subj.subscribe(() => {
          this.logger.log('Inserted historic data...');
          this.candleService.setupListeners();
          resolve(true);
        });
      });
    });
  }

  private async _getHistoricData() {
    const observables = {};
    for (const product of this.productService.products) {
      for (const granularity of this.productService.getGranularityValues()) {
        const endDate = new Date();
        const mostRecentCandle = await this.candleService.findCandleExtreme(
          product,
          granularity,
          true,
        );
        this.logger.log(
          `Most recent candle for ${granularity} granularity is ${
            mostRecentCandle === undefined ? 'None' : mostRecentCandle
          }`,
        );
        let startDate: Date;
        if (mostRecentCandle === undefined) {
          startDate = await this.productService.getProductStartDate(product);
          // startDate = addSeconds(endDate, -1 * numCandles * granularity);
        } else {
          startDate = mostRecentCandle;
        }
        this.logger.log(
          `Starting to fetch historical data for granularity ${granularity} between ${formatDateForLog(
            startDate,
          )} and ${formatDateForLog(endDate)}`,
        );
        const observable = this._getHistoricDataForGranularity(
          startDate,
          endDate,
          granularity,
        ).pipe(
          switchMap((candles) => {
            return this.candleService.writeCandles(
              product,
              candles,
              granularity,
            );
          }),
        );
        observables[`${granularity}`] = observable;
      }
    }

    return forkJoin(observables);
  }

  // candle granularity is in seconds
  // can fetch 300 candles in one api call
  private _getHistoricDataForGranularity(
    start: Date,
    end: Date,
    granularity: CandleGranularity,
  ): Observable<Candle[]> {
    const intervalTime = 299 * granularity;
    const finished = new Subject<void>();
    let tempEnd = addSeconds(start, intervalTime);
    this.logger.log(`Fetch interval ${this._getFetchInterval()}`);
    return interval(this._getFetchInterval()).pipe(
      takeUntil(finished),
      switchMap(() => {
        return this.client.rest.product.getCandles('ETH-USD', {
          granularity,
          start: start.toISOString(),
          end: tempEnd.toISOString(),
        });
      }),
      catchError((err) => {
        this.logger.error(`Error fetching candles`);
        this.logger.error(JSON.stringify(err, null, 2));
        throw 'Error fetching candles';
      }),
      tap(() => {
        start = addDays(addSeconds(start, intervalTime), 1);
        tempEnd = addSeconds(start, intervalTime);

        if (start > end) {
          finished.next();
          finished.complete();
        }
      }),
    );
  }

  private _getFetchInterval(): number {
    const products = this.productService.products.size;
    const granularities = this.productService.getGranularityValues().length;
    const channels = products * granularities;
    const rate = channels / 15;

    return rate * 1000;
  }
}
