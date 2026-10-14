// 설치 파일을 비공개 버킷(downloads)에 올린다. 사이트(로그인 화면·로그인 후 PC 접속 시)가 이 파일을 내려받게 해 준다.
// 사용: node desktop/upload_installer.js <설치프로그램.exe 경로> <버전>   (예: 2.2.0)
// .env.local 의 SUPABASE_URL, SUPABASE_SERVICE_KEY 를 사용한다.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !process.env[line.slice(0, i)]) process.env[line.slice(0, i)] = line.slice(i + 1);
}
const blob = require(path.join(root, "api/_lib/blob.js"));
const base = process.env.SUPABASE_URL.replace(/\/+$/, "") + "/storage/v1";
const key = process.env.SUPABASE_SERVICE_KEY;
const bucket = blob.DOWNLOADS_BUCKET();

async function put(name, body, contentType) {
  const res = await fetch(`${base}/object/${bucket}/${encodeURIComponent(name)}`, {
    method: "POST", // 같은 이름이 있으면 덮어쓴다(x-upsert)
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": contentType, "x-upsert": "true" },
    body,
  });
  if (!res.ok) throw new Error(`${name} 업로드 실패: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

(async () => {
  const [file, version] = process.argv.slice(2);
  if (!file || !version) throw new Error("사용법: node desktop/upload_installer.js <exe 경로> <버전>");
  const data = fs.readFileSync(file);
  await put(blob.INSTALLER_BLOB, data, "application/octet-stream");
  await put(blob.INSTALLER_VERSION_BLOB, JSON.stringify({ version }), "application/json");
  const info = await blob.objectInfo(blob.INSTALLER_BLOB, bucket);
  console.log("uploaded", blob.INSTALLER_BLOB, info && info.size, "bytes, version", version);
})().catch(e => { console.error("ERROR", e.message); process.exit(1); });
