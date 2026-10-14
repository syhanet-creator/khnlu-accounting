import ctypes
import os
import shutil
import subprocess
import sys
import tempfile
import winreg

APP_NAME = "KHNP-UnionAccounting-Online"
APP_DISPLAY_NAME = "한수원노동조합 회계관리 시스템 (서버판)"
APP_VERSION = "2.3.0"
PUBLISHER = "한수원노동조합"
UNINSTALL_KEY = rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{APP_NAME}"

CREATE_NO_WINDOW = 0x08000000

MB_YESNO = 0x00000004
MB_ICONQUESTION = 0x00000020
MB_ICONINFORMATION = 0x00000040
MB_TOPMOST = 0x00040000
IDYES = 6


def msgbox_confirm(text, title):
    return ctypes.windll.user32.MessageBoxW(
        0, text, title, MB_YESNO | MB_ICONQUESTION | MB_TOPMOST
    ) == IDYES


def msgbox_info(text, title):
    ctypes.windll.user32.MessageBoxW(0, text, title, MB_ICONINFORMATION | MB_TOPMOST)


def resource_path(relative_path):
    base_path = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_path, relative_path)


def install_dir():
    base = os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))
    return os.path.join(base, "Programs", APP_NAME)


def make_shortcut(link_path, target, workdir=None):
    workdir = workdir or os.path.dirname(target)
    vbs = (
        'Set oWS = WScript.CreateObject("WScript.Shell")\n'
        f'sLinkFile = "{link_path}"\n'
        "Set oLink = oWS.CreateShortcut(sLinkFile)\n"
        f'oLink.TargetPath = "{target}"\n'
        f'oLink.WorkingDirectory = "{workdir}"\n'
        f'oLink.IconLocation = "{target}"\n'
        "oLink.Save\n"
    )
    fd, vbs_path = tempfile.mkstemp(suffix=".vbs")
    try:
        # cscript는 UTF-8(BOM 없음)로 저장된 한글 경로를 깨뜨릴 수 있어
        # WSH가 안정적으로 인식하는 UTF-16(BOM 포함)으로 저장한다.
        with os.fdopen(fd, "w", encoding="utf-16") as f:
            f.write(vbs)
        subprocess.run(
            ["cscript", "//nologo", vbs_path],
            check=False,
            creationflags=CREATE_NO_WINDOW,
        )
    finally:
        os.remove(vbs_path)


def remove_shortcut(link_path):
    if os.path.exists(link_path):
        try:
            os.remove(link_path)
        except OSError:
            pass


def shell_folder(name, fallback):
    # OneDrive로 바탕화면/문서 등이 리디렉션된 PC가 많아, 실제 경로는
    # 레지스트리의 Shell Folders 값을 통해 확인해야 정확하다.
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders",
        ) as key:
            value, _ = winreg.QueryValueEx(key, name)
            return os.path.expandvars(value)
    except OSError:
        return fallback


def start_menu_shortcut_path():
    programs = shell_folder(
        "Programs",
        os.path.join(os.environ["APPDATA"], "Microsoft", "Windows", "Start Menu", "Programs"),
    )
    return os.path.join(programs, f"{APP_DISPLAY_NAME}.lnk")


def desktop_shortcut_path():
    desktop = shell_folder("Desktop", os.path.join(os.environ["USERPROFILE"], "Desktop"))
    return os.path.join(desktop, f"{APP_DISPLAY_NAME}.lnk")


