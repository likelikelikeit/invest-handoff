-- 0014: 테마·섹터·매크로 투자 메모 (SPEC §5.9).
-- 종목 투자의견(views)과 일부러 다른 물건이다. 목표가·기간·등급이 없고 기계가 채점하지 않는다.
-- 적중률에도 들어가지 않는다. 회고는 연결 종목의 이후 수익률을 '사실'로만 보여준다.

CREATE TABLE notes (
  id          INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL,                    -- 기록 시점 (소급 가능)
  backdated   INTEGER NOT NULL DEFAULT 0,       -- 과거 날짜로 넣은 것
  title       TEXT NOT NULL,
  body        TEXT,                             -- 자유 본문 (문단·불릿 규칙은 의견과 같다)
  tags        TEXT,                             -- JSON 배열. 고정 분류를 만들지 않고 쓰면서 쌓는다
  stance      TEXT,                             -- positive | neutral | negative | NULL
  edited_at   TEXT
);
CREATE INDEX idx_notes_time ON notes(created_at DESC);

-- 관련 종목 연결. 종목 상세의 '관련 메모'와 이후 수익률 계산에 쓴다.
CREATE TABLE note_securities (
  note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  security_id INTEGER NOT NULL REFERENCES securities(id),
  PRIMARY KEY (note_id, security_id)
);
CREATE INDEX idx_note_sec ON note_securities(security_id);
