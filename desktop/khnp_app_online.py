"""한수원노동조합 회계관리 시스템 - 서버판 데스크톱 프로그램.

서버(https://khnlu-accounting.vercel.app)에 로그인해서 쓰는 창이다. 데이터는 서버(Supabase 데이터베이스)에 저장되고,
이 프로그램은 서버 버전에서 지원하지 않는 PC 기능(증빙 파일 첨부·열기·인쇄)만 제공한다.
"""
import base64
import ctypes
import os
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

import webview

APP_URL = os.environ.get("KHNP_APP_URL", "https://khnlu-accounting.vercel.app/")
APP_TITLE = "한수원노동조합 회계관리 시스템 (서버판)"
APP_VERSION = "2.3"
# 사이트가 PC 프로그램 안에서 열렸는지 알아보도록 브라우저 식별 문자열 끝에 붙이는 표시
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              f"Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0 KHNP-Desktop/{APP_VERSION}")
PRINT_TEMP_DIR = os.path.join(tempfile.gettempdir(), "KHNP-Print")
MAX_PDF_BYTES = 120 * 1024 * 1024
ALLOWED_HOSTS = {urlparse(APP_URL).hostname, "khnp-accounting.vercel.app"}   # 옛 주소도 전환 기간 동안 허용

DATA_DIR_NAME = "KHNP-UnionAccounting-Online"   # 로그인 쿠키 등 웹뷰 프로필
ATTACH_BASE_DIR_NAME = "KHNP-UnionAccounting"   # 기존(오프라인판) 프로그램과 같은 첨부 폴더를 그대로 쓴다
ATTACH_DIR_NAME = "증빙자료"
FILE_ATTRIBUTE_HIDDEN = 0x02


def _hide(path):
    try:
        ctypes.windll.kernel32.SetFileAttributesW(path, FILE_ATTRIBUTE_HIDDEN)
    except Exception:
        pass


def _local_appdata():
    return os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))


def app_data_dir():
    path = os.path.join(_local_appdata(), DATA_DIR_NAME)
    os.makedirs(path, exist_ok=True)
    _hide(path)
    return path


