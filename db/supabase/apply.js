// Supabase 스키마 적용 + 앱 전용 계정(app_user) 준비. 관리자 접속 정보(PG_ADMIN_*)는 .env.local 에서 읽는다.
// 사용: node db/supabase/apply.js            (스키마·권한 적용, 여러 번 실행해도 안전)
// app_user 비밀번호는 최초 1회 자동 생성되어 .env.local(PG_PASSWORD)에만 저장된다(화면에 출력하지 않음).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const envPath = path.join(__dirname, "..", "..", ".env.local");
function loadEnv() {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) process.env[line.slice(0, i).replace(/^﻿/, "")] = line.slice(i + 1);
  }
}
loadEnv();

function ref() {
  const m = /^postgres\.([a-z0-9]+)$/.exec(process.env.PG_ADMIN_USER || "");
  if (!m) throw new Error("PG_ADMIN_USER 는 postgres.<프로젝트ID> 형식이어야 합니다.");
  return m[1];
}

(async () => {
  const c = new Client({
    host: process.env.PG_HOST, port: +process.env.PG_PORT, database: process.env.PG_DATABASE,
    user: process.env.PG_ADMIN_USER, password: process.env.PG_ADMIN_PASSWORD,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
  });
  await c.connect();
  try {
    if (process.argv.includes("--reset")) { await c.query("DROP SCHEMA IF EXISTS dbo CASCADE"); console.log("dbo schema dropped (--reset)"); }
    await c.query(fs.readFileSync(path.join(__dirname, "schema.pg.sql"), "utf8"));
    console.log("schema applied");

    // 앱 전용 역할: 한 번만 만들고, 비밀번호는 .env.local 에만 저장한다.
    const exists = (await c.query("SELECT 1 FROM pg_roles WHERE rolname = 'app_user'")).rowCount > 0;
    let pw = null;
    if (!exists) {
      pw = crypto.randomBytes(24).toString("base64url");
      await c.query(`CREATE ROLE app_user LOGIN PASSWORD '${pw}' NOINHERIT`);   // 비밀번호는 base64url 문자만이라 따옴표 문제 없음
      let raw = fs.readFileSync(envPath, "utf8").replace(/(?:^|\r?\n)(PG_USER|PG_PASSWORD)=[^\r\n]*/g, "");
      raw = raw.replace(/\s*$/, "\n") + `PG_USER=app_user.${ref()}\nPG_PASSWORD=${pw}\n`;
      fs.writeFileSync(envPath, raw);
      console.log("app_user created; PG_USER/PG_PASSWORD saved to .env.local (value not shown)");
    } else console.log("app_user already exists");

    await c.query(`
      GRANT USAGE ON SCHEMA dbo TO app_user;
      REVOKE ALL ON SCHEMA dbo FROM anon, authenticated;
      REVOKE ALL ON ALL TABLES IN SCHEMA dbo FROM anon, authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA dbo TO app_user;
      REVOKE UPDATE, DELETE, TRUNCATE ON dbo.audit_log FROM app_user;     -- 감사 로그는 추가·조회만
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA dbo TO app_user;
    `);
    // RLS 정책: app_user 에게만 허용(감사 로그는 조회·추가만)
    const tables = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname = 'dbo'")).rows.map(r => r.tablename);
    for (const t of tables) {
      await c.query(`DROP POLICY IF EXISTS app_all ON dbo.${t}; DROP POLICY IF EXISTS app_read ON dbo.${t}; DROP POLICY IF EXISTS app_insert ON dbo.${t};`);
      if (t === "audit_log") {
        await c.query(`CREATE POLICY app_read ON dbo.audit_log FOR SELECT TO app_user USING (true);
                       CREATE POLICY app_insert ON dbo.audit_log FOR INSERT TO app_user WITH CHECK (true);`);
      } else {
        await c.query(`CREATE POLICY app_all ON dbo.${t} FOR ALL TO app_user USING (true) WITH CHECK (true);`);
      }
    }
    console.log("grants + RLS policies applied on", tables.length, "tables");
    const r = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'dbo' ORDER BY 1");
    console.log("tables:", r.rows.map(x => x.table_name).join(", "));
  } finally {
    await c.end();
  }
})().catch(e => { console.error("FAILED:", String(e.message).replace(process.env.PG_ADMIN_PASSWORD || "§§", "***")); process.exit(1); });
