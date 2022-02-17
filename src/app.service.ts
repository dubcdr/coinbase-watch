import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import CoinbasePro, {
  Candle,
  CandleGranularity,
  ProductEvent,
} from 'coinbase-pro-node';
import { addDays, addMinutes } from 'date-fns';
import { interval, Observable, Subject, switchMap, tap, takeUntil } from 'rxjs';

@Injectable()
export class AppService implements OnModuleInit {
  constructor(@Inject('COINBASE_CLIENT') private client: CoinbasePro) { }

  async onModuleInit() {

    const date = new Date();
    const startDate = addDays(date, -180);
    const endDate = addMinutes(date, -60);
    this.getHistoricData(startDate, endDate).subscribe(historic => {
      console.log(`Got data for ${historic[0].openTimeInISO}, closing price ${historic[0].close}`);
    })
  }

  async setupListen() {
    const productId = 'ETH-USD';
    const granularity = CandleGranularity.ONE_MINUTE;

    this.client.rest.on(ProductEvent.NEW_CANDLE,
      (productId: string, granularity: CandleGranularity, candle: Candle) => {
        console.info('Recent candle', productId, granularity, candle.openTimeInISO);
        console.table(candle);
      })

    // 3. Get latest candle
    const candles = await this.client.rest.product.getCandles(productId, {
      granularity,
    });
    const latestCandle = candles[candles.length - 1];
    const latestOpen = latestCandle.openTimeInISO;
    console.info('Initial candle', productId, granularity, latestOpen);
    console.table(latestCandle);

    // 4. Subscribe to upcoming candles
    this.client.rest.product.watchCandles(productId, granularity, latestOpen);

  }

  getHistoricData(start: Date, end: Date): Observable<Candle[]> {
    const finished = new Subject<void>();
    let tempEnd = addMinutes(start, 60);
    return interval(200)
      .pipe(
        takeUntil(finished),
        switchMap(() => {
          return this.client.rest.product.getCandles('ETH-USD', {
            granularity: CandleGranularity.ONE_MINUTE,
            start: start.toISOString(),
            end: tempEnd.toISOString(),
          });
        }),
        tap(() => {

          start = tempEnd;
          tempEnd = addMinutes(start, 10);

          if (start > end) {
            finished.next();
            finished.complete();
          }

        })
      )
  }
}
