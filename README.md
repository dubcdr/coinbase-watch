
## Description
Fetch and monitor candles for different time-frames and different tokens.

Starting just with eth

Time-frames
- 1m
- 5m
- 15m
- 1hr
- 6hr
- 24hr


Server Life-Cycle for each time frame
1. Fetch most recent db entry 
2. Start listening and adding (do this immediately so we dont miss after catching up)
3. Catch up with previous most recent entry


## Coinbase APIs

[Get Candle](https://docs.cloud.coinbase.com/exchange/reference/exchangerestapi_getproductcandles)
- Maximum response per call is 300 candles
- Rate limit is 10 requests per second.



## Installation

```bash
$ npm install
```

## Running the app

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Test

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

