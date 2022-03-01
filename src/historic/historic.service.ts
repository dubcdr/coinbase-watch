import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import CoinbasePro, { Candle, CandleGranularity } from 'coinbase-pro-node';
import { addSeconds, isBefore } from 'date-fns';
import pThrottle from 'p-throttle';
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
    const throttled = await this._getHistoricData();

    // return new Promise((resolve, reject) => {
    //   this._getHistoricData().then((subj) => {
    //     subj.subscribe(() => {
    //       this.logger.log('Inserted historic data...');
    //       this.candleService.setupListeners();
    //       resolve(true);
    //     });
    //   });
    // });
  }

  private async _getHistoricData() {
    const throttle = pThrottle({
      limit: 15,
      interval: 1000,
    });
    // return this.candleService.writeCandles(
    //   product,
    //   candles,
    //   granularity,
    // );
    const throttled = throttle(
      async (
        promise: Promise<Candle[]>,
        {
          product,
          granularity,
        }: { product: string; granularity: CandleGranularity },
      ) => {
        const candles = await promise;
        return await this.candleService.writeCandles(
          product,
          candles,
          granularity,
        );
      },
    );
    for (const product of this.productService.products) {
      for (const granularity of this.productService.getGranularityValues()) {
        const apiPromises: Promise<Candle[]>[] = [];
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
        apiPromises.push(
          ...this._getHistoricDataForGranularity(
            product,
            startDate,
            endDate,
            granularity,
          ),
        );
        for (const promise of apiPromises) {
          throttled(promise, { granularity, product });
        }
      }
    }

    return throttled;
  }

  // candle granularity is in seconds
  // can fetch 300 candles in one api call
  private _getHistoricDataForGranularity(
    product: string,
    start: Date,
    end: Date,
    granularity: CandleGranularity,
  ): Promise<Candle[]>[] {
    const promises = new Array<Promise<Candle[]>>();
    const intervalTime = 299 * granularity;
    const secondsBetween = end.getSeconds() - start.getSeconds();
    const fullPulls = Math.floor(secondsBetween / intervalTime);
    this.logger.logProduct({
      granularity,
      product,
      action: `Full Pulls ${fullPulls}`,
    });

    for (let i = 0; i < fullPulls; i++) {
      const tempEnd = addSeconds(end, -1 * i * intervalTime);
      const tempStart = addSeconds(end, (-1 * i - 1) * intervalTime);
      promises.push(
        this.client.rest.product.getCandles(product, {
          granularity,
          start: tempStart.toISOString(),
          end: tempEnd.toISOString(),
        }),
      );
    }

    const remaining = secondsBetween % intervalTime;
    this.logger.logProduct({
      granularity,
      product,
      action: `Remaining Candles ${remaining * granularity}`,
    });
    promises.push(
      this.client.rest.product.getCandles(product, {
        granularity,
        start: start.toISOString(),
        end: addSeconds(start, remaining * granularity).toISOString(),
      }),
    );

    return promises;
  }

  private _getFetchInterval(): number {
    const products = this.productService.products.size;
    const granularities = this.productService.getGranularityValues().length;
    const channels = products * granularities;
    const rate = channels / 15;

    return rate * 1000;
  }
}
