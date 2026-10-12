// 설치 파일을 비공개 컨테이너(downloads)에 올린다. 사이트(로그인 후 PC 접속 시)가 이 파일을 내려받게 해 준다.
// 사용: node desktop/upload_installer.js <설치프로그램.exe 경로> <버전>   (예: 2.1.0)
// .env.local 의 AZURE_STORAGE_CONNECTION_STRING 을 사용한다.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !process.env[line.slice(0, i)]) process.env[line.slice(0, i)] = line.slice(i + 1);
}
const blob = require(path.join(root, "api/_lib/blob.js"));
(async () => {
  const [file, version] = process.argv.slice(2);
  if (!file || !version) throw new Error("사용법: node desktop/upload_installer.js <exe 경로> <버전>");
  const container = blob.installerContainer();
  await container.createIfNotExists(); // 공개 접근 없음(비공개)
  const bb = container.getBlockBlobClient(blob.INSTALLER_BLOB);
  await bb.uploadData(fs.readFileSync(file), { blobHTTPHeaders: { blobContentType: "application/octet-stream" }, metadata: { version } });
  const p = await bb.getProperties();
  console.log("uploaded", blob.INSTALLER_BLOB, p.contentLength, "bytes, version", p.metadata.version);
})().catch(e => { console.error("ERROR", e.message); process.exit(1); });
