// 테스트용 D1 흉내: node:sqlite 위에 prepare().bind().run/all/first 와 batch()만.
// 실제 마이그레이션 SQL과 쿼리를 진짜 SQLite로 돌려본다.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const migDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

class Stmt {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Stmt(this.db, this.sql, args);
  }
  // node:sqlite는 ?1 같은 번호 파라미터를 위치 배열로 받는다
  _p() {
    return this.args.map((a) => (a === undefined ? null : a));
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this._p());
    return { success: true, meta: { changes: Number(r.changes) } };
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this._p()).map((o) => ({ ...o })) };
  }
  async first() {
    const r = this.db.prepare(this.sql).get(...this._p());
    return r ? { ...r } : null;
  }
  _exec() {
    const st = this.db.prepare(this.sql);
    if (/^\s*(select|with)|returning/i.test(this.sql)) return { results: st.all(...this._p()).map((o) => ({ ...o })) };
    const r = st.run(...this._p());
    return { results: [], meta: { changes: Number(r.changes) } };
  }
}

export function makeDb() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(migDir).filter((x) => x.endsWith(".sql")).sort()) db.exec(readFileSync(join(migDir, f), "utf8"));
  return {
    raw: db,
    prepare: (sql) => new Stmt(db, sql),
    batch: async (stmts) => {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => s._exec());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
