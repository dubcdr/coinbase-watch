import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import CoinbasePro, {
  Candle,
  CandleGranularity,
  ProductEvent,
} from 'coinbase-pro-node';
import { addDays, addMinutes, isEqual } from 'date-fns';
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
} from 'rxjs';

export interface DbCandle {
  open_timestamp: Date;
  open: number;
  close: number;
  high: number;
  low: number;
}

abstract class CandleService implements OnModuleInit {
  private readonly logger: Logger;
  abstract granularity: CandleGranularity;
  abstract product: string;

  get tableName(): string {
    return 'eth_1m_candle';
  }

  get granularity_string(): string {
    return '1m';
  }

  constructor(protected client: CoinbasePro, protected knexClient: Knex) {
    this.logger = new Logger(this.tableName);
  }

  async onModuleInit() {
    const date = new Date();
    const startDate = addDays(date, -7);
    const endDate = addMinutes(date, -60);
    this.getHistoricData(startDate, endDate)
      .pipe(
        tap((historic) => {
          this.logger.log(
            `Got data for ${historic[0].openTimeInISO}, closing price ${historic[0].close}`,
          );
        }),
        switchMap((apiResp) => {
          return from(this.writeCandles(apiResp)).pipe(
            // tap((resp) => {
            //   this.logger.log(resp);
            // }),
            catchError((err) => {
              // this.logger.log(err);
              return from(this.handleUniqueError(apiResp));
            }),
          );
        }),
      )
      .subscribe((dbResp) => {
        this.logger.log(`Inserted ${this.granularity_string} candles`);
      });
  }

  async setupListen() {
    this.client.rest.on(
      ProductEvent.NEW_CANDLE,
      (productId: string, granularity: CandleGranularity, candle: Candle) => {
        this.logger.log(
          'Recent candle',
          productId,
          granularity,
          candle.openTimeInISO,
        );
      },
    );

    // 3. Get latest candle
    const candles = await this.client.rest.product.getCandles(this.product, {
      granularity: this.granularity,
    });
    const latestCandle = candles[candles.length - 1];
    const latestOpen = latestCandle.openTimeInISO;
    this.logger.log(
      'Initial candle',
      this.product,
      this.granularity,
      latestOpen,
    );
    // console.table(latestCandle);

    // 4. Subscribe to upcoming candles
    this.client.rest.product.watchCandles(
      this.product,
      this.granularity,
      latestOpen,
    );
  }

  getHistoricData(start: Date, end: Date): Observable<Candle[]> {
    const finished = new Subject<void>();
    let tempEnd = addMinutes(start, 299);
    return interval(200).pipe(
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
      }),
    );
  }

  writeCandles(candles: Candle[]) {
    const candleData = candles.map((candle) => ({
      open_timestamp: candle.openTimeInISO,
      high: candle.high,
      low: candle.low,
      open: candle.open,
      close: candle.close,
      volume: candle.volume,
    }));
    return this.knexClient(this.tableName).insert(candleData);
  }

  async handleUniqueError(candles: Candle[]) {
    this.logger.log(`Handling unique error`);
    const previous: DbCandle[] = await this.knexClient(this.tableName)
      .whereBetween('open_timestamp', [
        candles[0].openTimeInISO,
        candles[candles.length - 1].openTimeInISO,
      ])
      .orderBy('open_timestamp', 'asc');

    if (previous.length === candles.length) {
      this.logger.log(
        `Candles already exist between ${candles[0].openTimeInISO} and ${candles[candles.length - 1].openTimeInISO
        }`,
      );
      return;
    }

    const lastTime = previous[previous.length - 1].open_timestamp;
    const lastIndex = candles.findIndex((c) =>
      isEqual(lastTime, new Date(c.openTimeInISO)),
    );

    this.logger.log(`Trying to put candles after ${lastTime}`);

    return await this.writeCandles(candles.slice(lastIndex + 1));
  }
}

@Injectable()
export class EthService extends CandleService {
  product = 'ETH-USD';
  granularity = CandleGranularity.ONE_MINUTE;

  constructor(
    @Inject('COINBASE_CLIENT') protected client: CoinbasePro,
    @Inject('KNEX_CLIENT') protected knexClient: Knex,
  ) {
    super(client, knexClient);
  }
}
