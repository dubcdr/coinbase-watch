import { Test, TestingModule } from '@nestjs/testing';
import { CandleService } from './candle.service';

describe('CandleService', () => {
  let service: CandleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CandleService],
    }).compile();

    service = module.get<CandleService>(CandleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
