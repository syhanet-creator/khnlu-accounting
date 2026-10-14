// 관리 API: 조직(시스템관리자) / 계정 발급·수정·초기화(시스템관리자는 조직 관리자만, 조직 관리자는 자기 조직 전체)
// /api/admin/{orgs|org_create|org_toggle|users|user_create|user_update|user_reset}
const { sql, run, audit } = require("../_lib/db");
const { send, clientIp, getBody, guard } = require("../_lib/http");
const { hashPassword, generateTempPassword } = require("../_lib/password");
const { getSessionUser } = require("../_lib/session");

const APPROVAL_PRESETS = {
  central: ["담당국장", "총무국장", "사무처장", "수석부위원장", "중앙위원장"],
  headquarters: ["사무장", "부위원장", "본부위원장"],
  branch: ["사무장", "부위원장", "지부위원장"],
};
const ORG_ROLES = ["admin", "accountant", "approver", "viewer"]; // 조직 안에서 부여할 수 있는 역할
const LOGIN_ID_RE = /^[A-Za-z0-9._-]{3,50}$/;

const isStr = (v, min, max) => typeof v === "string" && v.trim().length >= min && v.length <= max;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function isUniqueViolation(e) {
  return !!e && e.code === "23505";   // PostgreSQL unique_violation
}

function currentFyKst() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth() + 1;
  return m >= 4 ? y : y - 1;
}

async function requireActor(req, roles) {
  const me = await getSessionUser(req);
  if (!me) throw new HttpError(401, "로그인이 필요합니다.");
  if (me.mustChangePassword) throw new HttpError(403, "먼저 비밀번호를 변경해 주세요.");
  if (!roles.includes(me.role)) throw new HttpError(403, "이 작업을 할 권한이 없습니다.");
  return me;
}

// 작업 대상 조직: 조직 관리자는 항상 본인 조직, 시스템관리자는 요청의 orgId(존재하는 조직이어야 함)
async function resolveOrg(me, raw) {
  let orgId;
  if (me.role === "admin") {
    orgId = me.orgId;
  } else {
    orgId = Number(raw);
    if (!Number.isInteger(orgId) || orgId <= 0) throw new HttpError(400, "조직을 선택해 주세요.");
  }
  const r = await run("SELECT id, name, org_type, approval_steps, is_active FROM dbo.organizations WHERE id = @id", { id: [sql.Int, orgId] });
  const org = r.recordset[0];
  if (!org) throw new HttpError(404, "조직을 찾을 수 없습니다.");
  let steps = [];
  try { steps = JSON.parse(org.approval_steps); } catch (e) {}
  return { id: org.id, name: org.name, orgType: org.org_type, isActive: !!org.is_active, steps };
}

// 이 관리자가 대상 사용자를 다룰 수 있는지(없으면 예외). 반환: 사용자 행
async function loadTarget(me, org, id) {
  const uid = Number(id);
  if (!Number.isInteger(uid)) throw new HttpError(400, "대상 계정이 올바르지 않습니다.");
  const r = await run("SELECT id, org_id, login_id, display_name, role, approval_step, is_active FROM dbo.users WHERE id = @id AND org_id = @org", { id: [sql.Int, uid], org: [sql.Int, org.id] });
  const t = r.recordset[0];
  if (!t) throw new HttpError(404, "계정을 찾을 수 없습니다.");
  if (me.role === "super" && t.role !== "admin") throw new HttpError(403, "시스템관리자는 조직 관리자 계정만 다룰 수 있습니다.");
  if (t.role === "super") throw new HttpError(403, "이 계정은 변경할 수 없습니다.");
  return t;
}

function validateRoleAndStep(role, approvalStep, org) {
  if (!ORG_ROLES.includes(role)) throw new HttpError(400, "역할이 올바르지 않습니다.");
  if (role === "approver") {
    if (!org.steps.includes(approvalStep)) throw new HttpError(400, "결재자는 결재선의 단계를 선택해야 합니다.");
    return approvalStep;
  }
  return null;
}

