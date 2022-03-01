import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import CoinbasePro, { Candle, CandleGranularity } from 'coinbase-pro-node';
import { addDays, addSeconds, isAfter, isBefore } from 'date-fns';
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
import { IntervalLogData, LoggerService } from 'src/logger/logger.service';
import { ProductsService } from 'src/products/products.service';

@Injectable()
export class HistoricService implements OnModuleInit {
  constructor(
    @Inject('COINBASE_CLIENT') private client: CoinbasePro,
    private productService: ProductsService,
    private candleService: CandleService,
    private logger: LoggerService,
  ) {
    logger.setContext('Historic');
  }

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
        const mostRecentCandleDate = await this.candleService.findCandleExtreme(
          product,
          granularity,
          true,
        );
        let startDate: Date;
        let logData: IntervalLogData;
        if (mostRecentCandleDate === undefined) {
          const envStartDate = this.productService.getEnvStartDate();
          startDate = isBefore(mostRecentCandleDate, envStartDate)
            ? mostRecentCandleDate
            : envStartDate;
          logData = {
            start: startDate,
            end: endDate,
            product,
            granularity,
            action: 'Load Between',
          };
        } else {
          logData = {
            start: mostRecentCandleDate,
            action: `Catching up`,
            product,
            granularity,
          };
          this.logger.logProduct(logData);
          startDate = mostRecentCandleDate;
        }
        this.logger.logProduct(logData);
        const observable = this._getHistoricDataForGranularity(
          product,
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
        observables[`${product}-${granularity}`] = observable;
      }
    }

    return forkJoin(observables);
  }

  // candle granularity is in seconds
  // can fetch 300 candles in one api call
  private _getHistoricDataForGranularity(
    product: string,
    start: Date,
    end: Date,
    granularity: CandleGranularity,
  ): Observable<Candle[]> {
    const intervalTime = 299 * granularity;
    const finished = new Subject<void>();
    let tempEnd = addSeconds(start, intervalTime);
    return interval(this._getFetchInterval()).pipe(
      takeUntil(finished),
      switchMap(() => {
        return this.client.rest.product.getCandles(product, {
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

        if (isAfter(start, end)) {
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
