import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import CoinbasePro, { Candle, CandleGranularity } from 'coinbase-pro-node';
import { addSeconds, isBefore } from 'date-fns';

import { CandleService } from 'src/candle/candle.service';
import { IntervalLogData, LoggerService } from 'src/logger/logger.service';
import { ProductsService } from 'src/products/products.service';
import { pThrottle } from 'src/utils/throttle.fn';

@Injectable()
export class HistoricService implements OnApplicationBootstrap {
  constructor(
    @Inject('COINBASE_CLIENT') private client: CoinbasePro,
    private productService: ProductsService,
    private candleService: CandleService,
    private logger: LoggerService,
  ) {
    logger.setContext('Historic');
  }

  async onApplicationBootstrap() {
    return new Promise((resolve, reject) => {
      const historicDataPromise = this._getHistoricData();
      this.logger.log('Loaded historic data');
      resolve(true);
    });
  }

  private async _getHistoricData() {
    const throttle = pThrottle({
      limit: 15,
      interval: 1000,
      strict: false,
    });

    const throttled = throttle(
      async (
        promise: Promise<Candle[]>,
        {
          product,
          granularity,
        }: { product: string; granularity: CandleGranularity },
      ) => {
        const candles = await promise;
        if (candles.length < 301) {
          return await this.candleService.writeCandles(
            product,
            candles,
            granularity,
          );
        } else {
          this.logger.error(
            `Should never happen, trying to write more than 300 candles`,
          );
        }
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
          const result = throttled(promise, { granularity, product });
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
    const secondsBetween = Math.floor((end.getTime() - start.getTime()) / 1000);
    const fullPulls = Math.floor(secondsBetween / intervalTime);

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

    const remaining = Math.floor((secondsBetween % intervalTime) / granularity);
    this.logger.logProduct({
      granularity,
      product,
      action: `Seconds between\t${secondsBetween}\tFull Pulls ${fullPulls}\tRemaining ${remaining}`,
    });
    // this.logger.logProduct({
    //   granularity,
    //   product,
    //   action: `Remaining Candles ${remaining}`,
    // });
    promises.push(
      this.client.rest.product.getCandles(product, {
        granularity,
        start: start.toISOString(),
        end: addSeconds(start, remaining * granularity).toISOString(),
      }),
    );

    return promises;
  }
}
