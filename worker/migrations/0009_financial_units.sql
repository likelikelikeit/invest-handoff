-- 밸류에이션 보정: 재무 원천 통화와 ADR 단위를 명시하고, 상장 통화로 환산된 행만 계산에 쓴다.
ALTER TABLE securities ADD COLUMN financial_currency TEXT;
ALTER TABLE securities ADD COLUMN adr_ratio REAL;
ALTER TABLE securities ADD COLUMN financial_to_listing_rate REAL;
ALTER TABLE securities ADD COLUMN financial_rate_as_of TEXT;

ALTER TABLE financials ADD COLUMN currency TEXT;
ALTER TABLE financials ADD COLUMN source_currency TEXT;
ALTER TABLE financials ADD COLUMN adr_ratio REAL;
ALTER TABLE financials ADD COLUMN fx_rate REAL;

UPDATE securities SET financial_currency = currency WHERE financial_currency IS NULL;

UPDATE financials
SET currency = (SELECT s.currency FROM securities s WHERE s.id = financials.security_id),
    source_currency = (SELECT s.currency FROM securities s WHERE s.id = financials.security_id),
    adr_ratio = 1,
    fx_rate = 1;

-- Yahoo의 TSM aggregate 금액은 TWD, EPS·BPS·희석주식 수는 이미 ADR-equivalent 단위다.
-- 거래 가격은 USD ADR 기준이며 1 ADR = 보통주 5주(비율은 단위 검증용, 숫자에 다시 곱하지 않는다).
UPDATE securities
SET financial_currency = 'TWD', adr_ratio = 5
WHERE UPPER(ticker) = 'TSM' OR UPPER(ysym) = 'TSM';

-- Novo Nordisk ADR은 DKK 원천, USD 상장이고 1 ADR = 보통주 1주다.
UPDATE securities
SET financial_currency = 'DKK', adr_ratio = 1
WHERE UPPER(ticker) = 'NVO' OR UPPER(ysym) = 'NVO';

-- 기존 TSM 숫자는 환산 전이다. 다음 Yahoo 갱신 전까지 USD 값으로 오인하지 않는다.
UPDATE financials
SET currency = NULL, source_currency = 'TWD', adr_ratio = 5, fx_rate = NULL
WHERE security_id IN (
  SELECT id FROM securities WHERE UPPER(ticker) = 'TSM' OR UPPER(ysym) = 'TSM'
);

UPDATE financials
SET currency = NULL, source_currency = 'DKK', adr_ratio = 1, fx_rate = NULL
WHERE security_id IN (
  SELECT id FROM securities WHERE UPPER(ticker) = 'NVO' OR UPPER(ysym) = 'NVO'
);
