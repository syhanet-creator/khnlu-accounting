// 그룹웨어 연동 API: /api/gw/{status|docs}
const { send, guard } = require("../_lib/http");
const { getSessionUser } = require("../_lib/session");
const gw = require("../_lib/gw");
const { getBody } = require("../_lib/http");

const handlers = {
  // 연동 여부와 그룹웨어 주소
  async status(req, res) {
    if (!guard(req, res, ["GET"])) return;
    const me = await getSessionUser(req);
    if (!me || !me.orgId) return send(res, 401, { error: "로그인이 필요합니다." });
    send(res, 200, { linked: await gw.linked(me.orgId), gwUrl: gw.GW_URL });
  },
  // 연결 가능한 문서(내 조직의 결재 완료 문서) 검색
  async docs(req, res) {
    if (!guard(req, res, ["GET"])) return;
    const me = await getSessionUser(req);
    if (!me || !me.orgId) return send(res, 401, { error: "로그인이 필요합니다." });
    send(res, 200, { docs: await gw.listDocs(me.orgId, req.query && req.query.q), gwUrl: gw.GW_URL });
  },
  // 증빙 포함 PDF 용 연결 문서 묶음(본문·결재 이력·첨부 임시 주소)
  async package(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await getSessionUser(req);
    if (!me || !me.orgId) return send(res, 401, { error: "로그인이 필요합니다." });
    const b = getBody(req) || {};
    send(res, 200, { docs: await gw.packageDocs(me.orgId, b.ids) });
  },
};

module.exports = async (req, res) => {
  const op = req.query && req.query.op;
  const handler = Object.prototype.hasOwnProperty.call(handlers, op) ? handlers[op] : null;
  if (!handler) return send(res, 404, { error: "not found" });
  try {
    await handler(req, res);
  } catch (e) {
    if (e && e.status) return send(res, e.status, { error: e.message });
    if (e && e.code === "DB_WAKING") return send(res, 503, { error: "데이터베이스를 깨우는 중입니다. 잠시 후 다시 시도해 주세요.", code: "db_waking" });
    console.error("gw error:", op, e && e.message);
    send(res, 500, { error: "서버 오류가 발생했습니다." });
  }
};
