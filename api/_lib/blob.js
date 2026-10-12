// 증빙 파일 저장소(Azure Blob Storage). 컨테이너는 비공개이며, 서버가 로그인·권한을 확인한 뒤 짧은 시간만 유효한
// 임시 주소(SAS)를 발급한다. 브라우저/앱은 그 주소로 Blob에 직접 올리고 내려받는다(Vercel 요청 크기 제한을 피함).
const {
  BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions, SASProtocol,
} = require("@azure/storage-blob");
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

let cached = null;
function client() {
  if (cached) return cached;
  const cs = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!cs) throw new HttpError(503, "증빙 파일 저장소가 아직 설정되지 않았습니다. 관리자에게 문의하세요.");
  const name = /AccountName=([^;]+)/i.exec(cs), key = /AccountKey=([^;]+)/i.exec(cs);
  if (!name || !key) throw new Error("AZURE_STORAGE_CONNECTION_STRING 형식이 올바르지 않습니다.");
  const credential = new StorageSharedKeyCredential(name[1], key[1]);
  const service = BlobServiceClient.fromConnectionString(cs);
  cached = { credential, service, container: service.getContainerClient(process.env.AZURE_STORAGE_CONTAINER || "evidence") };
  return cached;
}

// blobPath 한 개에만 유효한 임시 주소. perm: "w"(올리기) | "r"(내려받기)
function sasUrl(blobPath, perm, minutes, { contentType, contentDisposition } = {}) {
  const { credential, container } = client();
  const now = Date.now();
  const sas = generateBlobSASQueryParameters({
    containerName: container.containerName,
    blobName: blobPath,
    permissions: BlobSASPermissions.parse(perm),
    startsOn: new Date(now - 5 * 60 * 1000),
    expiresOn: new Date(now + minutes * 60 * 1000),
    protocol: SASProtocol.Https,
    ...(contentType ? { contentType } : {}),
    ...(contentDisposition ? { contentDisposition } : {}),
  }, credential).toString();
  return `${container.getBlockBlobClient(blobPath).url}?${sas}`;
}

async function deleteBlob(blobPath) {
  const { container } = client();
  await container.getBlockBlobClient(blobPath).deleteIfExists();
}

// 한글 파일 이름을 안전하게 담는 Content-Disposition (RFC 5987)
function dispositionFor(kind, filename) {
  const safe = String(filename || "file").replace(/[\r\n"\\]/g, "_").slice(0, 150);
  return `${kind}; filename="${encodeURIComponent(safe)}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

module.exports = { TYPES, MAX_BYTES, CATEGORIES, BLOB_RE, isOrgBlob, extOf, client, sasUrl, deleteBlob, dispositionFor };
