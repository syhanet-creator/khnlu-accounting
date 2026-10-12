// 인증 API: /api/auth/{status|login|logout|me|password|bootstrap}
const crypto = require("crypto");
const { sql, run, audit } = require("../_lib/db");
const { send, clientIp, getBody, guard } = require("../_lib/http");
const { hashPassword, verifyPassword, dummyVerify, passwordPolicyError } = require("../_lib/password");
const { createSession, getSessionUser, destroySession, loadUserById, currentTokenHash } = require("../_lib/session");

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const IP_FAIL_LIMIT = 20; // 같은 IP에서 10분 안에 실패 20회 초과 시 차단
const BAD_LOGIN = "아이디 또는 비밀번호가 올바르지 않습니다.";

const isStr = (v, min, max) => typeof v === "string" && v.length >= min && v.length <= max;

function sameSecret(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function ipTooManyFails(ip) {
  if (!ip) return false;
  const r = await run(
    "SELECT COUNT(*) AS n FROM dbo.audit_log WHERE ip = @ip AND action IN ('login_fail','bootstrap_fail') AND at > DATEADD(minute, -10, SYSUTCDATETIME())",
    { ip: [sql.VarChar(45), ip] }
  );
  return r.recordset[0].n >= IP_FAIL_LIMIT;
}

async function userCount() {
  const r = await run("SELECT COUNT(*) AS n FROM dbo.users");
  return r.recordset[0].n;
}

const handlers = {
  // 최초 설정(첫 시스템관리자 만들기)이 필요한지
  async status(req, res) {
    if (!guard(req, res, ["GET"])) return;
    const needsBootstrap = !!process.env.BOOTSTRAP_TOKEN && (await userCount()) === 0;
    send(res, 200, { needsBootstrap });
  },

  async login(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const { loginId, password } = getBody(req);
    if (!isStr(loginId, 1, 50) || !isStr(password, 1, 128)) return send(res, 400, { error: BAD_LOGIN });
    const ip = clientIp(req);

    if (await ipTooManyFails(ip)) {
      return send(res, 429, { error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요." });
    }

    const r = await run(
      `SELECT TOP 1 u.id, u.org_id, u.login_id, u.password_hash,
              CASE WHEN u.is_active = 1 AND (u.org_id IS NULL OR o.is_active = 1) THEN 1 ELSE 0 END AS is_active,
              CASE WHEN u.locked_until IS NOT NULL AND u.locked_until > SYSUTCDATETIME() THEN 1 ELSE 0 END AS locked
       FROM dbo.users u LEFT JOIN dbo.organizations o ON o.id = u.org_id WHERE u.login_id = @l`,
      { l: [sql.NVarChar(50), loginId.trim()] }
    );
    const user = r.recordset[0];

    if (!user) {
      await dummyVerify(password);
      await audit({ loginId, action: "login_fail", detail: "unknown user", ip });
      return send(res, 401, { error: BAD_LOGIN });
    }
    if (user.locked) {
      await audit({ orgId: user.org_id, userId: user.id, loginId: user.login_id, action: "login_locked", ip });
      return send(res, 423, { error: `로그인 시도 횟수를 초과해 계정이 잠겼습니다. ${LOCK_MINUTES}분 뒤에 다시 시도하거나 관리자에게 문의하세요.` });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok || !user.is_active) {
      // UPDATE의 우변은 모두 갱신 전 값을 쓰므로 아래 계산이 맞다.
      await run(
        `UPDATE dbo.users SET
           locked_until = CASE WHEN failed_attempts + 1 >= @max THEN DATEADD(minute, @mins, SYSUTCDATETIME()) ELSE locked_until END,
           failed_attempts = CASE WHEN failed_attempts + 1 >= @max THEN 0 ELSE failed_attempts + 1 END
         WHERE id = @id`,
        { id: [sql.Int, user.id], max: [sql.Int, MAX_FAILS], mins: [sql.Int, LOCK_MINUTES] }
      );
      await audit({ orgId: user.org_id, userId: user.id, loginId: user.login_id, action: "login_fail", detail: user.is_active ? "bad password" : "inactive", ip });
      return send(res, 401, { error: BAD_LOGIN });
    }

    await run("UPDATE dbo.users SET failed_attempts = 0, locked_until = NULL, last_login_at = SYSUTCDATETIME() WHERE id = @id", { id: [sql.Int, user.id] });
    await run("DELETE FROM dbo.sessions WHERE user_id = @id AND expires_at < SYSUTCDATETIME()", { id: [sql.Int, user.id] });
    await createSession(res, user.id, req);
    await audit({ orgId: user.org_id, userId: user.id, loginId: user.login_id, action: "login", ip });
    send(res, 200, { user: await loadUserById(user.id) });
  },

  async logout(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await getSessionUser(req);
    await destroySession(res, req);
    if (me) await audit({ orgId: me.orgId, userId: me.id, loginId: me.loginId, action: "logout", ip: clientIp(req) });
    send(res, 200, { ok: true });
  },

  async me(req, res) {
    if (!guard(req, res, ["GET"])) return;
    const me = await getSessionUser(req);
    if (!me) return send(res, 401, { error: "로그인이 필요합니다." });
    send(res, 200, { user: me });
  },

  async password(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await getSessionUser(req);
    if (!me) return send(res, 401, { error: "로그인이 필요합니다." });
    if (me.role === "viewer") return send(res, 403, { error: "조회전용 계정의 비밀번호는 조직 관리자만 바꿀 수 있습니다. 조직 관리자에게 초기화를 요청해 주세요." });
    const { currentPassword, newPassword } = getBody(req);
    if (!isStr(currentPassword, 1, 128)) return send(res, 400, { error: "현재 비밀번호를 입력해 주세요." });

    const r = await run("SELECT password_hash FROM dbo.users WHERE id = @id", { id: [sql.Int, me.id] });
    if (!(await verifyPassword(currentPassword, r.recordset[0].password_hash))) {
      await audit({ orgId: me.orgId, userId: me.id, loginId: me.loginId, action: "password_change_fail", ip: clientIp(req) });
      return send(res, 400, { error: "현재 비밀번호가 올바르지 않습니다." });
    }
    const policy = passwordPolicyError(newPassword, me.loginId);
    if (policy) return send(res, 400, { error: policy });
    if (newPassword === currentPassword) return send(res, 400, { error: "새 비밀번호는 현재 비밀번호와 달라야 합니다." });

    const hash = await hashPassword(newPassword);
    await run("UPDATE dbo.users SET password_hash = @h, must_change_password = 0 WHERE id = @id", { h: [sql.VarChar(200), hash], id: [sql.Int, me.id] });
    // 이 세션을 제외한 다른 로그인은 모두 끊는다.
    await run("DELETE FROM dbo.sessions WHERE user_id = @id AND token_hash <> @h", { id: [sql.Int, me.id], h: [sql.Char(64), currentTokenHash(req)] });
    await audit({ orgId: me.orgId, userId: me.id, loginId: me.loginId, action: "password_change", ip: clientIp(req) });
    send(res, 200, { user: await loadUserById(me.id) });
  },

  // 최초 1회: 서버 환경변수의 BOOTSTRAP_TOKEN을 아는 사람이 첫 시스템관리자(super)를 만든다. 사용자가 1명이라도 있으면 영구 차단.
  async bootstrap(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const expected = process.env.BOOTSTRAP_TOKEN;
    if (!expected) return send(res, 404, { error: "not found" });
    const ip = clientIp(req);
    if (await ipTooManyFails(ip)) return send(res, 429, { error: "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요." });

    const { token, loginId, displayName, password } = getBody(req);
    if (!isStr(token, 1, 200) || !sameSecret(token, expected)) {
      await audit({ action: "bootstrap_fail", ip });
      return send(res, 403, { error: "설정 토큰이 올바르지 않습니다." });
    }
    if (!isStr(loginId, 3, 50) || !/^[A-Za-z0-9._-]+$/.test(loginId)) return send(res, 400, { error: "아이디는 영문·숫자·. _ - 3~50자로 입력해 주세요." });
    if (!isStr(displayName, 1, 50)) return send(res, 400, { error: "이름을 입력해 주세요." });
    const policy = passwordPolicyError(password, loginId);
    if (policy) return send(res, 400, { error: policy });

    const hash = await hashPassword(password);
    const ins = await run(
      `INSERT INTO dbo.users (login_id, display_name, password_hash, role, must_change_password)
       SELECT @l, @d, @h, 'super', 0 WHERE NOT EXISTS (SELECT 1 FROM dbo.users)`,
      { l: [sql.NVarChar(50), loginId], d: [sql.NVarChar(50), displayName.trim()], h: [sql.VarChar(200), hash] }
    );
    if (!ins.rowsAffected[0]) return send(res, 409, { error: "이미 초기 설정이 완료되었습니다." });
    await audit({ loginId, action: "bootstrap", ip });
    send(res, 200, { ok: true });
  },
};

module.exports = async (req, res) => {
  const op = req.query && req.query.op;
  const handler = Object.prototype.hasOwnProperty.call(handlers, op) ? handlers[op] : null;
  if (!handler) return send(res, 404, { error: "not found" });
  try {
    await handler(req, res);
  } catch (e) {
    if (e && e.code === "DB_WAKING") {
      return send(res, 503, { error: "데이터베이스를 깨우는 중입니다. 잠시 후 자동으로 다시 시도합니다.", code: "db_waking" });
    }
    console.error("auth error:", op, e && e.message);
    send(res, 500, { error: "서버 오류가 발생했습니다." });
  }
};
