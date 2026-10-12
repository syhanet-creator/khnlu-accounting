// 증빙 파일 API: /api/files/{upload_url|download_url|delete}
// 파일 자체는 Azure Blob에 직접 올리고 내려받으며, 이 API는 권한을 확인하고 임시 주소만 발급한다.
const crypto = require("crypto");
const { sql, run, audit } = require("../_lib/db");
const { send, clientIp, getBody, guard, HttpError } = require("../_lib/http");
const { getSessionUser } = require("../_lib/session");
const blob = require("../_lib/blob");

const EDITORS = ["admin", "accountant"];
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

async function requireUser(req, roles) {
  const me = await getSessionUser(req);
  if (!me) throw new HttpError(401, "로그인이 필요합니다.");
  if (me.mustChangePassword) throw new HttpError(403, "먼저 비밀번호를 변경해 주세요.");
  if (!me.orgId || !roles.includes(me.role)) throw new HttpError(403, "이 작업을 할 권한이 없습니다.");
  return me;
}

// 설치 파일 정보(없으면 null). 파일 자체는 올리지 않고 속성만 읽는다.
async function installerInfo() {
  try {
    const props = await blob.installerContainer().getBlockBlobClient(blob.INSTALLER_BLOB).getProperties();
    return { version: (props.metadata && props.metadata.version) || "", size: props.contentLength, updatedAt: props.lastModified };
  } catch (e) {
    if (e && (e.statusCode === 404 || e.code === "BlobNotFound" || e.code === "ContainerNotFound")) return null;
    throw e;
  }
}

const handlers = {
  // PC 프로그램(서버판) 설치 파일 안내: 로그인한 모든 사용자가 볼 수 있다.
  async app_info(req, res) {
    if (!guard(req, res, ["GET"])) return;
    const me = await getSessionUser(req);
    if (!me) throw new HttpError(401, "로그인이 필요합니다.");
    const info = await installerInfo();
    send(res, 200, info ? { available: true, filename: blob.INSTALLER_FILENAME, ...info } : { available: false });
  },

  // 설치 파일 내려받기용 임시 주소(5분). 로그인한 사용자만.
  async app_download(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await getSessionUser(req);
    if (!me) throw new HttpError(401, "로그인이 필요합니다.");
    if (me.mustChangePassword) throw new HttpError(403, "먼저 비밀번호를 변경해 주세요.");
    const info = await installerInfo();
    if (!info) throw new HttpError(404, "설치 파일이 아직 준비되지 않았습니다. 관리자에게 문의하세요.");
    const url = blob.sasUrl(blob.INSTALLER_BLOB, "r", 5, {
      container: blob.installerContainer(),
      contentType: "application/octet-stream",
      contentDisposition: blob.dispositionFor("attachment", blob.INSTALLER_FILENAME),
    });
    await audit({ orgId: me.orgId, userId: me.id, loginId: me.loginId, action: "installer_download", target: blob.INSTALLER_BLOB, detail: `v${info.version}`, ip: clientIp(req) });
    send(res, 200, { url, filename: blob.INSTALLER_FILENAME, ...info });
  },

  // 올리기 전에: 종류·크기를 확인하고 한 파일에만 유효한 업로드 주소(10분)를 발급한다.
  async upload_url(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireUser(req, EDITORS);
    const { category, entityId, name, size } = getBody(req);
    if (!blob.CATEGORIES.includes(category)) throw new HttpError(400, "첨부 종류가 올바르지 않습니다.");
    if (!ID_RE.test(entityId || "")) throw new HttpError(400, "첨부 대상이 올바르지 않습니다.");
    const ext = blob.extOf(name);
    const type = blob.TYPES[ext];
    if (!type) throw new HttpError(400, "첨부할 수 없는 파일 형식입니다. (PDF, 사진(JPG·PNG·WEBP), 한글·워드·엑셀·파워포인트만 가능)");
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0) throw new HttpError(400, "파일 크기를 확인할 수 없습니다.");
    if (bytes > blob.MAX_BYTES) throw new HttpError(400, `파일이 너무 큽니다. (최대 ${Math.round(blob.MAX_BYTES / 1024 / 1024)}MB)`);

    const attId = "f" + crypto.randomBytes(9).toString("hex");
    const blobPath = `${me.orgId}/${category}/${entityId}/${attId}.${ext}`;
    const uploadUrl = blob.sasUrl(blobPath, "w", 10, { contentType: type.mime });
    await audit({ orgId: me.orgId, userId: me.id, loginId: me.loginId, action: "file_upload_url", target: blobPath, detail: `${String(name).slice(0, 80)} (${bytes}B)`, ip: clientIp(req) });
    send(res, 200, {
      uploadUrl,
      headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": type.mime },
      attachment: { id: attId, name: String(name).slice(0, 200), size: bytes, blob: blobPath, contentType: type.mime, addedAt: new Date().toISOString() },
    });
  },

  // 열기/내려받기: 이 조직 파일에 한해 5분짜리 읽기 주소를 발급한다(모든 역할 가능).
  async download_url(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireUser(req, ["admin", "accountant", "approver", "viewer"]);
    const { blob: blobPath, name, download } = getBody(req);
    if (!blob.isOrgBlob(me.orgId, blobPath)) throw new HttpError(403, "열 수 없는 파일입니다.");
    const type = blob.TYPES[blob.extOf(blobPath)];
    const kind = download || !type.inline ? "attachment" : "inline";
    const url = blob.sasUrl(blobPath, "r", 5, { contentType: type.mime, contentDisposition: blob.dispositionFor(kind, name || "증빙파일." + blob.extOf(blobPath)) });
    send(res, 200, { url });
  },

  // 삭제: 결재 중이거나 승인된 전표에 붙은 파일은 지울 수 없다(증빙 보존).
  async delete(req, res) {
    if (!guard(req, res, ["POST"])) return;
    const me = await requireUser(req, EDITORS);
    const { blob: blobPath } = getBody(req);
    if (!blob.isOrgBlob(me.orgId, blobPath)) throw new HttpError(403, "삭제할 수 없는 파일입니다.");
    const used = await run(
      "SELECT TOP 1 id FROM dbo.vouchers WHERE org_id = @org AND status IN ('pending','approved') AND CHARINDEX(@b, body) > 0",
      { org: [sql.Int, me.orgId], b: [sql.NVarChar(200), blobPath] }
    );
    if (used.recordset.length) throw new HttpError(409, "결재 중이거나 승인된 전표의 증빙은 삭제할 수 없습니다.");
    await blob.deleteBlob(blobPath);
    await audit({ orgId: me.orgId, userId: me.id, loginId: me.loginId, action: "file_delete", target: blobPath, ip: clientIp(req) });
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
    console.error("files error:", op, e && e.message);
    send(res, 500, { error: "서버 오류가 발생했습니다." });
  }
};
