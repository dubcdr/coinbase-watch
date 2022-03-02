import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import CoinbasePro, { Candle, CandleGranularity } from 'coinbase-pro-node';
import { addMinutes, addSeconds, isBefore } from 'date-fns';
import {
  Observable,
  take,
  from,
  of,
  mergeAll,
  interval,
  takeWhile,
  switchMap,
  forkJoin,
  finalize,
  tap,
  mergeMap,
} from 'rxjs';
import { CandleService } from 'src/candle/candle.service';
import { IntervalLogData, LoggerService } from 'src/logger/logger.service';
import { ProductsService } from 'src/products/products.service';

export interface CandleApiParams {
  granularity: CandleGranularity;
  product: string;
  start: Date;
  end: Date;
}

@Injectable()
export class HistoricService implements OnModuleInit {
  private readonly MAX_CALLS_PER_SECOND: number = 10;
  constructor(
    @Inject('COINBASE_CLIENT') private client: CoinbasePro,
    private productService: ProductsService,
    private candleService: CandleService,
    private logger: LoggerService,
  ) {
    logger.setContext('Historic');
  }

  async onModuleInit() {
    const map = await this._getHistoricDataObservables();
    const initialCallParams: CandleApiParams[] = [];
    const subsequentCalls: CandleApiParams[] = [];
    for (const key of map.keys()) {
      const promises = map.get(key);
      initialCallParams.push(promises.splice(0, 1)[0]);
    }
    for (const key of map.keys()) {
      const promises = map.get(key);
      subsequentCalls.push(...promises);
    }

    return new Promise((res, rej) => {
      this.paramsToObservable(initialCallParams)
        .pipe(
          switchMap((resp) => {
            return this.candleService.writeCandles(
              resp.params.product,
              resp.candles,
              resp.params.granularity,
            );
          }),
          finalize(() => {
            this.logger.log(`Finished fetching initial historical`);
            this._fetchRemainingCandles(subsequentCalls);
            this.candleService.setupListeners();
            res(true);
          }),
        )
        .subscribe();
    });
  }

  private _fetchRemainingCandles(params: CandleApiParams[]) {
    this.paramsToObservable(params)
      .pipe(
        switchMap((resp) => {
          return this.candleService.writeCandles(
            resp.params.product,
            resp.candles,
            resp.params.granularity,
          );
        }),
        finalize(() => {
          this.logger.log('Finished fetching historical');
        }),
      )
      .subscribe();
  }

  private paramsToObservable(params: CandleApiParams[]): Observable<any> {
    return interval(100).pipe(
      takeWhile(() => params.length > 0),
      mergeMap(() => {
        const [param] = params.splice(0, 1);
        const calls = {
          params: of(param),
          candles: from(
            this.client.rest.product.getCandles(param.product, {
              granularity: param.granularity,
              start: param.start.toISOString(),
              end: param.end.toISOString(),
            }),
          ),
        };
        return forkJoin(calls);
      }),
      // tap(({ candles, params }) => {
      //   this.logger.log(
      //     `Received api resp length ${candles.length}, for ${params.product} - ${params.granularity}`,
      //   );
      // }),
    );
  }

  private async _getHistoricDataObservables(): Promise<
    Map<string, CandleApiParams[]>
  > {
    const promisesMap = new Map<string, CandleApiParams[]>();
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
          startDate = mostRecentCandleDate;
        }
        this.logger.logProduct(logData);
        const promise = this._buildProductGranularityParams(
          product,
          granularity,
          startDate,
          endDate,
        );
        promisesMap.set(`${product}-${granularity}`, promise);
      }
    }
    return promisesMap;
  }

  // candle granularity is in seconds
  // can fetch 300 candles in one api call
  private _buildProductGranularityParams(
    product: string,
    granularity: CandleGranularity,
    start: Date,
    end: Date,
  ): CandleApiParams[] {
    const params = new Array<CandleApiParams>();
    const intervalTime = 299 * granularity;
    const secondsBetween = Math.floor((end.getTime() - start.getTime()) / 1000);
    const fullPulls = Math.floor(secondsBetween / intervalTime);

    for (let i = 0; i < fullPulls; i++) {
      const tempEnd = addSeconds(end, -1 * i * intervalTime);
      const tempStart = addSeconds(end, (-1 * i - 1) * intervalTime);
      params.push({
        end: tempEnd,
        start: tempStart,
        granularity,
        product,
      });
    }

    const remaining = Math.floor((secondsBetween % intervalTime) / granularity);
    this.logger.logProduct({
      granularity,
      product,
      action: `Seconds between\t${secondsBetween}\tFull Pulls ${fullPulls}\tRemaining ${remaining}`,
    });

    params.push({
      granularity,
      product,
      start,
      end: addSeconds(start, remaining * granularity),
    });

    return params;
  }

  private _getFetchInterval(): number {
    const products = this.productService.products.size;
    const granularities = this.productService.getGranularityValues().length;
    const channels = products * granularities;
    const rate = channels / this.MAX_CALLS_PER_SECOND;

    return rate * 1000;
  }
}