def attachments_root():
    base = os.path.join(_local_appdata(), ATTACH_BASE_DIR_NAME)
    os.makedirs(base, exist_ok=True)
    _hide(base)
    path = os.path.join(base, ATTACH_DIR_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def safe_component(text, limit=80):
    text = str(text)
    keep = "".join(c for c in text if c.isalnum() or c in (" ", "-", "_", ".", "(", ")")).strip()
    return keep[:limit] or "item"


def resolve_attachment(path):
    """첨부 폴더 안의 파일만 허용한다. 상대 경로(서버에 저장되는 형태)와 예전 절대 경로를 모두 받되,
    '..'이나 다른 폴더를 가리키면 None을 돌려준다."""
    if not path or not isinstance(path, str):
        return None
    try:
        root = os.path.realpath(attachments_root())
        candidate = path if os.path.isabs(path) else os.path.join(root, path)
        real = os.path.realpath(candidate)
        if os.path.commonpath([real, root]) != root or real == root:
            return None
        return real
    except (ValueError, OSError):
        return None


def _page_is_ours(window=None):
    """지금 창에 열려 있는 페이지가 우리 서버 주소일 때만 PC 기능을 허용한다."""
    try:
        window = window or webview.windows[0]
        url = window.get_current_url() or ""
    except Exception:
        return False
    return urlparse(url).hostname in ALLOWED_HOSTS


def _cleanup_print_temp(max_age_sec=24 * 3600):
    """임시 PDF는 하루가 지나면 지운다."""
    try:
        now = time.time()
        for fn in os.listdir(PRINT_TEMP_DIR):
            fp = os.path.join(PRINT_TEMP_DIR, fn)
            if fn.lower().endswith(".pdf") and os.path.isfile(fp) and now - os.path.getmtime(fp) > max_age_sec:
                os.remove(fp)
    except Exception:
        pass


def reachable(timeout=6):
    try:
        req = urllib.request.Request(APP_URL, method="HEAD", headers={"User-Agent": "KHNP-Desktop"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status < 500
    except urllib.error.HTTPError as e:
        return e.code < 500
    except Exception:
        return False


class Api:
    # category: 'voucher' | 'contract' / entity_id: 전표 id 또는 계약 id
    def pick_and_attach(self, category, entity_id):
        if not _page_is_ours():
            return []
        window = webview.windows[0]
        try:
            result = window.create_file_dialog(
                webview.FileDialog.OPEN,
                allow_multiple=True,
                file_types=("PDF 파일 (*.pdf)", "모든 파일 (*.*)"),
            )
        except Exception:
            return []
        if not result:
            return []

        root = attachments_root()
        dest_dir = os.path.join(root, safe_component(category), safe_component(entity_id))
        os.makedirs(dest_dir, exist_ok=True)

        saved = []
        for src in result:
            try:
                original_name = os.path.basename(src)
                stamp = time.strftime("%Y%m%d%H%M%S")
                stored_name = f"{stamp}_{safe_component(original_name, limit=120)}"
                dest_path = os.path.join(dest_dir, stored_name)
                n = 1
                base_dest = dest_path
                while os.path.exists(dest_path):
                    base, ext = os.path.splitext(base_dest)
                    dest_path = f"{base}_{n}{ext}"
                    n += 1
                shutil.copy2(src, dest_path)
                saved.append({
                    "id": os.path.basename(dest_path),
                    "name": original_name,
                    # 서버에는 PC 계정명 등이 드러나지 않도록 첨부 폴더 기준 상대 경로만 기록한다.
                    "path": os.path.relpath(dest_path, root),
                    "size": os.path.getsize(dest_path),
                    "addedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
                })
            except Exception:
                continue
        return saved

    def open_attachment(self, path):
        if not _page_is_ours():
            return False
        real = resolve_attachment(path)
        if not real or not os.path.isfile(real):
            return False
        try:
            os.startfile(real)
            return True
        except Exception:
            return False

    def print_files(self, paths):
        results = []
        if not _page_is_ours():
            return results
        for p in paths or []:
            real = resolve_attachment(p)
            if not real or not os.path.isfile(real):
                results.append({"path": p, "ok": False, "error": "이 PC에 없는 파일입니다."})
                continue
            try:
                os.startfile(real, "print")
                results.append({"path": p, "ok": True})
            except Exception as e:
                results.append({"path": p, "ok": False, "error": str(e)})
        return results

    def remove_attachment(self, path):
        if not _page_is_ours():
            return False
        real = resolve_attachment(path)
        try:
            if real and os.path.isfile(real):
                os.remove(real)
            return True
        except Exception:
            return False

    # 사이트가 합쳐 만든 "증빙 포함 PDF"를 임시 폴더에 저장하고 기본 PDF 프로그램으로 연다(거기서 인쇄).
    def open_pdf_bytes(self, b64, name):
        if not _page_is_ours() or not isinstance(b64, str):
            return False
        try:
            data = base64.b64decode(b64, validate=True)
        except Exception:
            return False
        if not data.startswith(b"%PDF") or len(data) > MAX_PDF_BYTES:
            return False
        try:
            os.makedirs(PRINT_TEMP_DIR, exist_ok=True)
            _cleanup_print_temp()
            stem = safe_component(os.path.splitext(os.path.basename(str(name or "print")))[0], limit=60)
            path = os.path.join(PRINT_TEMP_DIR, f"{time.strftime('%Y%m%d%H%M%S')}_{stem}.pdf")
            with open(path, "wb") as f:
                f.write(data)
            os.startfile(path)
            return True
        except Exception:
            return False

    # 인터넷이 끊겼을 때 보이는 안내 화면의 [다시 연결] 버튼에서 호출한다.
    def retry(self):
        if reachable():
            webview.windows[0].load_url(APP_URL)
            return True
        return False


OFFLINE_HTML = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>연결할 수 없음</title>
<style>
 :root{--bg:#fff;--card:#fff;--text:#0d0d0d;--soft:#5d5d5d;--border:#e5e5e5;--btn:#0d0d0d;--btn-text:#fff}
 @media (prefers-color-scheme:dark){:root{--bg:#212121;--card:#272727;--text:#ececec;--soft:#b4b4b4;--border:#383838;--btn:#fff;--btn-text:#0d0d0d}}
 body{margin:0;font-family:'Pretendard Variable',Pretendard,'Segoe UI','Malgun Gothic',sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;height:100vh}
 .card{background:var(--card);border:1px solid var(--border);border-radius:24px;padding:36px 38px;max-width:420px;text-align:center}
 .logo{width:46px;height:46px;border-radius:15px;background:var(--btn);color:var(--btn-text);display:grid;place-items:center;font-weight:700;font-size:15px;margin:0 auto 16px}
 h2{margin:0 0 10px;font-size:21px;letter-spacing:-0.02em} p{line-height:1.7;font-size:14px;color:var(--soft);margin:0}
 button{margin-top:18px;padding:10px 22px;border:0;border-radius:999px;background:var(--btn);color:var(--btn-text);font-size:14px;font-weight:600;cursor:pointer}
 button:disabled{opacity:.5} #msg{color:#dc2626;margin-top:12px;min-height:20px;font-size:13px}
</style></head><body><div class="card">
<div class="logo">회계</div>
<h2>서버에 연결할 수 없습니다</h2>
<p>이 프로그램은 서버에 로그인해서 사용합니다.<br>인터넷 연결을 확인한 뒤 [다시 연결]을 눌러 주세요.</p>
<button id="b" onclick="go()">다시 연결</button><div id="msg"></div>
</div>
<script>
async function go(){
  var m=document.getElementById('msg'), b=document.getElementById('b'); m.textContent='연결 중...'; b.disabled=true;
  try { var ok = await pywebview.api.retry(); if(!ok){ m.textContent='아직 연결되지 않습니다. 인터넷 연결을 확인해 주세요.'; } }
  catch(e){ m.textContent='잠시 후 다시 시도해 주세요.'; }
  b.disabled=false;
}
</script></body></html>"""


def main():
    webview.settings["ALLOW_DOWNLOADS"] = True  # 설정 화면의 백업 파일(.json) 내려받기
    api = Api()
    online = reachable()
    window = webview.create_window(
        APP_TITLE,
        url=APP_URL if online else None,
        html=None if online else OFFLINE_HTML,
        width=1440,
        height=900,
        min_size=(1100, 700),
        js_api=api,
        text_select=True,   # 임시 비밀번호 등을 선택·복사할 수 있도록
        zoomable=True,      # Ctrl+마우스 휠로 화면 확대/축소
    )

    def on_loaded():
        # 우리 서버 주소가 아닌 곳으로 이동되면 즉시 처음 화면으로 되돌린다.
        try:
            url = window.get_current_url() or ""
        except Exception:
            return
        if url and not url.startswith("about:") and urlparse(url).hostname not in ALLOWED_HOSTS:
            window.load_url(APP_URL)

    window.events.loaded += on_loaded
    webview.start(private_mode=False, storage_path=app_data_dir(), user_agent=USER_AGENT)


if __name__ == "__main__":
    main()
