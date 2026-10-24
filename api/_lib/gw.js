// 그룹웨어(한수원노조 그룹웨어) 문서 연동. 같은 Supabase DB 의 public.gw_* 테이블을 읽는다(읽기 전용).
// 조직 연결(dbo.gw_org_link): 회계 조직 ↔ 그룹웨어 조직. 중앙이면 중앙(과 그 위원회), 본부/지부이면 해당 본부·지부의 문서만 연결할 수 있다.
// 연결 가능한 문서: 결재가 끝난 것(approved)·시행(sent) 문서 중 비공개가 아닌 것.
const { sql, run } = require("./db");
const { HttpError } = require("./http");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GW_URL = (process.env.GW_URL || "https://khnlu-groupware.vercel.app").replace(/\/$/, "");

const ORG_SCOPE = `d.org_id IN (
    SELECT l.gw_org_id FROM dbo.gw_org_link l WHERE l.acct_org_id = @org
    UNION SELECT c.id FROM dbo.gw_org_link l JOIN public.gw_orgs c ON c.parent_id = l.gw_org_id AND c.level = 'committee' WHERE l.acct_org_id = @org)`;
const COLS = `d.id, d.doc_no, d.title, d.status, d.kind, d.created_at, d.completed_at, o.name AS org_name, m.display_name AS author_name`;
const FROM = `FROM public.gw_documents d JOIN public.gw_orgs o ON o.id = d.org_id LEFT JOIN public.gw_members m ON m.user_id = d.author_id`;
const OK = `d.status IN ('approved','sent') AND NOT d.confidential`;

function wrap(e) {
  if (e && (e.code === "42P01" || e.code === "42501")) return new HttpError(503, "그룹웨어 연동이 아직 설정되지 않았습니다. 관리자에게 문의하세요.");
  return e;
}
const view = r => ({
  id: r.id, docNo: r.doc_no || "", title: r.title || "", status: r.status, orgName: r.org_name || "", author: r.author_name || "",
  date: new Date(r.completed_at || r.created_at).toISOString().slice(0, 10),
});

async function linked(orgId) {
  try {
    const r = await run("SELECT 1 AS x FROM dbo.gw_org_link WHERE acct_org_id = @org", { org: [sql.Int, orgId] });
    return r.recordset.length > 0;
  } catch (e) { return false; }
}

async function listDocs(orgId, q) {
  const like = "%" + String(q || "").trim().slice(0, 60).replace(/[\\%_]/g, c => "\\" + c) + "%";
  try {
    const r = await run(
      `SELECT ${COLS} ${FROM} WHERE ${ORG_SCOPE} AND ${OK} AND (d.title ILIKE @q OR coalesce(d.doc_no,'') ILIKE @q)
       ORDER BY coalesce(d.completed_at, d.created_at) DESC LIMIT 100`,
      { org: [sql.Int, orgId], q: [sql.NVarChar(80), like] });
    return r.recordset.map(view);
  } catch (e) { throw wrap(e); }
}

// 저장할 연결 목록을 서버가 다시 확인한다: 이 조직에서 연결할 수 있는 문서만 남기고 번호·제목은 DB 값으로 채운다.
async function verifyDocs(orgId, input, keep) {
  if (!Array.isArray(input) || !input.length) return [];
  const ids = [...new Set(input.map(x => x && x.id).filter(id => typeof id === "string" && UUID_RE.test(id)))].slice(0, 10);
  const out = [];
  for (const id of ids) {
    try {
      const r = await run(`SELECT ${COLS} ${FROM} WHERE d.id = @id::uuid AND ${ORG_SCOPE} AND ${OK}`, { id: [sql.NVarChar(40), id], org: [sql.Int, orgId] });
      if (r.recordset[0]) out.push(view(r.recordset[0]));
      else if (keep && keep.some(k => k.id === id)) out.push(keep.find(k => k.id === id));   // 이미 저장돼 있던 연결은 유지
    } catch (e) { throw wrap(e); }
  }
  return out;
}

module.exports = { GW_URL, linked, listDocs, verifyDocs };
