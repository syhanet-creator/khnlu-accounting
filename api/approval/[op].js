// 결재 설정 API: /api/approval/{lines|line_save|line_delete|people|delegations|delegation_save|delegation_cancel|my_signature|signature_save|signature_delete|signature}
// - 결재선(직상신 등 허용 결재선): 조직 관리자만 등록. 마지막 결재자는 항상 포함되어야 한다.
// - 서명: 결재자가 자기 서명 이미지(PNG)를 올리면 결재 승인 때 그 칸에 기록된다. 이미지는 같은 조직 사용자만 볼 수 있다.
// - 대결: 조직 관리자는 모든 결재자, 결재자 본인은 자기 단계에 대해서만 부재 기간과 대결자를 지정한다.
const { sql, run, audit } = require("../_lib/db");
const { send, clientIp, getBody, guard, HttpError } = require("../_lib/http");
const { getSessionUser } = require("../_lib/session");
const { validateLineSteps, DEFAULT_LINE_NAME, todayKst } = require("../_lib/approval");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 10;
const MAX_ACTIVE_DELEGATIONS = 50;
const MAX_DELEGATION_DAYS = 120;
const str = (x, max) => (typeof x === "string" ? x.slice(0, max) : "");
const parseJson = (s, f) => { try { return JSON.parse(s); } catch (e) { return f; } };
const isUnique = e => { const n = e && (e.number || (e.originalError && e.originalError.number)); return n === 2627 || n === 2601; };

async function requireUser(req, roles) {
  const me = await getSessionUser(req);
  if (!me) throw new HttpError(401, "로그인이 필요합니다.");
  if (me.mustChangePassword) throw new HttpError(403, "먼저 비밀번호를 변경해 주세요.");
  if (!me.orgId || !roles.includes(me.role)) throw new HttpError(403, "이 작업을 할 권한이 없습니다.");
  return me;
}

const lineView = r => ({ id: String(r.id), name: r.name, steps: parseJson(r.steps, []), isActive: !!r.is_active });
const delegationView = r => ({
  id: r.id, step: r.step_name, absentUserId: r.absent_user_id, absentName: r.absent_name, delegateUserId: r.delegate_user_id, delegateName: r.delegate_name,
  from: new Date(r.from_date).toISOString().slice(0, 10),
  to: new Date(r.to_date).toISOString().slice(0, 10), note: r.note || "", createdByName: r.created_name || "",
});

// ── 서명 이미지: 화면에서 PNG로 줄여 보내며, 서버는 형식·크기를 다시 검사한다.
const SIG_MAX_BYTES = 150 * 1024;
const SIG_MAX_W = 800, SIG_MAX_H = 400, SIG_MIN = 20;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function parsePng(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === "string" ? dataUrl : "");
  if (!m) throw new HttpError(400, "PNG 이미지가 아닙니다. 다른 파일로 시도해 주세요.");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > SIG_MAX_BYTES) throw new HttpError(400, "서명 이미지가 너무 큽니다. (150KB 이하)");
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_MAGIC) || buf.toString("latin1", 12, 16) !== "IHDR") throw new HttpError(400, "PNG 이미지가 아닙니다. 다른 파일로 시도해 주세요.");
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  if (width < SIG_MIN || height < SIG_MIN || width > SIG_MAX_W || height > SIG_MAX_H) throw new HttpError(400, `서명 이미지 크기가 올바르지 않습니다. (${SIG_MIN}~${SIG_MAX_W} x ${SIG_MIN}~${SIG_MAX_H}px)`);
  return { buf, width, height };
}
// 결재 기록에 쓰이지 않은 이전 서명은 지운다(개인정보 최소 보관).
async function dropUnusedSignature(orgId, userId, keepId) {
  await run(
    `DELETE s FROM dbo.user_signatures s WHERE s.org_id = @org AND s.user_id = @u AND (@keep IS NULL OR s.id <> @keep)
       AND NOT EXISTS (SELECT 1 FROM dbo.voucher_approvals a WHERE a.signature_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM dbo.users x WHERE x.signature_id = s.id)`,
    { org: [sql.Int, orgId], u: [sql.Int, userId], keep: [sql.Int, keepId] });
}

