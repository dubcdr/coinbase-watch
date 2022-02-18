-- create TABLE [IF NOT EXISTS] granularity (
--   id SERIAL PRIMARY KEY,
--   text VARCHAR(50) NOT NULL,
-- )

-- INSERT INTO 
--   granularity (text)
-- VALUES
--   ('1m')
--   ('5m')
--   ('15m')
--   ('1hr')
--   ('6hr')
--   ('1d')

create TABLE IF NOT EXISTS candle (
  open_timestamp TIMESTAMP PRIMARY KEY NOT NULL,
  open DECIMAL ( 10, 2 ) NOT NULL,
  close DECIMAL ( 10, 2 ) NOT NULL,
  high DECIMAL ( 10, 2 ) NOT NULL,
  low DECIMAL ( 10, 2 ) NOT NULL,
  volume DECIMAL ( 16, 8 ) NOT NULL
);

create TABLE IF NOT EXISTS eth_1m_candle (LIKE candle INCLUDING ALL);
create TABLE IF NOT EXISTS eth_5m_candle (LIKE candle INCLUDING ALL);
create TABLE IF NOT EXISTS eth_15m_candle (LIKE candle INCLUDING ALL);
create TABLE IF NOT EXISTS eth_1hr_candle (LIKE candle INCLUDING ALL);
create TABLE IF NOT EXISTS eth_6hr_candle (LIKE candle INCLUDING ALL);
create TABLE IF NOT EXISTS eth_1d_candle (LIKE candle INCLUDING ALL);
