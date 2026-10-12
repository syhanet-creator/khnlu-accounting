# 서버판 PC 프로그램(EXE) 빌드

서버(https://khnp-accounting.vercel.app)를 여는 창 + PC 전용 기능(증빙 파일 첨부·열기·인쇄)입니다.
데이터는 서버에 저장되며 이 프로그램은 데이터를 저장하지 않습니다.

## 필요한 것
- Windows, Python 3.12+ , `pip install pywebview pyinstaller`

## 빌드 (짧은 경로에서 실행 권장)
```
cd desktop
python -m PyInstaller --noconfirm --clean --onefile --windowed --name "KHNP-UnionAccounting-Online" khnp_app_online.py
python -m PyInstaller --noconfirm --clean --onefile --windowed --name "KHNP-Online-Installer" --add-data "dist\KHNP-UnionAccounting-Online.exe;." khnp_installer_online.py
```
결과: `dist\KHNP-UnionAccounting-Online.exe`(프로그램), `dist\KHNP-Online-Installer.exe`(설치 프로그램).

## 동작 메모
- 다른 서버 주소로 시험하려면 환경변수 `KHNP_APP_URL`을 지정합니다.
- 증빙 파일은 `%LOCALAPPDATA%\KHNP-UnionAccounting\증빙자료`(오프라인판과 같은 폴더)에 저장되고,
  서버에는 이 폴더 기준 상대 경로만 기록됩니다. 첨부 폴더 밖 경로는 열기·인쇄·삭제가 거부됩니다.
- 우리 서버 주소가 아닌 페이지로 이동하면 자동으로 처음 화면으로 되돌립니다.
- 인터넷에 연결되지 않으면 안내 화면이 나오고 [다시 연결]로 재시도합니다.
