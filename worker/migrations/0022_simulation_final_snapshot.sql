-- 종료 시각의 현금·보유·가격·환율을 계좌별로 고정한다. 가격 누락은 NULL로 보존한다.
CREATE TABLE sim_final_holdings (
  account_id TEXT NOT NULL REFERENCES sim_accounts(id), security_id INTEGER NOT NULL REFERENCES sim_securities(id),
  name TEXT NOT NULL,ticker TEXT NOT NULL,currency TEXT NOT NULL,market TEXT NOT NULL,
  qty REAL NOT NULL,cost_krw REAL NOT NULL,price REAL,price_at TEXT,fx REAL,fx_date TEXT,
  PRIMARY KEY(account_id,security_id)
);
CREATE TABLE sim_final_accounts (
  account_id TEXT PRIMARY KEY REFERENCES sim_accounts(id), as_of TEXT NOT NULL,
  cash REAL NOT NULL,equity REAL,return_pct REAL,complete INTEGER NOT NULL CHECK(complete IN (0,1))
);
