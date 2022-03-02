import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import CoinbasePro, { CandleGranularity } from 'coinbase-pro-node';
import { addSeconds, isBefore } from 'date-fns';
import {
  Observable,
  from,
  of,
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
  private readonly FETCH_INTERVAL = 110;
  constructor(
    @Inject('COINBASE_CLIENT') private client: CoinbasePro,
    private productService: ProductsService,
    private candleService: CandleService,
    private logger: LoggerService,
  ) {
    logger.setContext('Historic'.slice(0, 6));
  }

  async onModuleInit() {
    const map = await this._getHistoricDataParamMap();
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

    return new Promise((res) => {
      this.paramsToObservable(initialCallParams)
        .pipe(
          finalize(() => {
            this.candleService.setupListeners();
            this.logger.log(`Finished fetching initial historical`);
            this._fetchRemainingCandles(subsequentCalls);
            res(true);
          }),
        )
        .subscribe();
    });
  }

  private _fetchRemainingCandles(params: CandleApiParams[]) {
    this.paramsToObservable(params)
      .pipe(
        finalize(() => {
          this.logger.log('Finished fetching historical');
        }),
      )
      .subscribe();
  }

  private paramsToObservable(params: CandleApiParams[]): Observable<any> {
    return interval(this.FETCH_INTERVAL).pipe(
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
      tap(({ candles, params }) => {
        this.logger.logProduct({
          action: `Received Candles (${candles.length})`,
          product: params.product,
          granularity: params.granularity,
          start: new Date(candles[0].openTimeInISO),
          end: new Date(candles[candles.length - 1].openTimeInISO),
        });
      }),
      switchMap((resp) => {
        return this.candleService.writeCandles(
          resp.params.product,
          resp.candles,
          resp.params.granularity,
        );
      }),
    );
  }

  private async _getHistoricDataParamMap(): Promise<
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
        const promise = this.buildProductGranularityParams(
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
  buildProductGranularityParams(
    product: string,
    granularity: CandleGranularity,
    start: Date,
    end: Date,
  ): CandleApiParams[] {
    const params = new Array<CandleApiParams>();
    const intervalTime = 300 * granularity;
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
}
