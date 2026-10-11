// Azure SQL 연결. 모든 쿼리는 매개변수화(@name)로만 실행한다 — 문자열을 이어붙여 SQL을 만들지 않는다.
const sql = require("mssql");

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    const { SQL_SERVER, SQL_DATABASE, SQL_USER, SQL_PASSWORD } = process.env;
    if (!SQL_SERVER || !SQL_DATABASE || !SQL_USER || !SQL_PASSWORD) {
      throw new Error("SQL_* 환경변수가 설정되지 않았습니다.");
    }
    poolPromise = new sql.ConnectionPool({
      server: SQL_SERVER,
      database: SQL_DATABASE,
      user: SQL_USER,
      password: SQL_PASSWORD,
      port: 1433,
      options: { encrypt: true, trustServerCertificate: false },
      connectionTimeout: 20000,
      requestTimeout: 20000,
      pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
    }).connect().catch(e => { poolPromise = null; throw e; });
  }
  return poolPromise;
}

// 무료 서버리스 DB가 일시중지에서 깨어나는 동안 나는 일시적 오류인지 판별한다.
const TRANSIENT_NUMBERS = new Set([40613, 40197, 40501, 49918, 49919, 49920, 10928, 10929, 40544, 40549, 40550, 4060]);
function isTransient(e) {
  if (!e) return false;
  const num = e.number || (e.originalError && e.originalError.number) || (e.originalError && e.originalError.info && e.originalError.info.number);
  if (num && TRANSIENT_NUMBERS.has(num)) return true;
  if (["ETIMEOUT", "ESOCKET", "ECONNCLOSED", "ECONNRESET"].includes(e.code)) return true;
  return /not currently available|resuming|timeout|ECONN/i.test(String((e && e.message) || ""));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// run("SELECT ... WHERE id=@id", { id: [sql.Int, 5] })
async function run(text, params = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const pool = await getPool();
      const req = pool.request();
      for (const [name, [type, value]] of Object.entries(params)) req.input(name, type, value);
      return await req.query(text);
    } catch (e) {
      lastErr = e;
      if (!isTransient(e)) throw e;
      poolPromise = null;
      if (attempt === 0) await sleep(3000);
    }
  }
  const err = new Error("database is waking up");
  err.code = "DB_WAKING";
  err.cause = lastErr;
  throw err;
}

// 여러 문장을 한 트랜잭션으로 실행한다. fn(q) 안에서 q("SQL", {param: [type, value]})로 쿼리하고, 예외가 나면 전부 되돌린다.
async function tx(fn) {
  await run("SELECT 1 AS ok"); // 일시중지된 DB를 먼저 깨운다(재시도 포함)
  const pool = await getPool();
  const t = new sql.Transaction(pool);
  await t.begin();
  const q = (text, params = {}) => {
    const req = new sql.Request(t);
    for (const [name, [type, value]] of Object.entries(params)) req.input(name, type, value);
    return req.query(text);
  };
  try {
    const out = await fn(q);
    await t.commit();
    return out;
  } catch (e) {
    try { await t.rollback(); } catch (_) {}
    throw e;
  }
}

async function audit({ orgId = null, userId = null, loginId = null, action, target = null, detail = null, ip = null }) {
  try {
    await run(
      "INSERT INTO dbo.audit_log (org_id, user_id, login_id, action, target, detail, ip) VALUES (@org, @uid, @lid, @act, @tgt, @det, @ip)",
      {
        org: [sql.Int, orgId], uid: [sql.Int, userId],
        lid: [sql.NVarChar(50), loginId ? String(loginId).slice(0, 50) : null],
        act: [sql.VarChar(40), action],
        tgt: [sql.NVarChar(100), target ? String(target).slice(0, 100) : null],
        det: [sql.NVarChar(sql.MAX), detail],
        ip: [sql.VarChar(45), ip],
      }
    );
  } catch (e) {
    // 감사로그 실패가 본 요청을 막지는 않지만, 서버 로그에는 남긴다.
    console.error("audit failed:", e && e.message);
  }
}

module.exports = { sql, run, tx, audit };
