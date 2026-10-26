-- 모의투자는 실제 보유·의견·현금과 완전히 분리한다.
CREATE TABLE sim_securities (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, ticker TEXT NOT NULL, ysym TEXT NOT NULL UNIQUE,
  market TEXT NOT NULL CHECK(market IN ('KR','US')), currency TEXT NOT NULL CHECK(currency IN ('KRW','USD')),
  checked_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE sim_prices (
  security_id INTEGER NOT NULL REFERENCES sim_securities(id), date TEXT NOT NULL,
  open REAL, close REAL NOT NULL, PRIMARY KEY(security_id,date)
);
CREATE TABLE sim_fx (date TEXT PRIMARY KEY, close REAL NOT NULL);
CREATE TABLE sim_state (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE sim_contests (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, initial_cash REAL NOT NULL CHECK(initial_cash > 0),
  fee_bps REAL NOT NULL CHECK(fee_bps BETWEEN 0 AND 100),
  slippage_bps REAL NOT NULL CHECK(slippage_bps BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
  created_at TEXT NOT NULL, ended_at TEXT,
  rules_version TEXT NOT NULL DEFAULT '1',
  accounting_note TEXT NOT NULL DEFAULT '가격·환율 기준 잠정 성과. 배당·분할 자동 반영 전이므로 최종 평가에 사용하지 않습니다.'
);
CREATE TABLE sim_accounts (
  id TEXT PRIMARY KEY, contest_id TEXT NOT NULL REFERENCES sim_contests(id),
  agent_id TEXT NOT NULL, name TEXT NOT NULL, cash REAL NOT NULL CHECK(cash >= -0.01),
  token_hash TEXT, UNIQUE(contest_id,agent_id)
);
CREATE UNIQUE INDEX sim_one_active ON sim_contests(status) WHERE status='active';
CREATE UNIQUE INDEX sim_account_token ON sim_accounts(token_hash) WHERE token_hash IS NOT NULL;
CREATE TABLE sim_theses (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES sim_accounts(id),
  security_id INTEGER NOT NULL REFERENCES sim_securities(id), created_at TEXT NOT NULL,
  thesis TEXT NOT NULL, valuation TEXT NOT NULL, scenarios TEXT NOT NULL,
  risks TEXT NOT NULL, invalidation TEXT NOT NULL, sources TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sim_thesis_account ON sim_theses(account_id,created_at);
CREATE TABLE sim_orders (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES sim_accounts(id),
  security_id INTEGER NOT NULL REFERENCES sim_securities(id), thesis_id TEXT NOT NULL REFERENCES sim_theses(id),
  side TEXT NOT NULL CHECK(side IN ('buy','sell')), qty REAL NOT NULL CHECK(qty > 0),
  reason TEXT NOT NULL, created_at TEXT NOT NULL, market_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','filled','cancelled','rejected')),
  status_reason TEXT, resolved_at TEXT, client_order_id TEXT NOT NULL,
  UNIQUE(account_id,client_order_id)
);
CREATE INDEX sim_order_pending ON sim_orders(status,created_at,id);
CREATE TRIGGER sim_order_validate BEFORE INSERT ON sim_orders BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sim_theses WHERE id=NEW.thesis_id AND account_id=NEW.account_id AND security_id=NEW.security_id)
    THEN RAISE(ABORT,'계좌와 분석 종목이 일치하지 않습니다') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sim_accounts a JOIN sim_contests c ON c.id=a.contest_id WHERE a.id=NEW.account_id AND c.status='active')
    THEN RAISE(ABORT,'종료된 대회입니다') END;
END;
CREATE TABLE sim_positions (
  account_id TEXT NOT NULL REFERENCES sim_accounts(id), security_id INTEGER NOT NULL REFERENCES sim_securities(id),
  qty REAL NOT NULL CHECK(qty >= -0.000001), cost_krw REAL NOT NULL CHECK(cost_krw >= -0.01),
  PRIMARY KEY(account_id,security_id)
);
CREATE TABLE sim_fills (
  order_id TEXT PRIMARY KEY REFERENCES sim_orders(id), date TEXT NOT NULL,
  price REAL NOT NULL CHECK(price > 0), fx REAL NOT NULL CHECK(fx > 0),
  fx_date TEXT NOT NULL, fee_krw REAL NOT NULL CHECK(fee_krw >= 0),
  cash_delta REAL NOT NULL, created_at TEXT NOT NULL
);
-- 체결·잔고·보유·주문 상태가 단일 SQLite 문장 안에서 원자적으로 반영된다.
CREATE TRIGGER sim_fill_validate BEFORE INSERT ON sim_fills BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sim_orders WHERE id=NEW.order_id AND status='pending')
    THEN RAISE(ABORT,'이미 처리된 주문입니다') END;
  SELECT CASE WHEN (SELECT a.cash + NEW.cash_delta FROM sim_orders o JOIN sim_accounts a ON a.id=o.account_id WHERE o.id=NEW.order_id) < -0.001
    THEN RAISE(ABORT,'현금이 부족합니다') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM sim_orders o WHERE o.id=NEW.order_id AND o.side='sell' AND o.qty >
    COALESCE((SELECT qty FROM sim_positions WHERE account_id=o.account_id AND security_id=o.security_id),0) + 0.000001)
    THEN RAISE(ABORT,'매도할 수량이 부족합니다') END;
END;
CREATE TRIGGER sim_fill_apply AFTER INSERT ON sim_fills BEGIN
  UPDATE sim_accounts SET cash=MAX(0,cash + NEW.cash_delta) WHERE id=(SELECT account_id FROM sim_orders WHERE id=NEW.order_id);
  INSERT INTO sim_positions(account_id,security_id,qty,cost_krw)
    SELECT account_id,security_id,qty,-NEW.cash_delta FROM sim_orders WHERE id=NEW.order_id AND side='buy'
    ON CONFLICT(account_id,security_id) DO UPDATE SET qty=sim_positions.qty+excluded.qty,cost_krw=sim_positions.cost_krw+excluded.cost_krw;
  UPDATE sim_positions SET
    cost_krw=CASE WHEN qty <= (SELECT qty FROM sim_orders WHERE id=NEW.order_id)+0.000001 THEN 0 ELSE cost_krw*(1-(SELECT qty FROM sim_orders WHERE id=NEW.order_id)/qty) END,
    qty=MAX(0,qty-(SELECT qty FROM sim_orders WHERE id=NEW.order_id))
    WHERE (account_id,security_id)=(SELECT account_id,security_id FROM sim_orders WHERE id=NEW.order_id AND side='sell');
  UPDATE sim_orders SET status='filled',resolved_at=NEW.created_at,status_reason=NULL WHERE id=NEW.order_id;
END;
CREATE TABLE sim_snapshots (
  account_id TEXT NOT NULL REFERENCES sim_accounts(id), date TEXT NOT NULL,
  equity REAL NOT NULL, cash REAL NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(account_id,date)
);
