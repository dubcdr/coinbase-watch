import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CoinbasePro, { Candle, CandleGranularity } from 'coinbase-pro-node';
import {
  isSameDay,
  format,
  parse,
  addDays,
  isWithinInterval,
  differenceInDays,
} from 'date-fns';
import { Knex } from 'knex';

// Load products of interest
// Check if info initialized
//  find product start date

@Injectable()
export class ProductsService implements OnModuleInit {
  private readonly TABLE_NAME = 'PRODUCTS';
  private logger = new Logger();
  constructor(
    @Inject('COINBASE_CLIENT') protected client: CoinbasePro,
    @Inject('KNEX_CLIENT') protected knexClient: Knex,
    protected configService: ConfigService,
  ) { }

  async onModuleInit() {
    await this._initTable();
    const productString = this.configService.get('PRODUCTS');
    const products = productString.split(',');
    this.logger.log(`Products desired...`);
    for (const product of products) {
      this.logger.log(product);
    }
    const uninitializedProducts = await this._getUninitializedProducts(
      products,
    );
    this.logger.log(`Products to initialize...`);
    for (const product of products) {
      this.logger.log(product);
    }
    await this._initializeProducts(uninitializedProducts);
  }

  // private async _initTable() {
  //   const hasTable = await this.knexClient.schema.hasTable(this.TABLE_NAME);
  //   this.logger.log(`${this.TABLE_NAME} table exists?: ${hasTable}`);
  //   if (!hasTable) {
  //     await this.knexClient.schema.createTable(this.TABLE_NAME, (table) => {
  //       table.increments();
  //       table.string('product_name', 20);
  //       table.date('start_date');
  //     });
  //     this.logger.log(`${this.TABLE_NAME} table created...`);
  //   } else {
  //     this.logger.log(`${this.TABLE_NAME} table exists...`);
  //   }
  // }

  private async _initTable() {
    const hasTable = await this.knexClient.schema.hasTable(this.TABLE_NAME);
    this.logger.log(`${this.TABLE_NAME} table exists?: ${hasTable}`);
    if (hasTable) {
      await this.knexClient.schema.dropTable(this.TABLE_NAME);
    }
    await this.knexClient.schema.createTable(this.TABLE_NAME, (table) => {
      table.increments();
      table.string('product_name', 20);
      table.date('start_date');
    });
    this.logger.log(`${this.TABLE_NAME} table created...`);
  }

  private async _getUninitializedProducts(
    products: string[],
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
      const startDate: Date = await this._getProductStartDate(product);
      await this.knexClient(this.TABLE_NAME).insert({
        product_name: product,
        start_date: startDate,
      });
    }
  }

  private async _getProductStartDate(product: string): Promise<Date> {
    let leftDate = this._getStartDate();
    let rightDate = new Date();
    let leftDateCandles: Candle[];
    try {
      leftDateCandles = await this.client.rest.product.getCandles(product, {
        start: leftDate.toISOString(),
        end: addDays(leftDate, 1).toISOString(),
        granularity: CandleGranularity.ONE_DAY,
      });
    } catch (error) {
      leftDateCandles = [];
    }
    if (leftDateCandles.length > 0) {
      this.logger.log(`${product} start date: ${this._formatDate(leftDate)}`);
      return new Date(leftDateCandles[0].openTimeInISO);
    }
    while (differenceInDays(rightDate, leftDate) !== 1) {
      [leftDate, rightDate] = await this._binomialSearch(
        product,
        leftDate,
        rightDate,
      );
    }
    this.logger.log(`${product} start date: ${this._formatDate(leftDate)}`);
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

    this.logger.log(
      `Binomial search between ${this._formatDate(
        leftDate,
      )} - ${this._formatDate(rightDate)}: ${differenceInDays(
        rightDate,
        leftDate,
      )} days apart`,
    );

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

  private _getStartDate(): Date {
    const startString = this.configService.get('START_DATE');
    const parsedDate = parse(startString, 'd-M-yyyy', new Date());
    return parsedDate;
  }

  private _formatDate(date: Date): string {
    return format(date, 'd-M-yyyy');
  }
}
