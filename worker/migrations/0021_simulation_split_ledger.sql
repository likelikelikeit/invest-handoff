-- 분할·병합은 모의투자 원장에만 기록한다. 비율과 사후 시가·환율을 검증한 경우에만 적용한다.
CREATE TABLE sim_splits (
  id TEXT PRIMARY KEY, security_id INTEGER NOT NULL REFERENCES sim_securities(id),
  effective_at TEXT NOT NULL, market_date TEXT NOT NULL, numerator INTEGER NOT NULL CHECK(numerator>0),
  denominator INTEGER NOT NULL CHECK(denominator>0), cash_price REAL NOT NULL CHECK(cash_price>0),
  fx REAL NOT NULL CHECK(fx>0), fx_date TEXT NOT NULL, source TEXT NOT NULL, recorded_at TEXT NOT NULL,
  UNIQUE(security_id,effective_at)
);
CREATE TABLE sim_split_adjustments (
  split_id TEXT NOT NULL REFERENCES sim_splits(id), account_id TEXT NOT NULL REFERENCES sim_accounts(id),
  qty_before REAL NOT NULL, qty_after REAL NOT NULL, fractional_qty REAL NOT NULL,
  cost_before REAL NOT NULL, cost_after REAL NOT NULL, cash_krw REAL NOT NULL,
  PRIMARY KEY(split_id,account_id)
);
-- 수집 상태·평가용 지연 시세는 체결 원장과 별도로 보관한다.
CREATE TABLE sim_market_checks (
  security_id INTEGER PRIMARY KEY REFERENCES sim_securities(id), attempted_at TEXT NOT NULL,
  verified_at TEXT, status TEXT NOT NULL, detail TEXT
);
CREATE TABLE sim_intraday_quotes (
  security_id INTEGER PRIMARY KEY REFERENCES sim_securities(id), price REAL NOT NULL CHECK(price>0),
  price_at TEXT NOT NULL, fetched_at TEXT NOT NULL, source TEXT NOT NULL
);
CREATE TRIGGER sim_split_validate BEFORE INSERT ON sim_splits BEGIN
  -- 사건 이후에 체결된 거래가 있으면 과거 보유를 재구성하지 않고 운영자 확인을 요구한다.
  SELECT CASE WHEN EXISTS(SELECT 1 FROM sim_fills f JOIN sim_orders o ON o.id=f.order_id
    WHERE o.security_id=NEW.security_id AND f.date>=NEW.market_date)
    THEN RAISE(ABORT,'분할일 이후 체결 이력이 있어 확인이 필요합니다') END;
  SELECT CASE WHEN NEW.numerator>1000000 OR NEW.denominator>1000000 OR EXISTS(
    SELECT 1 FROM sim_positions WHERE security_id=NEW.security_id AND (qty<>CAST(qty AS INTEGER) OR qty>1000000000000))
    THEN RAISE(ABORT,'보유 수량 또는 분할 비율 확인이 필요합니다') END;
END;
CREATE TRIGGER sim_split_apply AFTER INSERT ON sim_splits BEGIN
  INSERT INTO sim_split_adjustments(split_id,account_id,qty_before,qty_after,fractional_qty,cost_before,cost_after,cash_krw)
    SELECT NEW.id,p.account_id,p.qty,
      (CAST(p.qty AS INTEGER)*NEW.numerator)/NEW.denominator,
      ((CAST(p.qty AS INTEGER)*NEW.numerator)%NEW.denominator)*1.0/NEW.denominator,
      p.cost_krw,
      CASE WHEN p.qty=0 THEN 0 ELSE p.cost_krw*((CAST(p.qty AS INTEGER)*NEW.numerator)/NEW.denominator)/(p.qty*NEW.numerator/NEW.denominator) END,
      (((CAST(p.qty AS INTEGER)*NEW.numerator)%NEW.denominator)*1.0/NEW.denominator)*NEW.cash_price*NEW.fx
    FROM sim_positions p JOIN sim_accounts a ON a.id=p.account_id JOIN sim_contests c ON c.id=a.contest_id
    WHERE p.security_id=NEW.security_id AND p.qty>0 AND c.status='active';
  UPDATE sim_accounts SET cash=cash+(SELECT cash_krw FROM sim_split_adjustments WHERE split_id=NEW.id AND account_id=sim_accounts.id)
    WHERE id IN (SELECT account_id FROM sim_split_adjustments WHERE split_id=NEW.id);
  UPDATE sim_positions SET
    qty=(SELECT qty_after FROM sim_split_adjustments WHERE split_id=NEW.id AND account_id=sim_positions.account_id),
    cost_krw=(SELECT cost_after FROM sim_split_adjustments WHERE split_id=NEW.id AND account_id=sim_positions.account_id)
    WHERE security_id=NEW.security_id AND account_id IN (SELECT account_id FROM sim_split_adjustments WHERE split_id=NEW.id);
  UPDATE sim_orders SET status='cancelled',status_reason='분할·병합으로 주문 취소',resolved_at=NEW.recorded_at
    WHERE security_id=NEW.security_id AND status='pending' AND created_at<NEW.effective_at AND account_id IN
      (SELECT a.id FROM sim_accounts a JOIN sim_contests c ON c.id=a.contest_id WHERE c.status='active');
END;
