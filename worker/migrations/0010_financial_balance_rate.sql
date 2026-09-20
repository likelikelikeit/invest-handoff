-- 손익·EPS는 분기 평균환율, BPS·순부채는 분기말 환율을 쓴다.
-- financials.fx_rate는 분기 평균환율이고, 이 컬럼은 분기말 환율이다.
ALTER TABLE financials ADD COLUMN balance_fx_rate REAL;
UPDATE financials SET balance_fx_rate = fx_rate;
