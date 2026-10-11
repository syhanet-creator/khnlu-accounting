// 비밀번호 해시(scrypt, 솔트 포함). 평문은 저장·로그하지 않는다.
const crypto = require("crypto");

const N = 16384, R = 8, P = 1, KEYLEN = 32;

function scrypt(password, salt, n, r, p, keylen) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(password, stored) {
  try {
    const parts = String(stored || "").split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, n, r, p, saltB64, keyB64] = parts;
    const expected = Buffer.from(keyB64, "base64");
    const actual = await scrypt(password, Buffer.from(saltB64, "base64"), Number(n), Number(r), Number(p), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (e) {
    return false;
  }
}

// 존재하지 않는 아이디로 시도해도 응답 시간이 같도록 더미 해시를 비교한다.
let dummyHashPromise = null;
function dummyVerify(password) {
  if (!dummyHashPromise) dummyHashPromise = hashPassword("dummy-password-for-timing-equalization");
  return dummyHashPromise.then(h => verifyPassword(password, h));
}

// 정책: 10~128자, 영문+숫자 포함, 아이디를 포함하지 않음. 문제가 있으면 안내 문구, 없으면 null.
function passwordPolicyError(password, loginId) {
  if (typeof password !== "string") return "비밀번호를 입력해 주세요.";
  if (password.length < 10) return "비밀번호는 10자 이상이어야 합니다.";
  if (password.length > 128) return "비밀번호는 128자 이하여야 합니다.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "비밀번호에는 영문과 숫자가 모두 포함되어야 합니다.";
  if (loginId && password.toLowerCase().includes(String(loginId).toLowerCase())) return "비밀번호에 아이디를 포함할 수 없습니다.";
  return null;
}

// 관리자가 계정을 발급/초기화할 때 쓰는 임시 비밀번호(12자, 헷갈리는 글자 I l O 0 1 제외). 첫 로그인 때 변경이 강제된다.
function generateTempPassword(loginId) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", lower = "abcdefghijkmnopqrstuvwxyz", digit = "23456789";
  const all = upper + lower + digit;
  for (;;) {
    const chars = [upper, lower, digit].map(set => set[crypto.randomInt(set.length)]);
    while (chars.length < 12) chars.push(all[crypto.randomInt(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    const pw = chars.join("");
    if (!passwordPolicyError(pw, loginId)) return pw;
  }
}

module.exports = { hashPassword, verifyPassword, dummyVerify, passwordPolicyError, generateTempPassword };