const handlers = {
  // 내 현재 서명(결재자)
  async my_signature(req, res) {
    if (!guard(req, res, ["GET"])) return;
    const me = await requireUser(req, ["approver"]);
    const r = await run("SELECT s.id, s.width, s.height, s.created_at FROM dbo.users u JOIN dbo.user_signatures s ON s.id = u.signature_id WHERE u.id = @me AND u.org_id = @org", { me: [sql.Int, me.id], org: [sql.Int, me.orgId] });
    const x = r.recordset[0];
    send(res, 200, { signature: x ? { id: x.id, width: x.width, height: x.height, updatedAt: x.created_at } : null });
  },

  // 서명 등록/교체: 결재자 본인만. 이후 승인하는 결재부터 새 서명이 기록된다(이미 승인된 칸은 그대로).
  async signature_save(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireUser(req, ["approver"]);
    const { buf, width, height } = parsePng(getBody(req).image);
    const ins = await run("INSERT INTO dbo.user_signatures (org_id, user_id, mime, data, width, height) OUTPUT inserted.id VALUES (@org, @u, 'image/png', @d, @w, @h)",
      { org: [sql.Int, me.orgId], u: [sql.Int, me.id], d: [sql.VarBinary(sql.MAX), buf], w: [sql.Int, width], h: [sql.Int, height] });
    const id = ins.recordset[0].id;
    await run("UPDATE dbo.users SET signature_id = @id WHERE id = @u AND org_id = @org", { id: [sql.Int, id], u: [sql.Int, me.id], org: [sql.Int, me.orgId] });
    await dropUnusedSignature(me.orgId, me.id, id);
    await audit({ orgId: me.orgId, userId: me.id, loginId: me.loginId, action: "signature_save", target: String(id), ip: clientIp(req) });
    send(res, 200, { signature: { id, width, height } });
  },

  async signature_delete(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireUser(req, ["approver"]);
    await run("UPDATE dbo.users SET signature_id = NULL WHERE id = @u AND org_id = @org", { u: [sql.Int, me.id], org: [sql.Int, me.orgId] });
    await dropUnusedSignature(me.orgId, me.id, null);
    await audit({ orgId: me.orgId, userId: me.id, loginId: me.loginId, action: "signature_delete", ip: clientIp(req) });
    send(res, 200, { ok: true });
  },

  // 서명 이미지 내려받기(<img src>용): 같은 조직 사용자 중, 본인 서명이거나 결재 기록에 쓰인 서명만.
  async signature(req, res) {
    if (!guard(req, res, ["GET"])) return;
    const me = await requireUser(req, ["admin", "accountant", "approver", "viewer"]);
    const id = Number(req.query && req.query.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "서명이 올바르지 않습니다.");
    const r = await run(
      `SELECT s.mime, s.data FROM dbo.user_signatures s
       WHERE s.id = @id AND s.org_id = @org
         AND (s.user_id = @me OR EXISTS (SELECT 1 FROM dbo.voucher_approvals a WHERE a.signature_id = s.id AND a.org_id = @org))`,
      { id: [sql.Int, id], org: [sql.Int, me.orgId], me: [sql.Int, me.id] });
    const x = r.recordset[0];
    if (!x) throw new HttpError(404, "서명을 찾을 수 없습니다.");
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(x.data.length));
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(x.data);
  },

  // 결재선 목록(관리자): 정식 결재선은 항상 있고, 여기에는 등록한 것만 나온다.
  async lines(req, res) {
    if (!guard(req, res, ["GET"])) return;
    const me = await requireUser(req, ["admin"]);
    const r = await run("SELECT id, name, steps, is_active FROM dbo.approval_lines WHERE org_id = @org ORDER BY id", { org: [sql.Int, me.orgId] });
    send(res, 200, { orgSteps: me.org.approvalSteps, defaultName: DEFAULT_LINE_NAME, lines: r.recordset.map(lineView) });
  },

  async line_save(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireUser(req, ["admin"]);
    const { id, name, steps, isActive } = getBody(req);
    const nm = str(name, 40).trim();
    if (!nm) throw new HttpError(400, "결재선 이름을 입력해 주세요.");
    if (nm === DEFAULT_LINE_NAME || nm === "default") throw new HttpError(400, "이 이름은 사용할 수 없습니다.");
    const problem = validateLineSteps(me.org.approvalSteps, steps);
    if (problem) throw new HttpError(400, problem);
    const active = isActive === undefined ? true : !!isActive;
    try {
      if (id !== undefined && id !== null) {
        const n = Number(id);
        if (!Number.isInteger(n)) throw new HttpError(400, "결재선이 올바르지 않습니다.");
        const u = await run("UPDATE dbo.approval_lines SET name = @n, steps = @s, is_active = @a WHERE id = @id AND org_id = @org", { n: [sql.NVarChar(40), nm], s: [sql.NVarChar(sql.MAX), JSON.stringify(steps)], a: [sql.Bit, active], id: [sql.Int, n], org: [sql.Int, me.orgId] });
        if (!u.rowsAffected[0]) throw new HttpError(404, "결재선을 찾을 수 없습니다.");
      } else {
        const c = (await run("SELECT COUNT(*) AS n FROM dbo.approval_lines WHERE org_id = @org", { org: [sql.Int, me.orgId] })).recordset[0].n;
        if (c >= MAX_LINES) throw new HttpError(409, `결재선은 최대 ${MAX_LINES}개까지 등록할 수 있습니다.`);
        await run("INSERT INTO dbo.approval_lines (org_id, name, steps, is_active, created_by) VALUES (@org, @n, @s, @a, @by)", { org: [sql.Int, me.orgId], n: [sql.NVarChar(40), nm], s: [sql.NVarChar(sql.MAX), JSON.stringify(steps)], a: [sql.Bit, active], by: [sql.Int, me.id] });
      }
    } catch (e) {
      if (isUnique(e)) throw new HttpError(409, "같은 이름의 결재선이 이미 있습니다.");
      throw e;
    }
    await audit({ orgId: me.orgId, userId: me.id, loginId: me.loginId, action: "approval_line_save", target: nm, detail: steps.join(">"), ip: clientIp(req) });
    send(res, 200, { ok: true });
  },

  // 삭제해도 이미 상신된 전표에는 상신 당시의 결재선이 그대로 남아 영향이 없다.
  async line_delete(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireUser(req, ["admin"]);
    const n = Number(getBody(req).id);
    if (!Number.isInteger(n)) throw new HttpError(400, "결재선이 올바르지 않습니다.");
    const u = await run("DELETE FROM dbo.approval_lines WHERE id = @id AND org_id = @org", { id: [sql.Int, n], org: [sql.Int, me.orgId] });
    if (!u.rowsAffected[0]) throw new HttpError(404, "결재선을 찾을 수 없습니다.");
    await audit({ orgId: me.orgId, userId: me.id, loginId: me.loginId, action: "approval_line_delete", target: String(n), ip: clientIp(req) });
    send(res, 200, { ok: true });
  },

  // 결재자 명단(대결 지정용): 관리자는 전체, 결재자는 자기 조직의 결재자
  async people(req, res) {
    if (!guard(req, res, ["GET"])) return;
    const me = await requireUser(req, ["admin", "approver"]);
    const r = await run("SELECT id, display_name, approval_step FROM dbo.users WHERE org_id = @org AND role = 'approver' AND is_active = 1 ORDER BY id", { org: [sql.Int, me.orgId] });
    send(res, 200, { orgSteps: me.org.approvalSteps, approvers: r.recordset.map(u => ({ id: u.id, displayName: u.display_name, step: u.approval_step })) });
  },

  async delegations(req, res) {
    if (!guard(req, res, ["GET"])) return;
    const me = await requireUser(req, ["admin", "approver"]);
    const scope = me.role === "admin" ? "" : "AND (d.absent_user_id = @me OR d.delegate_user_id = @me)";
    const r = await run(
      `SELECT d.id, d.step_name, d.absent_user_id, ua.display_name AS absent_name, d.delegate_user_id, ud.display_name AS delegate_name,
              d.from_date, d.to_date, d.note, uc.display_name AS created_name
       FROM dbo.approval_delegations d
       JOIN dbo.users ua ON ua.id = d.absent_user_id JOIN dbo.users ud ON ud.id = d.delegate_user_id LEFT JOIN dbo.users uc ON uc.id = d.created_by
       WHERE d.org_id = @org AND d.is_active = 1 AND d.to_date >= DATEADD(day, -30, CAST(@today AS DATE)) ${scope}
       ORDER BY d.from_date DESC, d.id DESC`,
      { org: [sql.Int, me.orgId], me: [sql.Int, me.id], today: [sql.VarChar(10), todayKst()] }
    );
    send(res, 200, { today: todayKst(), delegations: r.recordset.map(delegationView) });
  },

  async delegation_save(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireUser(req, ["admin", "approver"]);
    const { step, absentUserId, delegateUserId, from, to, note } = getBody(req);
    const steps = me.org.approvalSteps;
    if (!steps.includes(step)) throw new HttpError(400, "결재 단계를 선택해 주세요.");
    const absent = me.role === "approver" ? me.id : Number(absentUserId);
    const delegate = Number(delegateUserId);
    if (!Number.isInteger(absent) || !Number.isInteger(delegate)) throw new HttpError(400, "부재자와 대결자를 선택해 주세요.");
    if (absent === delegate) throw new HttpError(400, "본인에게 대결을 맡길 수 없습니다.");
    if (!DATE_RE.test(from || "") || !DATE_RE.test(to || "") || isNaN(new Date(from)) || isNaN(new Date(to))) throw new HttpError(400, "부재 기간을 입력해 주세요.");
    if (to < from) throw new HttpError(400, "종료일이 시작일보다 빠를 수 없습니다.");
    if ((new Date(to) - new Date(from)) / 86400000 > MAX_DELEGATION_DAYS) throw new HttpError(400, `대결 기간은 최대 ${MAX_DELEGATION_DAYS}일까지 지정할 수 있습니다.`);
    if (to < todayKst()) throw new HttpError(400, "이미 지난 기간입니다.");
    const users = (await run("SELECT id, display_name, approval_step FROM dbo.users WHERE org_id = @org AND role = 'approver' AND is_active = 1 AND id IN (@a, @d)", { org: [sql.Int, me.orgId], a: [sql.Int, absent], d: [sql.Int, delegate] })).recordset;
    const ua = users.find(u => u.id === absent), ud = users.find(u => u.id === delegate);
    if (!ua || ua.approval_step !== step) throw new HttpError(400, `부재자는 [${step}] 단계의 결재자여야 합니다.`);
    if (!ud) throw new HttpError(400, "대결자는 같은 조직의 사용 중인 결재자여야 합니다.");
    const c = (await run("SELECT COUNT(*) AS n FROM dbo.approval_delegations WHERE org_id = @org AND is_active = 1 AND to_date >= CAST(@t AS DATE)", { org: [sql.Int, me.orgId], t: [sql.VarChar(10), todayKst()] })).recordset[0].n;
    if (c >= MAX_ACTIVE_DELEGATIONS) throw new HttpError(409, "진행 중인 대결 설정이 너무 많습니다. 끝난 설정을 정리해 주세요.");
    await run(
      `INSERT INTO dbo.approval_delegations (org_id, step_name, absent_user_id, delegate_user_id, from_date, to_date, note, created_by)
       VALUES (@org, @s, @a, @d, CAST(@f AS DATE), CAST(@t AS DATE), @n, @by)`,
      { org: [sql.Int, me.orgId], s: [sql.NVarChar(50), step], a: [sql.Int, absent], d: [sql.Int, delegate], f: [sql.VarChar(10), from], t: [sql.VarChar(10), to], n: [sql.NVarChar(100), str(note, 100).trim() || null], by: [sql.Int, me.id] }
    );
    await audit({ orgId: me.orgId, userId: me.id, loginId: me.loginId, action: "delegation_save", target: step, detail: `${ua.display_name} → ${ud.display_name}, ${from}~${to}`, ip: clientIp(req) });
    send(res, 200, { ok: true });
  },

  // 대결 취소: 조직 관리자 또는 부재자 본인
  async delegation_cancel(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireUser(req, ["admin", "approver"]);
    const n = Number(getBody(req).id);
    if (!Number.isInteger(n)) throw new HttpError(400, "대결 설정이 올바르지 않습니다.");
    const scope = me.role === "admin" ? "" : "AND absent_user_id = @me";
    const u = await run(`UPDATE dbo.approval_delegations SET is_active = 0 WHERE id = @id AND org_id = @org AND is_active = 1 ${scope}`, { id: [sql.Int, n], org: [sql.Int, me.orgId], me: [sql.Int, me.id] });
    if (!u.rowsAffected[0]) throw new HttpError(404, "대결 설정을 찾을 수 없거나 취소할 권한이 없습니다.");
    await audit({ orgId: me.orgId, userId: me.id, loginId: me.loginId, action: "delegation_cancel", target: String(n), ip: clientIp(req) });
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
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    if (e && e.code === "DB_WAKING") return send(res, 503, { error: "데이터베이스를 깨우는 중입니다. 잠시 후 자동으로 다시 시도합니다.", code: "db_waking" });
    console.error("approval error:", op, e && e.message);
    send(res, 500, { error: "서버 오류가 발생했습니다." });
  }
};
