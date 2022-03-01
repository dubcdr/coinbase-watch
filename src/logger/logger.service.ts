import { ConsoleLogger, Injectable, Scope } from '@nestjs/common';
import { CandleGranularity } from 'coinbase-pro-node';
import { format } from 'date-fns';

export interface IntervalLogData {
  start?: Date;
  end?: Date;
  product: string;
  granularity: CandleGranularity;
  action: string;
}

const granularityMap = new Map<CandleGranularity, string>([
  [CandleGranularity.ONE_MINUTE, '1m'],
  [CandleGranularity.FIVE_MINUTES, '5m'],
  [CandleGranularity.FIFTEEN_MINUTES, '15m'],
  [CandleGranularity.ONE_HOUR, '1hr'],
  [CandleGranularity.SIX_HOURS, '6hr'],
  [CandleGranularity.ONE_DAY, '1d'],
]);

@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService extends ConsoleLogger {
  logProduct(data: IntervalLogData) {
    const { start, end, product, granularity, action } = data;
    let msg = `${action}\t|| ${product}\t|| ${granularityMap
      .get(granularity)
      .padStart(3, ' ')}`;
    if (start !== undefined) {
      msg = `${msg} || ${this.formatDate(start)}`;
    }
    if (end !== undefined) {
      msg = `${msg} - ${this.formatDate(end)}`;
    }
    super.log(msg);
  }

  formatDate(date: Date | undefined): string {
    if (date === undefined) {
      return 'None';
    }
    return format(date, 'dd-MM-yyyy::HH:mm');
  }
}
