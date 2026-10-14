// 증빙 파일 저장소(Supabase Storage). 버킷은 비공개이며, 서버가 로그인·권한을 확인한 뒤 짧은 시간만 유효한
// 임시 주소(서명 URL)를 발급한다. 브라우저/앱은 그 주소로 저장소에 직접 올리고 내려받는다(Vercel 요청 크기 제한을 피함).
// 서버 키(SUPABASE_SERVICE_KEY)는 서버에서만 쓰며 브라우저에는 절대 보내지 않는다.
const { HttpError } = require("./http");

// 확장자 → 서버가 정하는 콘텐츠 형식(클라이언트가 보낸 형식은 믿지 않는다). 실행 가능한 형식(html, svg, js 등)은 허용하지 않는다.
const TYPES = {
  pdf: { mime: "application/pdf", inline: true },
  jpg: { mime: "image/jpeg", inline: true },
  jpeg: { mime: "image/jpeg", inline: true },
  png: { mime: "image/png", inline: true },
  webp: { mime: "image/webp", inline: true },
  heic: { mime: "image/heic", inline: false },
  hwp: { mime: "application/x-hwp", inline: false },
  hwpx: { mime: "application/vnd.hancom.hwpx", inline: false },
  doc: { mime: "application/msword", inline: false },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false },
  xls: { mime: "application/vnd.ms-excel", inline: false },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false },
  ppt: { mime: "application/vnd.ms-powerpoint", inline: false },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", inline: false },
};
const MAX_BYTES = 20 * 1024 * 1024;
const CATEGORIES = ["voucher", "contract"];
const BLOB_RE = /^(\d{1,9})\/(voucher|contract)\/([A-Za-z0-9_-]{1,40})\/([A-Za-z0-9_-]{1,40})\.([a-z0-9]{2,5})$/;

// 이 조직의 증빙 파일 경로인지(다른 조직 파일을 가리키는 값은 거부)
function isOrgBlob(orgId, blob) {
  if (typeof blob !== "string") return false;
  const m = BLOB_RE.exec(blob);
  return !!m && Number(m[1]) === Number(orgId) && Object.prototype.hasOwnProperty.call(TYPES, m[5]);
}

function extOf(name) {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

const EVIDENCE_BUCKET = () => process.env.SUPABASE_EVIDENCE_BUCKET || "evidence";
const DOWNLOADS_BUCKET = () => process.env.SUPABASE_DOWNLOADS_BUCKET || "downloads";

function config() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new HttpError(503, "증빙 파일 저장소가 아직 설정되지 않았습니다. 관리자에게 문의하세요.");
  return { base: url.replace(/\/+$/, "") + "/storage/v1", key };
}

// 경로 각 조각을 인코딩한다(슬래시는 유지)
const enc = p => String(p).split("/").map(encodeURIComponent).join("/");

function api(method, route, { json } = {}) {
  const { base, key } = config();
  return fetch(base + route, {
    method,
    headers: { apikey: key, Authorization: "Bearer " + key, ...(json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
}

// 저장소가 돌려준 상대 주소("/object/...?token=")를 브라우저가 쓸 전체 주소로
const absolute = rel => config().base + (rel.startsWith("/") ? rel : "/" + rel);

// 올리기용 임시 주소(한 파일에만 유효). 브라우저는 이 주소로 PUT 한다.
async function signedUploadUrl(blobPath, bucket = EVIDENCE_BUCKET()) {
  const res = await api("POST", `/object/upload/sign/${bucket}/${enc(blobPath)}`);
  if (!res.ok) throw new Error("upload sign failed: " + res.status);
  return absolute((await res.json()).url);
}

// 내려받기용 임시 주소. downloadName 이 있으면 그 이름으로 저장되는 "첨부" 형태, 없으면 브라우저에서 바로 열기.
async function signedDownloadUrl(blobPath, minutes, { bucket = EVIDENCE_BUCKET(), downloadName } = {}) {
  const res = await api("POST", `/object/sign/${bucket}/${enc(blobPath)}`, { json: { expiresIn: Math.round(minutes * 60) } });
  if (res.status === 400 || res.status === 404) throw new HttpError(404, "파일을 찾을 수 없습니다. (저장소에 올라가지 않았거나 삭제된 파일입니다)");
  if (!res.ok) throw new Error("download sign failed: " + res.status);
  const rel = (await res.json()).signedURL;
  const name = downloadName ? String(downloadName).replace(/[\r\n"\\]/g, "_").slice(0, 150) : "";
  return absolute(rel) + (name ? "&download=" + encodeURIComponent(name) : "");
}

async function deleteBlob(blobPath, bucket = EVIDENCE_BUCKET()) {
  const res = await api("DELETE", `/object/${bucket}`, { json: { prefixes: [blobPath] } });
  if (!res.ok) throw new Error("delete failed: " + res.status);
}

// 오브젝트 속성(없으면 null)
async function objectInfo(blobPath, bucket = EVIDENCE_BUCKET()) {
  const res = await api("GET", `/object/info/${bucket}/${enc(blobPath)}`);
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error("info failed: " + res.status);
  return res.json();
}

// 작은 JSON 파일 읽기(설치 파일 버전 정보). 없으면 null.
async function readJson(blobPath, bucket = DOWNLOADS_BUCKET()) {
  const res = await api("GET", `/object/authenticated/${bucket}/${enc(blobPath)}`);
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error("read failed: " + res.status);
  try { return JSON.parse(await res.text()); } catch (e) { return null; }
}

// PC 프로그램 설치 파일: 증빙과 별개의 비공개 버킷에 두고, 로그인 없이도 짧은 임시 주소를 받게 하되 횟수 제한을 둔다.
// 버전은 같은 버킷의 installer-version.json({"version":"2.2.0"})에 적는다.
const INSTALLER_BLOB = "KHNP-Online-Installer.exe";
const INSTALLER_VERSION_BLOB = "installer-version.json";
const INSTALLER_FILENAME = "KHNP-노동조합회계관리_서버판_설치프로그램.exe";

module.exports = {
  TYPES, MAX_BYTES, CATEGORIES, BLOB_RE, isOrgBlob, extOf,
  EVIDENCE_BUCKET, DOWNLOADS_BUCKET, signedUploadUrl, signedDownloadUrl, deleteBlob, objectInfo, readJson,
  INSTALLER_BLOB, INSTALLER_VERSION_BLOB, INSTALLER_FILENAME,
};
