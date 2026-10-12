// 로그인 세션. 브라우저에는 무작위 토큰(HttpOnly 쿠키)만, DB에는 SHA-256 해시만 둔다.
const crypto = require("crypto");
const { sql, run } = require("./db");
const { parseCookies, clientIp } = require("./http");

const COOKIE = "khnp_session";
const SESSION_HOURS = 8;

const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");

function cookieHeader(token, maxAgeSec) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}

async function createSession(res, userId, req) {
  const token = crypto.randomBytes(32).toString("hex");
  await run(
    "INSERT INTO dbo.sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES (@h, @uid, DATEADD(hour, @hrs, SYSUTCDATETIME()), @ip, @ua)",
    {
      h: [sql.Char(64), sha256(token)], uid: [sql.Int, userId], hrs: [sql.Int, SESSION_HOURS],
      ip: [sql.VarChar(45), clientIp(req)],
      ua: [sql.NVarChar(200), String(req.headers["user-agent"] || "").slice(0, 200)],
    }
  );
  res.setHeader("Set-Cookie", cookieHeader(token, SESSION_HOURS * 3600));
}

function currentTokenHash(req) {
  const token = parseCookies(req)[COOKIE];
  return token && /^[0-9a-f]{64}$/.test(token) ? sha256(token) : null;
}

const USER_COLUMNS = `u.id, u.org_id, u.login_id, u.display_name, u.role, u.approval_step, u.must_change_password,
  o.name AS org_name, o.org_type, o.approval_steps, o.current_fy`;

function toUserView(row) {
  if (!row) return null;
  let steps = [];
  try { steps = row.approval_steps ? JSON.parse(row.approval_steps) : []; } catch (e) {}
  return {
    id: row.id,
    orgId: row.org_id,
    loginId: row.login_id,
    displayName: row.display_name,
    role: row.role,
    approvalStep: row.approval_step,
    mustChangePassword: !!row.must_change_password && row.role !== "viewer",
    org: row.org_id ? { id: row.org_id, name: row.org_name, orgType: row.org_type, approvalSteps: steps, currentFy: row.current_fy } : null,
  };
}

async function loadUserById(userId) {
  const r = await run(
    `SELECT ${USER_COLUMNS} FROM dbo.users u LEFT JOIN dbo.organizations o ON o.id = u.org_id WHERE u.id = @id`,
    { id: [sql.Int, userId] }
  );
  return toUserView(r.recordset[0]);
}

// 로그인한 사용자(없거나 만료/비활성이면 null)
async function getSessionUser(req) {
  const hash = currentTokenHash(req);
  if (!hash) return null;
  const r = await run(
    `SELECT ${USER_COLUMNS}
     FROM dbo.sessions s
     JOIN dbo.users u ON u.id = s.user_id
     LEFT JOIN dbo.organizations o ON o.id = u.org_id
     WHERE s.token_hash = @h AND s.expires_at > SYSUTCDATETIME()
       AND u.is_active = 1 AND (u.org_id IS NULL OR o.is_active = 1)`,
    { h: [sql.Char(64), hash] }
  );
  return toUserView(r.recordset[0]);
}

async function destroySession(res, req) {
  const hash = currentTokenHash(req);
  if (hash) await run("DELETE FROM dbo.sessions WHERE token_hash = @h", { h: [sql.Char(64), hash] });
  res.setHeader("Set-Cookie", cookieHeader("", 0));
}

module.exports = { createSession, getSessionUser, destroySession, loadUserById, currentTokenHash, sha256 };
