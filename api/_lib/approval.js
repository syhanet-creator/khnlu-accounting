// 결재선 선택(직상신/생략)과 대결 규칙. 서버가 모든 판단을 한다.
const { sql } = require("./db");
const { HttpError } = require("./http");

const DEFAULT_LINE_NAME = "정식 결재선";

// 한국 시간 기준 오늘(YYYY-MM-DD)
function todayKst() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }

// 이 전표의 결재 단계(순서). 전표에 지정된 결재선이 있으면 그 단계, 없으면(예전 전표) 조직 전체 결재선.
// 어떤 경우에도 조직 결재선의 마지막 단계(최종 결재자)가 빠진 결재선은 인정하지 않는다.
function lineStepsOf(body, orgSteps) {
  const line = body && body.approvalLine;
  if (line && Array.isArray(line.steps)) {
    const steps = line.steps.filter(s => orgSteps.includes(s));
    if (steps.length && steps[steps.length - 1] === orgSteps[orgSteps.length - 1]) return steps;
  }
  return orgSteps.slice();
}

// 관리자가 등록하는 결재선 검증: 조직 결재선의 부분 순서, 중복 없음, 최종 결재자 포함. 문제가 있으면 안내 문구, 없으면 null.
function validateLineSteps(orgSteps, steps) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > orgSteps.length) return "결재 단계를 선택해 주세요.";
  let last = -1;
  for (const s of steps) {
    const i = orgSteps.indexOf(s);
    if (typeof s !== "string" || i < 0) return "이 조직의 결재선에 없는 단계가 있습니다.";
    if (i <= last) return "결재 단계는 조직 결재선의 순서를 지켜야 합니다.";
    last = i;
  }
  if (steps[steps.length - 1] !== orgSteps[orgSteps.length - 1]) return `최종 결재자(${orgSteps[orgSteps.length - 1]})는 모든 결재선에 반드시 포함되어야 합니다.`;
  if (steps.length === orgSteps.length) return "정식 결재선과 같은 결재선은 따로 만들 필요가 없습니다.";
  return null;
}

// 상신할 때 고른 결재선 확인. lineId: "default"/없음 = 정식 결재선, 숫자 = 이 조직의 사용 중인 결재선.
async function resolveLine(q, orgId, orgSteps, lineId) {
  if (lineId === undefined || lineId === null || lineId === "" || lineId === "default") return { id: "default", name: DEFAULT_LINE_NAME, steps: orgSteps.slice() };
  const n = Number(lineId);
  if (!Number.isInteger(n)) throw new HttpError(400, "결재선이 올바르지 않습니다.");
  const r = await q("SELECT id, name, steps FROM dbo.approval_lines WHERE id = @id AND org_id = @org AND is_active = 1", { id: [sql.Int, n], org: [sql.Int, orgId] });
  const row = r.recordset[0];
  if (!row) throw new HttpError(400, "선택한 결재선을 사용할 수 없습니다. 새로고침 후 다시 선택해 주세요.");
  let steps = [];
  try { steps = JSON.parse(row.steps); } catch (e) {}
  const problem = validateLineSteps(orgSteps, steps);
  if (problem && !/정식 결재선과 같은/.test(problem)) throw new HttpError(400, "선택한 결재선이 현재 결재선 구성과 맞지 않습니다. 관리자에게 문의하세요.");
  return { id: String(row.id), name: row.name, steps };
}

// 오늘 이 사용자가 이 단계를 대결할 수 있으면 부재자(원 결재자) 사용자 id, 아니면 null
async function activeDelegation(q, orgId, step, userId) {
  const r = await q(
    `SELECT TOP 1 absent_user_id FROM dbo.approval_delegations
     WHERE org_id = @org AND step_name = @s AND delegate_user_id = @u AND is_active = 1
       AND CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Korea Standard Time' AS DATE) BETWEEN from_date AND to_date`,
    { org: [sql.Int, orgId], s: [sql.NVarChar(50), step], u: [sql.Int, userId] }
  );
  return r.recordset[0] ? r.recordset[0].absent_user_id : null;
}

// 이 사용자가 이 단계를 결재할 수 있는지: 본인 단계이거나 대결 기간 중인 대결자. { ok, actingFor }
async function canActOnStep(q, me, orgId, step) {
  if (me.approvalStep === step) return { ok: true, actingFor: null };
  const absent = await activeDelegation(q, orgId, step, me.id);
  return absent ? { ok: true, actingFor: absent } : { ok: false, actingFor: null };
}

module.exports = { DEFAULT_LINE_NAME, todayKst, lineStepsOf, validateLineSteps, resolveLine, activeDelegation, canActOnStep };