const userView = r => ({
  id: r.id, loginId: r.login_id, displayName: r.display_name, role: r.role, approvalStep: r.approval_step,
  isActive: !!r.is_active, locked: !!r.locked, lastLoginAt: r.last_login_at, createdAt: r.created_at,
});

const handlers = {
  // ----- 조직 (시스템관리자) -----
  async orgs(req, res) {
    if (!guard(req, res, ["GET"])) return;
    await requireActor(req, ["super"]);
    const r = await run(
      `SELECT o.id, o.name, o.org_type, o.is_active, o.created_at,
              (SELECT COUNT(*) FROM dbo.users u WHERE u.org_id = o.id AND u.is_active) AS active_users
       FROM dbo.organizations o ORDER BY o.id`
    );
    send(res, 200, { orgs: r.recordset.map(o => ({ id: o.id, name: o.name, orgType: o.org_type, isActive: !!o.is_active, createdAt: o.created_at, activeUsers: o.active_users })) });
  },

  // 조직과 첫 조직 관리자 계정을 한 번에 만든다(한 트랜잭션). 임시 비밀번호는 이 응답에서만 한 번 보여준다.
  async org_create(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireActor(req, ["super"]);
    const { name, orgType, adminLoginId, adminDisplayName } = getBody(req);
    if (!isStr(name, 1, 100)) throw new HttpError(400, "조직 이름을 입력해 주세요.");
    if (!APPROVAL_PRESETS[orgType]) throw new HttpError(400, "조직 유형을 선택해 주세요.");
    if (!isStr(adminLoginId, 3, 50) || !LOGIN_ID_RE.test(adminLoginId)) throw new HttpError(400, "관리자 아이디는 영문·숫자·. _ - 3~50자로 입력해 주세요.");
    if (!isStr(adminDisplayName, 1, 50)) throw new HttpError(400, "관리자 이름을 입력해 주세요.");

    const tempPassword = generateTempPassword(adminLoginId);
    const hash = await hashPassword(tempPassword);
    let orgId;
    try {
      const r = await run(
        `WITH o AS (
           INSERT INTO dbo.organizations (name, org_type, approval_steps, current_fy) VALUES (@name, @type, @steps, @fy) RETURNING id
         )
         INSERT INTO dbo.users (org_id, login_id, display_name, password_hash, role, must_change_password, created_by)
           SELECT o.id, @l::varchar, @d::varchar, @h::varchar, 'admin', true, @by FROM o
           RETURNING org_id AS id`,
        {
          name: [sql.NVarChar(100), name.trim()], type: [sql.VarChar(20), orgType],
          steps: [sql.NVarChar(sql.MAX), JSON.stringify(APPROVAL_PRESETS[orgType])], fy: [sql.Int, currentFyKst()],
          l: [sql.NVarChar(50), adminLoginId], d: [sql.NVarChar(50), adminDisplayName.trim()], h: [sql.VarChar(200), hash], by: [sql.Int, me.id],
        }
      );
      orgId = r.recordset[0].id;
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new HttpError(409, /organizations/.test(e.message) ? "같은 이름의 조직이 이미 있습니다." : "이미 사용 중인 아이디입니다.");
      }
      throw e;
    }
    await audit({ orgId, userId: me.id, loginId: me.loginId, action: "org_create", target: name.trim(), detail: `admin=${adminLoginId}`, ip: clientIp(req) });
    send(res, 200, { orgId, adminLoginId, tempPassword });
  },

  async org_toggle(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireActor(req, ["super"]);
    const { orgId, isActive } = getBody(req);
    const org = await resolveOrg(me, orgId);
    if (typeof isActive !== "boolean") throw new HttpError(400, "상태 값이 올바르지 않습니다.");
    await run("UPDATE dbo.organizations SET is_active = @a WHERE id = @id", { a: [sql.Bit, isActive], id: [sql.Int, org.id] });
    if (!isActive) await run("DELETE FROM dbo.sessions WHERE user_id IN (SELECT id FROM dbo.users WHERE org_id = @id)", { id: [sql.Int, org.id] });
    await audit({ orgId: org.id, userId: me.id, loginId: me.loginId, action: isActive ? "org_activate" : "org_deactivate", target: org.name, ip: clientIp(req) });
    send(res, 200, { ok: true });
  },

  // ----- 계정 (시스템관리자: 조직 관리자만 / 조직 관리자: 자기 조직 전체) -----
  async users(req, res) {
    if (!guard(req, res, ["GET"])) return;
    const me = await requireActor(req, ["super", "admin"]);
    const org = await resolveOrg(me, req.query && req.query.orgId);
    const r = await run(
      `SELECT id, login_id, display_name, role, approval_step, is_active, last_login_at, created_at,
              (locked_until IS NOT NULL AND locked_until > now()) AS locked
       FROM dbo.users WHERE org_id = @org ${me.role === "super" ? "AND role = 'admin'" : ""} ORDER BY id`,
      { org: [sql.Int, org.id] }
    );
    send(res, 200, { org: { id: org.id, name: org.name, orgType: org.orgType, approvalSteps: org.steps }, users: r.recordset.map(userView) });
  },

  async user_create(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireActor(req, ["super", "admin"]);
    const body = getBody(req);
    const org = await resolveOrg(me, body.orgId);
    if (!org.isActive) throw new HttpError(409, "비활성 조직에는 계정을 만들 수 없습니다.");
    const { loginId, displayName } = body;
    if (!isStr(loginId, 3, 50) || !LOGIN_ID_RE.test(loginId)) throw new HttpError(400, "아이디는 영문·숫자·. _ - 3~50자로 입력해 주세요.");
    if (!isStr(displayName, 1, 50)) throw new HttpError(400, "이름을 입력해 주세요.");
    const role = me.role === "super" ? "admin" : body.role;
    const step = validateRoleAndStep(role, body.approvalStep, org);

    const tempPassword = generateTempPassword(loginId);
    const hash = await hashPassword(tempPassword);
    try {
      await run(
        `INSERT INTO dbo.users (org_id, login_id, display_name, password_hash, role, approval_step, must_change_password, created_by)
         VALUES (@org, @l, @d, @h, @role, @step, @mcp, @by)`,
        { org: [sql.Int, org.id], l: [sql.NVarChar(50), loginId], d: [sql.NVarChar(50), displayName.trim()], h: [sql.VarChar(200), hash], role: [sql.VarChar(20), role], step: [sql.NVarChar(50), step], mcp: [sql.Bit, role !== "viewer"], by: [sql.Int, me.id] }
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, "이미 사용 중인 아이디입니다.");
      throw e;
    }
    await audit({ orgId: org.id, userId: me.id, loginId: me.loginId, action: "user_create", target: loginId, detail: `role=${role}${step ? ", step=" + step : ""}`, ip: clientIp(req) });
    send(res, 200, { loginId, tempPassword, passwordFixed: role === "viewer" });
  },

  async user_update(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireActor(req, ["super", "admin"]);
    const body = getBody(req);
    const org = await resolveOrg(me, body.orgId);
    const t = await loadTarget(me, org, body.id);
    const isSelf = t.id === me.id;

    const displayName = body.displayName === undefined ? t.display_name : body.displayName;
    if (!isStr(displayName, 1, 50)) throw new HttpError(400, "이름을 입력해 주세요.");

    let role = t.role, step = t.approval_step, active = !!t.is_active;
    if (body.role !== undefined && body.role !== t.role) {
      if (isSelf) throw new HttpError(403, "본인의 역할은 바꿀 수 없습니다.");
      if (me.role === "super") throw new HttpError(403, "시스템관리자는 조직 관리자 역할을 바꿀 수 없습니다.");
      role = body.role;
    }
    if (body.role !== undefined || body.approvalStep !== undefined) {
      step = validateRoleAndStep(role, body.approvalStep !== undefined ? body.approvalStep : t.approval_step, org);
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") throw new HttpError(400, "상태 값이 올바르지 않습니다.");
      if (isSelf && !body.isActive) throw new HttpError(403, "본인 계정은 비활성화할 수 없습니다.");
      active = body.isActive;
    }

    await run(
      // 조회전용 -> 다른 역할이면(관리자가 비밀번호를 알고 있으므로) 다음 로그인 때 본인이 바꾸게 하고, 다른 역할 -> 조회전용이면 강제 변경을 끈다.
      "UPDATE dbo.users SET display_name = @d, role = @role, approval_step = @step, is_active = @a, must_change_password = CASE WHEN @role = 'viewer' THEN false WHEN @prev = 'viewer' THEN true ELSE must_change_password END WHERE id = @id AND org_id = @org",
      { d: [sql.NVarChar(50), displayName.trim()], role: [sql.VarChar(20), role], prev: [sql.VarChar(20), t.role], step: [sql.NVarChar(50), step], a: [sql.Bit, active], id: [sql.Int, t.id], org: [sql.Int, org.id] }
    );
    // 역할/활성 상태가 바뀌면 기존 로그인 세션을 끊어 새 권한이 즉시 적용되게 한다.
    if (role !== t.role || active !== !!t.is_active || step !== t.approval_step) {
      await run("DELETE FROM dbo.sessions WHERE user_id = @id", { id: [sql.Int, t.id] });
    }
    await audit({ orgId: org.id, userId: me.id, loginId: me.loginId, action: "user_update", target: t.login_id, detail: `role=${role}, step=${step || ""}, active=${active}`, ip: clientIp(req) });
    send(res, 200, { ok: true });
  },

  // 비밀번호 초기화: 새 임시 비밀번호 발급 + 잠금 해제 + 기존 로그인 모두 종료 + 다음 로그인 때 변경 강제
  async user_reset(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireActor(req, ["super", "admin"]);
    const body = getBody(req);
    const org = await resolveOrg(me, body.orgId);
    const t = await loadTarget(me, org, body.id);
    if (t.id === me.id) throw new HttpError(403, "본인 비밀번호는 [비밀번호 변경]에서 바꿔 주세요.");
    const tempPassword = generateTempPassword(t.login_id);
    const hash = await hashPassword(tempPassword);
    await run(
      "UPDATE dbo.users SET password_hash = @h, must_change_password = @mcp, failed_attempts = 0, locked_until = NULL WHERE id = @id AND org_id = @org",
      { h: [sql.VarChar(200), hash], mcp: [sql.Bit, t.role !== "viewer"], id: [sql.Int, t.id], org: [sql.Int, org.id] }
    );
    await run("DELETE FROM dbo.sessions WHERE user_id = @id", { id: [sql.Int, t.id] });
    await audit({ orgId: org.id, userId: me.id, loginId: me.loginId, action: "user_reset", target: t.login_id, ip: clientIp(req) });
    send(res, 200, { loginId: t.login_id, tempPassword, passwordFixed: t.role === "viewer" });
  },
};

module.exports = async (req, res) => {
  const op = req.query && req.query.op;
  const handler = Object.prototype.hasOwnProperty.call(handlers, op) ? handlers[op] : null;
  if (!handler) return send(res, 404, { error: "not found" });
  try {
    await handler(req, res);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    if (e && e.code === "DB_WAKING") return send(res, 503, { error: "데이터베이스를 깨우는 중입니다. 잠시 후 자동으로 다시 시도합니다.", code: "db_waking" });
    console.error("admin error:", op, e && e.message);
    send(res, 500, { error: "서버 오류가 발생했습니다." });
  }
};