def do_install():
    target_dir = install_dir()
    os.makedirs(target_dir, exist_ok=True)

    src_exe = resource_path("KHNP-UnionAccounting-Online.exe")
    dest_exe = os.path.join(target_dir, "KHNP-UnionAccounting-Online.exe")
    shutil.copy2(src_exe, dest_exe)

    # 이 설치 프로그램 자신을 제거 프로그램으로도 함께 복사해 둔다 (--uninstall 인자로 실행하면 제거 동작)
    self_exe = sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__)
    uninstaller_path = os.path.join(target_dir, "Uninstall.exe")
    try:
        shutil.copy2(self_exe, uninstaller_path)
    except Exception:
        uninstaller_path = dest_exe  # 복사 실패 시 최소한 앱은 정상 설치되도록

    make_shortcut(start_menu_shortcut_path(), dest_exe)
    make_shortcut(desktop_shortcut_path(), dest_exe)

    try:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as key:
            winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, APP_DISPLAY_NAME)
            winreg.SetValueEx(key, "DisplayVersion", 0, winreg.REG_SZ, APP_VERSION)
            winreg.SetValueEx(key, "Publisher", 0, winreg.REG_SZ, PUBLISHER)
            winreg.SetValueEx(key, "DisplayIcon", 0, winreg.REG_SZ, dest_exe)
            winreg.SetValueEx(key, "UninstallString", 0, winreg.REG_SZ, f'"{uninstaller_path}" --uninstall')
            winreg.SetValueEx(key, "InstallLocation", 0, winreg.REG_SZ, target_dir)
            winreg.SetValueEx(key, "NoModify", 0, winreg.REG_DWORD, 1)
            winreg.SetValueEx(key, "NoRepair", 0, winreg.REG_DWORD, 1)
    except OSError:
        pass

    msgbox_info(
        "설치가 완료되었습니다.\n\n"
        f"설치 위치: {target_dir}\n"
        "시작 메뉴와 바탕화면에 바로가기가 생성되었습니다.\n\n"
        "프로그램을 열면 조직 관리자에게 받은 아이디로 로그인합니다. (인터넷 연결 필요)\n\n"
        "제거하려면 [설정 > 앱 > 설치된 앱]에서 "
        f"'{APP_DISPLAY_NAME}'을(를) 찾아 제거할 수 있습니다.",
        APP_DISPLAY_NAME,
    )


def do_uninstall():
    if not msgbox_confirm(
        "프로그램을 제거하시겠습니까?\n\n"
        "(서버에 저장된 회계 데이터와 이 PC에 첨부한 파일은 삭제되지 않고 그대로 남습니다)",
        APP_DISPLAY_NAME,
    ):
        return

    target_dir = install_dir()
    remove_shortcut(start_menu_shortcut_path())
    remove_shortcut(desktop_shortcut_path())

    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY)
    except FileNotFoundError:
        pass
    except OSError:
        pass

    msgbox_info("프로그램이 제거되었습니다.", APP_DISPLAY_NAME)

    # 지금 실행 중인 Uninstall.exe 자신이 target_dir 안에 있으므로,
    # 프로세스 종료 후 별도 배치 파일로 폴더 전체를 정리한다.
    bat = (
        "@echo off\r\n"
        "timeout /t 1 /nobreak >nul\r\n"
        f'rmdir /s /q "{target_dir}"\r\n'
        'del "%~f0"\r\n'
    )
    fd, bat_path = tempfile.mkstemp(suffix=".bat")
    with os.fdopen(fd, "w", encoding="ascii") as f:
        f.write(bat)
    subprocess.Popen(["cmd", "/c", bat_path], creationflags=CREATE_NO_WINDOW)


def main():
    if "--uninstall" in sys.argv:
        do_uninstall()
        return

    proceed = msgbox_confirm(
        f"'{APP_DISPLAY_NAME}'을(를) 이 PC에 설치하시겠습니까?\n\n"
        f"설치 위치: {install_dir()}\n"
        "(관리자 권한이 필요 없습니다)\n"
        "(서버에 로그인해서 사용하므로 인터넷 연결과 로그인 계정이 필요합니다)\n\n"
        "시작 메뉴와 바탕화면에 바로가기가 생성됩니다.",
        f"{APP_DISPLAY_NAME} 설치",
    )
    if proceed:
        do_install()


if __name__ == "__main__":
    main()
