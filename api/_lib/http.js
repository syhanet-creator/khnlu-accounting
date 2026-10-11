// 요청/응답 공통 처리
function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  const raw = xf ? String(xf).split(",")[0].trim() : (req.socket && req.socket.remoteAddress) || "";
  return raw.slice(0, 45) || null;
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function getBody(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b || "{}"); } catch (e) { b = {}; } }
  return b && typeof b === "object" ? b : {};
}

// 메서드 확인 + (쓰기 요청이면) CSRF 방어: JSON 요청만 허용하고, Origin이 있으면 같은 사이트여야 한다.
// 통과하면 true, 아니면 응답을 보내고 false.
function guard(req, res, methods) {
  if (!methods.includes(req.method)) {
    res.setHeader("Allow", methods.join(", "));
    send(res, 405, { error: "method not allowed" });
    return false;
  }
  if (req.method !== "GET") {
    const ct = String(req.headers["content-type"] || "");
    if (!ct.toLowerCase().includes("application/json")) {
      send(res, 415, { error: "JSON 요청만 허용됩니다." });
      return false;
    }
    const origin = req.headers.origin;
    if (origin) {
      let host = "";
      try { host = new URL(origin).host; } catch (e) {}
      if (host !== req.headers.host) {
        send(res, 403, { error: "허용되지 않은 요청 출처입니다." });
        return false;
      }
    }
  }
  return true;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

module.exports = { send, clientIp, parseCookies, getBody, guard, HttpError };
