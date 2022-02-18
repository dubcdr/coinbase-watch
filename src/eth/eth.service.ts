import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository, } from '@nestjs/typeorm';
import CoinbasePro, {
  Candle,
  CandleGranularity,
  ProductEvent,
} from 'coinbase-pro-node';
import { addDays, addMinutes } from 'date-fns';
import { interval, Observable, Subject, switchMap, tap, takeUntil, from } from 'rxjs';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { CandleEntity, EthMinuteCandle } from './eth.entity';


abstract class CandleService<X extends CandleEntity> implements OnModuleInit {
  abstract granularity: CandleGranularity;
  abstract product: string;

  constructor(
    protected client: CoinbasePro,
    protected repo: Repository<X>
  ) {

  }

  async onModuleInit() {
    const date = new Date();
    const startDate = addDays(date, -7);
    const endDate = addMinutes(date, -60);
    this.getHistoricData(startDate, endDate).
      pipe(
        tap(historic => {
          console.log(`Got data for ${historic[0].openTimeInISO}, closing price ${historic[0].close}`);
        }),
        switchMap(apiResp => {
          return from(this.writeCandles(apiResp));
        })
      )
      .subscribe(_dbResp => {
        console.log('inserted to db')
      })
  }

  async setupListen() {

    this.client.rest.on(ProductEvent.NEW_CANDLE,
      (productId: string, granularity: CandleGranularity, candle: Candle) => {
        console.info('Recent candle', productId, granularity, candle.openTimeInISO);
        console.table(candle);
      })

    // 3. Get latest candle
    const candles = await this.client.rest.product.getCandles(this.product, {
      granularity: this.granularity,
    });
    const latestCandle = candles[candles.length - 1];
    const latestOpen = latestCandle.openTimeInISO;
    console.info('Initial candle', this.product, this.granularity, latestOpen);
    console.table(latestCandle);

    // 4. Subscribe to upcoming candles
    this.client.rest.product.watchCandles(this.product, this.granularity, latestOpen);

  }

  getHistoricData(start: Date, end: Date): Observable<Candle[]> {
    const finished = new Subject<void>();
    let tempEnd = addMinutes(start, 299);
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
          tempEnd = addMinutes(start, 299);

          if (start > end) {
            finished.next();
            finished.complete();
          }

        })
      )
  }

  writeCandles(candles: Candle[]) {
    const candleData = candles.map(candle => ({
      time: candle.openTimeInMillis,
      high: candle.high,
      low: candle.low,
      open: candle.open,
      close: candle.close,
      volume: candle.volume
    })) as unknown as QueryDeepPartialEntity<X>[];
    return this.repo.insert(candleData);
  }
}

@Injectable()
export class EthService extends CandleService<EthMinuteCandle> {
  product = 'ETH-USD';
  granularity = CandleGranularity.ONE_MINUTE;


  constructor(
    @Inject('COINBASE_CLIENT') protected client: CoinbasePro,
    @InjectRepository(EthMinuteCandle) protected ethMinuteRepository: Repository<EthMinuteCandle>
  ) {
    super(client, ethMinuteRepository)
  }



}
