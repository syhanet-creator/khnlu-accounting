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
- 새 증빙 파일은 사이트가 서버(Azure Blob)에 올리므로 이 프로그램의 파일 API는 쓰이지 않습니다.
  예전에 PC에만 저장했던 증빙(`%LOCALAPPDATA%\KHNP-UnionAccounting\증빙자료`)을 열기·인쇄·삭제하는 용도로만 남겨 두었고,
  첨부 폴더 밖 경로는 거부됩니다.
- 우리 서버 주소가 아닌 페이지로 이동하면 자동으로 처음 화면으로 되돌립니다.
- 인터넷에 연결되지 않으면 안내 화면이 나오고 [다시 연결]로 재시도합니다.

## 배포 (사이트에서 내려받게 하기)
1. 위 빌드로 만든 `dist\KHNP-Online-Installer.exe`를 확인한다 (현재 버전은 `khnp_installer_online.py`의 `APP_VERSION`, `khnp_app_online.py`의 `APP_VERSION`).
2. 저장소 루트에서 `node desktop/upload_installer.js <설치프로그램 경로> <버전>` 실행 → 비공개 컨테이너 `downloads`에 올라간다.
3. 사이트는 Windows PC 브라우저에 로그인 화면 버튼, 로그인 후 안내 배너, 설정/백업 카드(시스템관리자 화면 포함)로 `설치 파일 내려받기`를 보여 준다 (`/api/files/app_info`, `/api/files/app_download`). 파일은 비공개 저장소에 있고 5분짜리 임시 주소로 제공된다(로그인 전에도 가능, 같은 IP에서 1시간 10회 제한, 내려받기는 감사로그에 기록).

## 버전 기록
- 2.0: 서버 사이트를 여는 창 + 증빙 파일(PC 저장)
- 2.1: 사이트가 만든 "증빙 포함 PDF"를 기본 PDF 프로그램으로 열기(`open_pdf_bytes`), 사용자 식별 문자열에 `KHNP-Desktop/2.1` 표시
