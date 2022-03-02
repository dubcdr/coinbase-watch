import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CoinbasePro, { Candle, CandleGranularity } from 'coinbase-pro-node';
import { parse, addDays, differenceInDays } from 'date-fns';
import { Knex } from 'knex';
import { IntervalLogData, LoggerService } from 'src/logger/logger.service';

// Load products of interest
// Check if info initialized
//  find product start date
export interface ProductRow {
  id: number;
  start_date: Date;
  product_name: string;
}

@Injectable()
export class ProductsService implements OnModuleInit {
  private readonly TABLE_NAME = 'PRODUCTS';
  private _products: Set<string>;

  public get products(): Set<string> {
    return new Set<string>(this._products);
  }

  constructor(
    @Inject('COINBASE_CLIENT') private client: CoinbasePro,
    @Inject('KNEX_CLIENT') private knexClient: Knex,
    private configService: ConfigService,
    private logger: LoggerService,
  ) {
    logger.setContext('Product');
  }

  async onModuleInit() {
    const productStrings = this.configService.get('PRODUCTS');
    this._products = new Set<string>(productStrings.split(','));

    await this._initTable();
    await this._initCandleTables();

    this.logger.log(
      `Products desired: ${Array.from(this.products.values()).join(', ')}`,
    );
    const uninitializedProducts = await this._getUninitializedProducts(
      this.products,
    );
    await this._initializeProducts(uninitializedProducts);
  }

  async getProductStartDate(product: string) {
    let rows = await this._getProductStartDate(product);
    if (rows.length === 0) {
      await this._initializeProducts([product]);
      rows = await this._getProductStartDate(product);
    }
    return rows[0].start_date;
  }

  public getGranularityValues(): number[] {
    return Object.keys(CandleGranularity)
      .map((g) => parseInt(g))
      .filter((g) => !isNaN(g));
  }

  public getProductDbName(
    product: string,
    granularity: CandleGranularity,
  ): string {
    let str = product.toLowerCase();
    str = str.replace('-', '_');
    str = `candle_${str}_${granularity}`;
    return str;
  }

  async _getProductStartDate(product: string): Promise<ProductRow[]> {
    return await this.knexClient<ProductRow>(this.TABLE_NAME).where(
      'product_name',
      '=',
      product,
    );
  }

  private async _initTable() {
    const hasTable = await this.knexClient.schema.hasTable(this.TABLE_NAME);
    // this.logger.log(`${this.TABLE_NAME} table exists?: ${hasTable}`);
    if (!hasTable) {
      await this.knexClient.schema.createTable(this.TABLE_NAME, (table) => {
        table.increments();
        table.string('product_name', 20);
        table.date('start_date');
      });
    }
  }

  private async _initCandleTables() {
    for (const product of this.products) {
      for await (const granularity of this.getGranularityValues()) {
        const tableName: string = this.getProductDbName(product, granularity);
        if (await this.knexClient.schema.hasTable(tableName)) {
          this.logger.log(`${tableName} exists...`);
        } else {
          await this.knexClient.schema.createTableLike(
            tableName,
            'candle',
            null,
          );
          this.logger.log(`${tableName} created...`);
        }
      }
    }
  }

  private async _getUninitializedProducts(
    products: Set<string>,
  ): Promise<string[]> {
    const uninitialized = new Array<string>();
    for await (const product of products) {
      const row = await this.knexClient(this.TABLE_NAME).where(
        'product_name',
        product,
      );
      if (row.length === 0) {
        uninitialized.push(product);
      }
    }

    return uninitialized;
  }

  private async _initializeProducts(products: string[]) {
    for await (const product of products) {
      const startDate: Date = await this._findProductStartDate(product);
      await this.knexClient(this.TABLE_NAME).insert({
        product_name: product,
        start_date: addDays(startDate, 1),
      });
    }
  }

  private async _findProductStartDate(product: string): Promise<Date> {
    let leftDate = this.getEnvStartDate();
    let rightDate = new Date();
    let leftDateCandles: Candle[];
    const granularity = CandleGranularity.ONE_DAY;
    try {
      leftDateCandles = await this.client.rest.product.getCandles(product, {
        start: leftDate.toISOString(),
        end: addDays(leftDate, 1).toISOString(),
        granularity: CandleGranularity.ONE_DAY,
      });
    } catch (error) {
      leftDateCandles = [];
    }
    const logData: IntervalLogData = {
      start: leftDate,
      granularity,
      product,
      action: `Historic start date`,
    };
    if (leftDateCandles.length > 0) {
      this.logger.logProduct(logData);
      return new Date(leftDateCandles[0].openTimeInISO);
    }
    while (differenceInDays(rightDate, leftDate) !== 1) {
      [leftDate, rightDate] = await this._binomialSearch(
        product,
        leftDate,
        rightDate,
      );
    }
    logData.start = leftDate;
    this.logger.logProduct(logData);
    return rightDate;
  }

  private async _binomialSearch(
    product: string,
    leftDate: Date,
    rightDate: Date,
  ): Promise<Date[]> {
    const midpointMillis = (leftDate.getTime() + rightDate.getTime()) / 2;
    const midpoint = new Date(midpointMillis);
    let midpointCandles: Candle[];

    const granularity = CandleGranularity.ONE_DAY;
    const logData: IntervalLogData = {
      product,
      granularity,
      start: leftDate,
      end: rightDate,
      action: `Binomial Search (${differenceInDays(
        rightDate,
        leftDate,
      )} days between)`,
    };

    this.logger.log(logData);

    try {
      midpointCandles = await this.client.rest.product.getCandles(product, {
        granularity: CandleGranularity.ONE_DAY,
        start: midpoint.toISOString(),
        end: addDays(midpoint, 1).toISOString(),
      });
    } catch (err) {
      midpointCandles = [];
    }

    if (midpointCandles.length > 0) {
      return [leftDate, midpoint];
    } else {
      return [midpoint, rightDate];
    }
  }

  public getEnvStartDate(): Date {
    const startString = this.configService.get('START_DATE');
    const parsedDate = parse(startString, 'd-M-yyyy', new Date());
    return parsedDate;
  }
}
