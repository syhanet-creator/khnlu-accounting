// Supabase(PostgreSQL) 연결. 모든 쿼리는 매개변수화(@name → $n)로만 실행한다 — 문자열을 이어붙여 SQL을 만들지 않는다.
// run("SELECT ... WHERE id=@id", { id: [sql.Int, 5] }) 형태(예전 mssql 과 같은 모양)를 그대로 유지한다.
const { Pool, types } = require("pg");

// 결과 값 형식을 예전과 맞춘다: COUNT 등 bigint 는 숫자로, DATE 는 UTC 자정의 Date 로(mssql 과 같게).
types.setTypeParser(20, v => parseInt(v, 10));
types.setTypeParser(1700, v => parseFloat(v));
types.setTypeParser(1082, v => new Date(v + "T00:00:00Z"));

// 매개변수 타입 토큰. 모든 매개변수를 명시적으로 캐스트해 Postgres 가 타입을 추측하지 않게 한다(문자열은 text).
const sql = {
  Int: { cast: "integer", coerce: v => v },
  BigInt: { cast: "bigint", coerce: v => v },
  Bit: { cast: "boolean", coerce: v => !!v },
  VarChar: () => ({ cast: "text", coerce: v => v }),
  NVarChar: () => ({ cast: "text", coerce: v => v }),
  Char: () => ({ cast: "text", coerce: v => v }),
  VarBinary: () => ({ cast: "bytea", coerce: v => v }),
  Timestamp: { cast: "timestamptz", coerce: v => v },
  MAX: "max",
};

let pool = null;

function getPool() {
  if (!pool) {
    const { PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD } = process.env;
    if (!PG_HOST || !PG_DATABASE || !PG_USER || !PG_PASSWORD) {
      throw new Error("PG_* 환경변수가 설정되지 않았습니다.");
    }
    pool = new Pool({
      host: PG_HOST,
      port: Number(PG_PORT) || 6543,            // Supabase 트랜잭션 풀러
      database: PG_DATABASE,
      user: PG_USER,
      password: PG_PASSWORD,
      ssl: { rejectUnauthorized: false },       // Supabase 풀러는 TLS 필수
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
      statement_timeout: 20000,
    });
    pool.on("error", e => console.error("pg pool error:", e && e.message));
  }
  return pool;
}

// 프로젝트가 일시중지에서 깨어나는 동안/연결이 끊겼을 때 나는 일시적 오류인지 판별한다.
const TRANSIENT_CODES = new Set(["57P03", "53300", "08000", "08001", "08003", "08004", "08006", "57P01", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"]);
function isTransient(e) {
  if (!e) return false;
  if (TRANSIENT_CODES.has(e.code)) return true;
  return /timeout|terminated|ECONN|starting up|paus|too many connections/i.test(String((e && e.message) || ""));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// "@name" 을 "$n" 으로 바꾸고 값 배열을 만든다. 같은 이름은 같은 번호를 쓴다.
function compile(text, params) {
  const names = [], casts = [], values = [];
  const out = text.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (m, name) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) throw new Error(`쿼리 매개변수 @${name} 값이 없습니다.`);
    let i = names.indexOf(name);
    if (i < 0) {
      const [type, value] = params[name];
      names.push(name);
      casts.push(type.cast);
      values.push(value === undefined || value === null ? null : type.coerce(value));
      i = names.length - 1;
    }
    return `$${i + 1}${casts[i] ? "::" + casts[i] : ""}`;
  });
  return { text: out, values };
}

function shape(res) {
  return { recordset: res.rows, rowsAffected: [res.rowCount] };
}

async function run(text, params = {}) {
  const q = compile(text, params);
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return shape(await getPool().query(q.text, q.values));
    } catch (e) {
      lastErr = e;
      if (!isTransient(e)) throw e;
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
  const client = await getPool().connect();
  const q = async (text, params = {}) => {
    const c = compile(text, params);
    return shape(await client.query(c.text, c.values));
  };
  try {
    await client.query("BEGIN");
    const out = await fn(q);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw e;
  } finally {
    client.release();
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
