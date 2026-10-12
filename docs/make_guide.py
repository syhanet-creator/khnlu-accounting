"""서버판 사용 안내서(PDF) 생성. 실행: python -X utf8 docs/make_guide.py [출력경로]
화면의 메뉴 이름·권한 규칙이 바뀌면 이 파일의 내용을 고쳐서 다시 생성한다. (reportlab 필요: pip install reportlab)"""
import sys
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph,
                                Spacer, Table, TableStyle)
from reportlab.graphics.shapes import Drawing, Line, Polygon, Rect, String

OUT = sys.argv[1] if len(sys.argv) > 1 else "KHNP-노동조합회계관리_서버판_사용안내서.pdf"
SITE = "https://khnp-accounting.vercel.app"

pdfmetrics.registerFont(TTFont("Malgun", "C:/Windows/Fonts/malgun.ttf"))
pdfmetrics.registerFont(TTFont("Malgun-Bold", "C:/Windows/Fonts/malgunbd.ttf"))
pdfmetrics.registerFontFamily("Malgun", normal="Malgun", bold="Malgun-Bold", italic="Malgun", boldItalic="Malgun-Bold")

NAVY = colors.HexColor("#0D0D0D")
GOLD = colors.HexColor("#10A37F")
PAPER = colors.HexColor("#F7F7F8")
LINE = colors.HexColor("#E5E5E5")
INK = colors.HexColor("#0D0D0D")
SOFT = colors.HexColor("#5D5D5D")
GREEN = colors.HexColor("#2F7D4F")
RED = colors.HexColor("#B3261E")

BASE = ParagraphStyle("base", fontName="Malgun", fontSize=10, leading=16, textColor=INK, spaceAfter=4)
H1 = ParagraphStyle("h1", parent=BASE, fontName="Malgun-Bold", fontSize=16, leading=22, textColor=NAVY, spaceBefore=6, spaceAfter=8)
H2 = ParagraphStyle("h2", parent=BASE, fontName="Malgun-Bold", fontSize=12, leading=18, textColor=NAVY, spaceBefore=10, spaceAfter=4)
SMALL = ParagraphStyle("small", parent=BASE, fontSize=8.5, leading=13, textColor=SOFT)
CELL = ParagraphStyle("cell", parent=BASE, fontSize=9, leading=13.5, spaceAfter=0)
CELLB = ParagraphStyle("cellb", parent=CELL, fontName="Malgun-Bold")
HEAD = ParagraphStyle("head", parent=CELL, fontName="Malgun-Bold", textColor=colors.white)
CENTER = ParagraphStyle("center", parent=CELL, alignment=TA_CENTER)
BUL = ParagraphStyle("bul", parent=BASE, leftIndent=14, bulletIndent=3, spaceAfter=2)

W = A4[0] - 40 * mm  # 본문 폭


from reportlab.platypus import CondPageBreak


def P(t, s=BASE):
    if s is H1: return KeepTogether([CondPageBreak(62 * mm), Paragraph(t, s)])
    if s is H2: return KeepTogether([CondPageBreak(38 * mm), Paragraph(t, s)])
    return Paragraph(t, s)
def bullets(items): return [Paragraph(t, BUL, bulletText="•") for t in items]


def steps(items):
    out = []
    for i, t in enumerate(items, 1):
        out.append(Paragraph(t, ParagraphStyle("st", parent=BASE, leftIndent=18, bulletIndent=0, spaceAfter=3, bulletFontName="Malgun-Bold", bulletColor=NAVY), bulletText=f"{i}."))
    return out


def box(text, kind="note"):
    color = {"note": GOLD, "warn": RED, "ok": GREEN}[kind]
    label = {"note": "참고", "warn": "주의", "ok": "팁"}[kind]
    cell = Paragraph(f'<font name="Malgun-Bold" color="{color.hexval().replace("0x", "#")}">{label}</font>&nbsp;&nbsp;{text}', ParagraphStyle("bx", parent=BASE, fontSize=9.2, leading=14.5, spaceAfter=0))
    t = Table([[cell]], colWidths=[W])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PAPER), ("LINEBEFORE", (0, 0), (0, -1), 3, color),
                           ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                           ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    return [Spacer(1, 3), t, Spacer(1, 6)]


def table(rows, widths, header=True, center_cols=(), bold_first_col=False):
    data = []
    for r, row in enumerate(rows):
        cells = []
        for c, v in enumerate(row):
            if header and r == 0: cells.append(Paragraph(v, HEAD if c not in center_cols else ParagraphStyle("hc", parent=HEAD, alignment=TA_CENTER)))
            elif c in center_cols: cells.append(Paragraph(v, CENTER))
            elif bold_first_col and c == 0: cells.append(Paragraph(v, CELLB))
            else: cells.append(Paragraph(v, CELL))
        data.append(cells)
    t = Table(data, colWidths=[w * W for w in widths], repeatRows=1 if header else 0)
    st = [("GRID", (0, 0), (-1, -1), 0.5, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
          ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5), ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]
    if header:
        st += [("BACKGROUND", (0, 0), (-1, 0), NAVY)]
        st += [("BACKGROUND", (0, i), (-1, i), PAPER) for i in range(2, len(rows), 2)]
    else:
        st += [("BACKGROUND", (0, i), (-1, i), PAPER) for i in range(0, len(rows), 2)]
    t.setStyle(TableStyle(st))
    return [t, Spacer(1, 8)]


def flow_diagram():
    d = Drawing(W, 78)
    def node(x, w, label, fill, fg=colors.white):
        d.add(Rect(x, 36, w, 34, rx=6, ry=6, fillColor=fill, strokeColor=fill))
        lines = label.split("\n")
        for i, ln in enumerate(lines):
            d.add(String(x + w / 2, 56 - i * 12 + (6 if len(lines) == 1 else 0) - (6 if len(lines) == 1 else 0), ln, fontName="Malgun-Bold" if i == 0 else "Malgun", fontSize=9.5 if i == 0 else 8, fillColor=fg, textAnchor="middle"))
    def arrow(x1, x2, y=53):
        d.add(Line(x1, y, x2 - 5, y, strokeColor=SOFT, strokeWidth=1.4))
        d.add(Polygon([x2, y, x2 - 6, y + 3.5, x2 - 6, y - 3.5], fillColor=SOFT, strokeColor=SOFT))
    bw, gap = 100, (W - 4 * 100) / 3
    xs = [i * (bw + gap) for i in range(4)]
    node(xs[0], bw, "작성\n임시저장", colors.HexColor("#7C8696"))
    node(xs[1], bw, "결재상신\n결재 중", GOLD, NAVY)
    node(xs[2], bw, "단계별 승인\n결재선 순서대로", NAVY)
    node(xs[3], bw, "승인완료\n수정·삭제 불가", GREEN)
    for i in range(3): arrow(xs[i] + bw, xs[i + 1])
    # 반려/회수: 결재 중 → 임시저장 (아래로 돌아가는 선)
    y = 24
    d.add(Line(xs[2] + bw / 2, 36, xs[2] + bw / 2, y, strokeColor=RED, strokeWidth=1.2, strokeDashArray=[3, 2]))
    d.add(Line(xs[2] + bw / 2, y, xs[0] + bw / 2, y, strokeColor=RED, strokeWidth=1.2, strokeDashArray=[3, 2]))
    d.add(Line(xs[0] + bw / 2, y, xs[0] + bw / 2, 34, strokeColor=RED, strokeWidth=1.2, strokeDashArray=[3, 2]))
    d.add(Polygon([xs[0] + bw / 2, 36, xs[0] + bw / 2 - 3.5, 30, xs[0] + bw / 2 + 3.5, 30], fillColor=RED, strokeColor=RED))
    d.add(String((xs[0] + xs[2] + bw) / 2, 10, "반려(결재자) 또는 회수(작성자) → 수정 후 다시 상신", fontName="Malgun", fontSize=8.5, fillColor=RED, textAnchor="middle"))
    return d


# ───────────── 페이지 틀 ─────────────
def cover(canvas, doc):
    w, h = A4
    canvas.saveState()
    canvas.setFillColor(NAVY); canvas.rect(0, h * 0.50, w, h * 0.50, stroke=0, fill=1)
    canvas.setFillColor(GOLD); canvas.rect(20 * mm, h * 0.50 - 3, 46 * mm, 6, stroke=0, fill=1)
    canvas.setFillColor(colors.white)
    canvas.setFont("Malgun", 13); canvas.drawString(20 * mm, h - 62 * mm, "한수원노동조합")
    canvas.setFont("Malgun-Bold", 30); canvas.drawString(20 * mm, h - 80 * mm, "회계관리 시스템")
    canvas.setFont("Malgun-Bold", 22); canvas.drawString(20 * mm, h - 94 * mm, "서버판 사용 안내서")
    canvas.setFont("Malgun", 11); canvas.setFillColor(colors.HexColor("#D5DCE6"))
    canvas.drawString(20 * mm, h - 112 * mm, "로그인 · 역할별 사용법 · 설치 방법 · 문제 해결")
    canvas.setFillColor(INK); canvas.setFont("Malgun-Bold", 11)
    canvas.drawString(20 * mm, h * 0.50 - 28 * mm, "접속 주소")
    canvas.setFont("Malgun", 14); canvas.setFillColor(NAVY)
    canvas.drawString(20 * mm, h * 0.50 - 37 * mm, SITE)
    canvas.setFont("Malgun", 9.5); canvas.setFillColor(SOFT)
    canvas.drawString(20 * mm, h * 0.50 - 52 * mm, "웹 브라우저 · 안드로이드 앱 · PC 프로그램에서 같은 계정, 같은 데이터로 사용합니다.")
    canvas.drawString(20 * mm, 22 * mm, "2026년 10월 13일  ·  서버판 2.2")
    canvas.restoreState()


def page(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE); canvas.line(20 * mm, A4[1] - 15 * mm, A4[0] - 20 * mm, A4[1] - 15 * mm)
    canvas.setFont("Malgun", 8.5); canvas.setFillColor(SOFT)
    canvas.drawString(20 * mm, A4[1] - 12 * mm, "한수원노동조합 회계관리 시스템 (서버판) 사용 안내서")
    canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, f"{doc.page - 1}")
    canvas.restoreState()


doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=22 * mm, bottomMargin=20 * mm,
                      title="한수원노동조합 회계관리 시스템 (서버판) 사용 안내서", author="한수원노동조합", subject="서버판 사용 안내서")
frame = Frame(20 * mm, 20 * mm, W, A4[1] - 42 * mm, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([PageTemplate(id="cover", frames=[frame], onPage=cover, autoNextPageTemplate="body"), PageTemplate(id="body", frames=[frame], onPage=page)])

S = []
S += [Spacer(1, 1), PageBreak()]

# ───────────── 1. 달라진 점 ─────────────
S += [P("1. 이번에 무엇이 달라졌나요", H1)]
S += [P("예전 프로그램은 <b>한 대의 PC 안에 데이터를 저장</b>해서, 그 PC에서만 볼 수 있었고 누가 입력했는지도 알 수 없었습니다. "
        "서버판은 데이터를 <b>서버(Azure 클라우드)</b>에 저장하고 <b>담당자별 아이디와 비밀번호로 로그인</b>해서 사용합니다. "
        "여러 담당자가 한 곳의 같은 장부를 함께 쓰고, 맡은 역할에 따라 할 수 있는 일이 정해집니다.")]
S += table([
    ["항목", "예전 (PC 안에 저장하던 방식)", "서버판"],
    ["데이터 저장", "그 PC 한 대 안에만 저장", "서버에 저장 — 모든 담당자가 같은 데이터를 봄"],
    ["사용자 구분", "없음 (누구나 같은 화면)", "담당자별 아이디·비밀번호 로그인"],
    ["권한", "구분 없음", "역할별 권한 (조직관리자·회계담당·결재자·조회전용)"],
    ["결재", "화면에서 한 번에 승인", "결재선 단계별 승인, <b>누가 언제 승인했는지 기록</b>"],
    ["사용 기기", "설치한 PC 한 대", "웹 브라우저 · 안드로이드 앱 · PC 프로그램 (같은 계정)"],
    ["증빙 파일", "첨부한 PC에만 저장", "서버 저장소에 보관 — 어느 기기에서나 열람"],
    ["인터넷", "필요 없음", "<b>필요함</b> (로그인해서 사용)"],
], [0.18, 0.37, 0.45], bold_first_col=True)
S += box("데이터는 폰이나 PC에 저장되지 않고 서버에만 있습니다. 앱을 지우거나 기기를 바꿔도 같은 계정으로 로그인하면 그대로 이어서 쓸 수 있습니다.", "ok")

# ───────────── 2. 접속 방법 ─────────────
S += [P("2. 사용하는 방법 세 가지", H1)]
S += table([
    ["방법", "이렇게 열어요", "특징"],
    ["웹 브라우저", f"Chrome·Edge에서 <b>{SITE}</b> 접속", "설치 없이 바로 사용. 어느 PC·폰에서나 가능"],
    ["안드로이드 앱", "홈 화면의 <b>노조회계</b> 아이콘", "주소창 없는 앱 화면. 폰에서 <b>사진 촬영으로 영수증 첨부</b>"],
    ["PC 프로그램", "시작 메뉴·바탕화면의 <b>한수원노동조합 회계관리 시스템 (서버판)</b>", "화면 확대·축소(Ctrl+마우스 휠), 백업 파일 내려받기 지원"],
], [0.2, 0.42, 0.38], bold_first_col=True)
S += [P("세 방법 모두 <b>같은 계정, 같은 데이터</b>입니다. 폰에서 작성하던 전표를 PC에서 이어서 처리해도 됩니다. 설치 방법은 9장을 보세요.")]

# ───────────── 3. 처음 시작하기 ─────────────
S += [P("3. 처음 시작하기", H1)]
S += steps([
    "소속 조직의 <b>조직 관리자</b>에게 <b>아이디와 임시 비밀번호</b>를 받습니다.",
    f"{SITE} 에 접속해 아이디와 비밀번호를 입력하고 <b>로그인</b>합니다.",
    "임시 비밀번호로 처음 들어가면 <b>새 비밀번호를 정하는 화면</b>이 나옵니다. 본인만 아는 비밀번호로 바꾸면 사용을 시작할 수 있습니다.",
])
S += [Spacer(1, 4), KeepTogether([CondPageBreak(30 * mm), P("<b>비밀번호 규칙</b>", BASE)])]
S += bullets(["10자 이상, 영문과 숫자를 모두 포함", "아이디를 포함할 수 없음", "비밀번호는 대소문자를 구분합니다 (아이디는 구분하지 않음)"])
S += [Spacer(1, 4), P("<b>화면 구성</b>", BASE)]
S += bullets([
    "왼쪽(폰은 아래쪽) 메뉴: 대시보드, 회계결의서, 장부/원장, 예산관리, 재무제표, 조회, 자산관리, 계약관리, 연도 마감/이월, 설정/백업 (조직 관리자는 <b>계정 관리</b>가 더 보임)",
    "<b>왼쪽 아래</b>(폰은 <b>오른쪽 위</b>)의 내 이름 아이콘을 누르면 <b>비밀번호 변경</b>, <b>화면 모드(라이트·다크·시스템 설정)</b>, <b>로그아웃</b> 메뉴가 열립니다.",
    "오른쪽 위의 저장 상태 표시: <b>서버에 저장됨</b> / 저장 중... / 서버 저장 실패",
    "다른 담당자가 바꾼 내용은 <b>60초마다 자동으로</b> 반영됩니다. 바로 보려면 새로고침하세요.",
])
S += box("처음 접속하거나 한동안 쓰지 않은 뒤에는 \"데이터베이스를 깨우는 중입니다\"가 나오고 <b>최대 1분</b> 걸릴 수 있습니다. 고장이 아니며 자동으로 다시 시도하니 기다리면 됩니다.")
S += box("여러 사람이 쓰는 PC나 폰에서는 일을 마치면 반드시 <b>로그아웃</b>하세요. 로그인은 8시간 뒤에 자동으로 끝납니다.", "warn")

# ───────────── 4. 역할과 권한 ─────────────
S += [P("4. 역할과 권한", H1)]
S += [P("한 계정에는 <b>역할이 하나</b> 정해집니다. 화면에 보이지 않는 버튼은 그 역할이 할 수 없는 일이며, 화면을 우회해도 서버가 권한을 다시 확인해 막습니다.")]
S += table([
    ["할 수 있는 일", "조직관리자", "회계담당", "결재자", "조회전용"],
    ["전표·장부·재무제표 조회", "○", "○", "○", "○"],
    ["증빙 파일 열람", "○", "○", "○", "○"],
    ["전표 작성·수정·결재상신", "○", "○", "", ""],
    ["증빙 파일 올리기·삭제", "○", "○", "", ""],
    ["비품·계약 등록", "○", "○", "", ""],
    ["결재 승인·반려", "", "", "○ (본인 단계·대결)", ""],
    ["내 서명 등록 (도장 칸에 기록)", "", "", "○", ""],
    ["결재선 만들기·대결 지정", "○", "", "○ (본인 대결만)", ""],
    ["예산 편성·변경", "○", "", "", ""],
    ["연도 마감", "○", "", "", ""],
    ["승인된 전표의 승인취소 · 비품 삭제", "○", "", "", ""],
    ["계정 만들기·수정·비밀번호 초기화", "○", "", "", ""],
    ["백업 파일 서버로 가져오기", "○", "", "", ""],
], [0.40, 0.15, 0.15, 0.17, 0.13], center_cols=(1, 2, 3, 4))
S += [P("<b>결재자</b>는 계정을 만들 때 <b>결재선의 한 단계</b>(예: 사무장)가 지정되며, 그 단계의 차례일 때만 승인할 수 있습니다. "
        "결재자는 부재 중일 때 <b>대결자</b>를 지정할 수 있습니다 (5-3 참고). "
    "<b>시스템관리자</b>는 조직과 조직 관리자 계정을 만드는 전용 계정으로, 조직의 회계 데이터는 볼 수 없습니다.")]

# ───────────── 5. 전표 ─────────────
S += [P("5. 회계결의서 — 작성부터 승인까지", H1)]
S += [flow_diagram(), Spacer(1, 6)]
S += [P("5-1. 작성 (회계담당 · 조직관리자)", H2)]
S += steps([
    "메뉴 <b>회계결의서</b> → <b>새 회계결의서</b>를 누릅니다.",
    "작성일자, 전표구분(수입·지출·대체), 집행부서, <b>제목(필수)</b>, 목적을 입력하고 계정과목별 <b>차변·대변 금액</b>을 적습니다. 계정과목을 고르면 어느 쪽에 적어야 하는지 안내가 나옵니다.",
    "증빙이 있으면 <b>증빙 파일</b> 칸에서 첨부합니다 (6장).",
    "중간에 멈추려면 <b>임시저장</b>, 내용이 끝났으면 <b>결재상신</b>을 누릅니다. 상신은 <b>차변 합계와 대변 합계가 같을 때</b>만 눌러집니다.",
])
S += box("<b>문서번호</b>(예: 총무국-202610-001)는 저장할 때 서버가 자동으로 붙입니다. 여러 명이 동시에 작성해도 번호가 겹치지 않습니다.")
S += [P("5-2. 결재선", H2)]
S += table([
    ["조직 유형", "결재선 (순서대로)"],
    ["중앙", "담당국장 → 총무국장 → 사무처장 → 수석부위원장 → 중앙위원장"],
    ["본부", "사무장 → 부위원장 → 본부위원장"],
    ["지부", "사무장 → 부위원장 → 지부위원장"],
], [0.2, 0.8], bold_first_col=True)
S += [P("<b>결재선 선택 (상신할 때)</b>: 결재선을 하나 이상 만들어 두었다면 <b>결재상신</b>을 누를 때 결재선을 고르는 창이 나옵니다. "
        "<b>정식 결재선</b>은 위 표의 전체 단계이고, 관리자가 만든 결재선(예: 담당국장 → 중앙위원장 직상신)을 고르면 "
        "<b>선택하지 않은 중간 단계는 도장 칸에 \"생략\"과 가로선으로 표시</b>됩니다. 생략 사유를 적어 둘 수 있으며, 인쇄물에도 결재선이 함께 나옵니다. "
        "<b>최종 결재자(마지막 단계)는 모든 결재선에 반드시 포함</b>됩니다. 결재선은 <b>결재 설정</b> 메뉴에서 조직 관리자가 만듭니다.")]
S += [P("5-3. 결재 (결재자)", H2)]
S += bullets([
    "전표 목록의 상태에 <b>결재중 · 다음: ○○</b>로 지금 어느 단계 차례인지 표시됩니다.",
    "제목을 누르면 전표 내용을 <b>읽기 전용</b>으로 확인할 수 있고, 도장 칸에서 지금까지의 결재 현황이 보입니다.",
    "내 단계 차례인 전표에만 행 오른쪽에 <b>승인</b>(체크 모양)과 <b>반려</b>(X 모양) 버튼이 나타납니다. 승인하면 다음 단계로 넘어가고, 마지막 단계까지 승인되면 <b>승인완료</b>가 됩니다.",
    "<b>반려할 때는 사유를 꼭 입력</b>합니다. 지금까지의 결재는 초기화되고 작성자에게 반려 사유가 보입니다.",
    "단계를 건너뛰어 승인할 수 없고(결재선에서 생략된 단계는 제외), 본인이 작성한 전표는 본인이 승인할 수 없습니다. 한 전표를 같은 사람이 두 번 승인할 수도 없습니다.",
])
S += [P("<b>대결(代決)</b>: 결재자가 출장·휴가 등으로 자리를 비울 때, <b>결재 설정</b> 메뉴에서 <b>부재 기간과 대결자</b>를 지정합니다. "
        "그 기간 동안 대결자는 부재자 단계의 전표를 승인·반려할 수 있고, 도장 칸에는 <b>\"대결\"과 대결자 이름</b>이 표시됩니다(원 결재자는 인쇄물에 괄호로 남음). "
        "기간이 끝나면 자동으로 효력이 사라지며, 부재자 또는 조직 관리자가 중간에 취소할 수 있습니다. 조직 관리자는 모든 결재자의 대결을 지정할 수 있고, 결재자는 본인 단계만 지정할 수 있습니다.")]
S += [P("<b>내 서명 등록 (결재자)</b>: 왼쪽 아래 <b>계정 메뉴 → 내 서명</b>에서 서명 사진(PNG·JPG)을 올립니다. 흰 종이에 진하게 쓴 서명을 찍은 사진을 쓰면 "
        "<b>흰 배경은 지워지고 여백은 잘려</b> 도장 칸에 맞는 크기로 저장됩니다. 미리보기를 확인하고 <b>서명 저장</b>을 누르세요. "
        "이후 <b>승인하는 결재부터</b> 도장 칸에 내 서명과 이름이 기록되고(대결이면 \"대결\" 표시와 대결자 본인의 서명), 인쇄물과 증빙 포함 일괄인쇄에도 함께 나옵니다. "
        "서명을 바꾸거나 지워도 <b>이미 승인된 칸의 서명은 그대로</b> 남습니다. 서명을 등록하지 않으면 지금처럼 \"인\"이나 \"승인\"으로 표시됩니다. "
        "서명 이미지는 같은 조직 사용자에게만 보입니다.")]
S += [P("5-4. 반려 · 회수 · 수정", H2)]
S += table([
    ["상황", "어떻게 하나요"],
    ["반려된 전표", "목록에서 <b>수정</b> → 반려 사유를 확인하고 고친 뒤 다시 <b>결재상신</b>"],
    ["결재 중인데 고치고 싶을 때", "작성자(또는 조직관리자)가 <b>회수</b> → 임시저장 상태가 됨 (지금까지의 결재는 초기화) → 수정 후 다시 상신"],
    ["임시저장 전표를 없앨 때", "<b>삭제</b> (임시저장·반려 상태만 가능, 본인이 작성한 전표)"],
], [0.28, 0.72], bold_first_col=True)
S += [P("5-5. 승인된 전표", H2)]
S += [P("승인된 전표는 <b>수정도 삭제도 할 수 없습니다.</b> 잘못 승인된 경우에는 <b>조직 관리자</b>가 목록의 <b>승인취소</b>를 눌러 <b>사유를 적으면</b> 임시저장 상태로 돌아가며, "
        "취소한 사람과 사유가 전표에 남습니다. 다만 <b>마감된 회계연도의 전표</b>와 비품 취득·감가상각·결산이월처럼 <b>자동으로 만들어진 전표</b>는 승인취소할 수 없습니다.")]

# ───────────── 6. 증빙 ─────────────
S += [P("6. 증빙 파일 첨부", H1)]
S += steps([
    "전표 작성 화면(또는 계약 등록 화면)의 <b>증빙 파일</b> 칸에서 <b>+ 파일 추가</b>를 누르고 파일을 고릅니다. 여러 개를 한꺼번에 고를 수 있습니다.",
    "<b>폰·태블릿</b>에서는 <b>사진 촬영</b> 버튼으로 영수증을 바로 찍어 올릴 수 있습니다. 큰 사진은 올리기 전에 자동으로 줄어듭니다.",
    "목록의 <b>파일 이름</b>을 누르면 열립니다. PDF와 사진은 바로 보이고 한글·오피스 파일은 내려받아집니다.",
    "<b>전표를 임시저장하거나 결재상신해야</b> 첨부가 전표에 연결됩니다. 파일만 올리고 저장하지 않으면 연결되지 않습니다.",
])
S += table([
    ["항목", "내용"],
    ["올릴 수 있는 형식", "PDF, 사진(JPG·PNG·WEBP·HEIC), 한글(HWP·HWPX), 워드(DOC·DOCX), 엑셀(XLS·XLSX), 파워포인트(PPT·PPTX)"],
    ["크기", "파일 하나당 20MB 이하"],
    ["삭제", "작성 중에는 회계담당·조직관리자가 삭제. <b>결재 중이거나 승인된 전표의 증빙은 삭제할 수 없음</b> (증빙 보존)"],
    ["보관", "서버의 <b>비공개 저장소</b>에 조직별로 분리되어 보관. 다른 조직은 볼 수 없고, 열 때마다 짧은 시간만 유효한 주소가 발급됨"],
    ["\"(PC 전용)\" 표시", "예전 PC 프로그램에서 그 PC에만 저장했던 첨부입니다. 서버로 옮겨지지 않았으니 필요하면 다시 첨부하세요"],
], [0.22, 0.78], bold_first_col=True)
S += [P("6-1. 증빙 포함 일괄인쇄", H2)]
S += [P("결의서와 서버에 올려 둔 증빙을 <b>하나의 PDF로 합쳐서</b> 한 번에 인쇄합니다.")]
S += steps([
    "회계결의서 목록에서 전표 제목을 눌러 전표 화면을 엽니다. 서버에 올린 증빙이 있으면 아래쪽에 <b>증빙 포함 일괄인쇄 (건수)</b> 버튼이 보입니다.",
    "버튼을 누르면 잠시 뒤 <b>결의서 → 증빙 순서로 합쳐진 PDF</b>가 새 탭(PC 프로그램은 기본 PDF 프로그램)에서 열립니다. PDF 화면의 <b>인쇄</b> 버튼(또는 Ctrl+P)을 누르세요.",
    "결의서 쪽에는 결재 도장 칸과 승인한 사람·날짜가 함께 표시됩니다. 사진은 한 쪽에 한 장씩, 휴대폰으로 찍은 사진도 바르게 서도록 맞춰 들어갑니다.",
])
S += bullets([
    "<b>PDF와 사진(JPG·PNG·WEBP)</b>만 합쳐집니다. 한글·워드·엑셀·파워포인트·HEIC 파일은 합칠 수 없어 제외되며, 제외된 파일 이름이 화면에 안내됩니다. 그 파일은 직접 열어서 인쇄하세요.",
    "손으로 서명할 칸이 필요하면 <b>인쇄(서명용)</b> 버튼으로 결의서만 따로 출력할 수도 있습니다.",
    "휴대폰에서는 PDF가 열리거나 내려받아집니다. 인쇄는 PDF 보기 앱의 공유·인쇄 기능을 쓰세요.",
])
S += box("백업 파일(JSON)에는 첨부 파일의 <b>이름 정보만</b> 들어가고 파일 자체는 포함되지 않습니다. 삭제된 파일은 7일 동안 복구할 수 있습니다 (관리자에게 문의).")

# ───────────── 7. 조직 관리자 ─────────────
S += [P("7. 조직 관리자 업무", H1)]
S += [P("7-1. 계정 관리 — 담당자 계정 만들기", H2)]
S += steps([
    "메뉴 <b>계정 관리</b> → <b>계정 만들기</b>를 누릅니다.",
    "<b>아이디</b>(영문·숫자·. _ - 3~50자), <b>이름</b>, <b>역할</b>을 정합니다. 역할이 <b>결재자</b>이면 <b>결재 단계</b>도 고릅니다.",
    "<b>임시 비밀번호</b>가 화면에 <b>한 번만</b> 표시됩니다. 복사해서 본인에게 안전하게 전달하세요 (전화, 개인 메시지 등). 창을 닫으면 다시 볼 수 없습니다.",
])
S += table([
    ["버튼", "하는 일"],
    ["수정", "이름·역할·결재 단계를 바꿉니다. 바뀌면 그 담당자의 로그인이 즉시 종료되어 새 권한으로 다시 로그인합니다. 본인 역할은 바꿀 수 없습니다."],
    ["비밀번호 초기화", "새 임시 비밀번호를 발급합니다. 잠긴 계정이 풀리고, 지금까지의 로그인이 모두 종료되며, 다음 로그인 때 새 비밀번호로 바꾸게 됩니다."],
    ["비활성화 / 활성화", "퇴직·인사이동 시 <b>즉시 비활성화</b>하세요. 바로 로그아웃되고 로그인할 수 없습니다. 본인 계정은 비활성화할 수 없습니다."],
], [0.2, 0.8], bold_first_col=True)
S += [P("7-2. 기존 데이터를 서버로 옮기기", H2)]
S += [P("서버판을 쓰기 전에 PC 프로그램에 입력해 둔 데이터가 있다면 <b>조직 관리자가 한 번</b> 옮깁니다. 옮기기는 서버에 데이터가 하나도 없을 때만 되고, 한 번 옮기면 다시 할 수 없습니다.")]
S += bullets([
    "<b>방법 1</b> — 예전 프로그램을 쓰던 PC의 브라우저·프로그램으로 로그인하면 화면 위쪽에 <b>\"기존 데이터를 서버로 옮기기\"</b> 안내가 나옵니다. 누르면 백업 파일이 먼저 내려받아지고, 옮기기에 성공하면 그 PC의 로컬 데이터가 삭제됩니다.",
    "<b>방법 2</b> — 예전 프로그램의 <b>설정/백업</b>에서 백업 파일(.json)을 내려받아 두었다가, 서버판의 <b>설정/백업 → 백업 파일 서버로 가져오기</b>에서 불러옵니다.",
])
S += box("옮기기 전에는 예전 프로그램을 지우지 마세요. 옮긴 내용을 확인한 뒤에 정리하세요.", "warn")
S += [P("7-3. 예산 · 비품 · 계약 · 연도 마감", H2)]
S += bullets([
    "<b>예산편성</b>은 조직 관리자만 할 수 있습니다. 입력을 멈추면 자동으로 서버에 저장됩니다.",
    "<b>비품 등록</b>(회계담당도 가능)을 하면 취득 전표가 자동으로 만들어져 재무상태표에 반영됩니다. 비품 <b>삭제</b>는 조직 관리자만 가능하며, 마감된 연도의 감가상각 전표가 연결된 비품은 지울 수 없습니다.",
    "<b>연도 마감/이월</b>은 조직 관리자만 할 수 있습니다. 해당 연도에 <b>결재 중인 전표가 없어야</b> 하며, 마감하면 <b>되돌릴 수 없고</b> 그 연도의 전표·예산은 더 이상 바꿀 수 없습니다. 마감 전에 백업 파일을 내려받아 두세요.",
])
S += [P("7-4. 백업", H2)]
S += [P("<b>설정/백업 → 백업 파일 다운로드(.json)</b>로 현재 데이터를 파일로 받아 둘 수 있습니다. 서버가 자동으로 보관하지만, 월말·연도 마감 전처럼 중요한 시점에는 별도로 받아 두시길 권합니다.")]

# ───────────── 8. 시스템관리자 ─────────────
S += [P("8. 시스템관리자 업무", H1)]
S += [P("시스템관리자 계정으로 로그인하면 <b>조직 관리</b> 화면이 나옵니다.")]
S += bullets([
    "<b>조직 만들기</b>: 조직 이름, 유형(중앙·본부·지부 — 결재선이 자동 결정), 첫 <b>조직 관리자</b>의 아이디·이름을 입력하면 조직과 관리자 계정이 함께 만들어지고 <b>임시 비밀번호가 한 번</b> 표시됩니다.",
    "<b>관리자 계정</b>: 조직 관리자 계정을 추가하거나 비밀번호를 초기화합니다. (조직 관리자 외의 직원 계정은 그 조직의 조직 관리자가 만듭니다.)",
    "<b>비활성화</b>: 조직을 비활성화하면 그 조직의 모든 담당자가 즉시 로그아웃되고 로그인할 수 없게 됩니다.",
])
S += box("시스템관리자는 계정과 조직만 다루며 <b>조직의 전표·장부는 볼 수 없습니다.</b>")

# ───────────── 9. 설치 ─────────────
S += [P("9. 설치 방법", H1)]
S += [P("9-1. 안드로이드 앱 (홈 화면에 설치)", H2)]
S += steps([
    f"폰의 <b>Chrome</b>에서 <b>{SITE}</b> 를 엽니다.",
    "로그인 화면의 <b>\"이 기기에 앱으로 설치\"</b> 버튼을 누릅니다. 버튼이 보이지 않으면 Chrome 오른쪽 위 <b>점 세 개 메뉴</b>에서 <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 고릅니다.",
    "홈 화면에 남색 바탕의 <b>\"노조회계\"</b> 아이콘이 생깁니다. 눌러서 로그인합니다.",
])
S += bullets(["앱은 화면만 담고 있고 <b>회계 데이터는 폰에 저장되지 않습니다.</b> 인터넷이 없으면 \"서버에 연결할 수 없습니다\" 안내가 나옵니다.",
              "사이트가 개선되면 앱도 다음에 열 때 <b>자동으로 최신 화면</b>이 됩니다. 다시 설치할 필요가 없습니다.",
              "삼성 인터넷 등 다른 브라우저에서는 메뉴 이름이 다를 수 있어 Chrome을 권장합니다."])
S += [P("9-2. PC 프로그램 (Windows)", H2)]
S += steps([
    "<b>설치 파일 받기</b> — Windows PC의 웹 브라우저로 사이트에 접속하면 <b>로그인 화면 아래의 \"PC 프로그램 설치 파일 받기\"</b> 버튼으로 <b>KHNP-노동조합회계관리_서버판_설치프로그램.exe</b>를 내려받을 수 있습니다. 로그인한 뒤에는 화면 위쪽 안내(<b>다시 보지 않기</b>로 숨길 수 있음)와 <b>설정/백업</b> 화면의 \"PC 프로그램 (서버판)\" 카드에서도 받을 수 있습니다.",
    "내려받은 설치 파일을 더블클릭하고 안내창에서 <b>예</b>를 누릅니다. (관리자 권한 필요 없음)",
    "설치가 끝나면 시작 메뉴와 바탕화면에 <b>한수원노동조합 회계관리 시스템 (서버판)</b> 바로가기가 생깁니다.",
    "바로가기를 열면 서버 사이트가 프로그램 창으로 열립니다. 아이디로 로그인해서 사용합니다.",
])
S += bullets([
    "처음 실행할 때 Windows가 <b>\"PC를 보호했습니다\"</b> 경고를 띄우면 <b>추가 정보 → 실행</b>을 누르세요. 개인 배포용 프로그램에 디지털 서명이 없어서 나타나는 안내입니다. 출처가 확실한 설치 파일일 때만 실행하세요.",
    "인터넷이 끊기면 \"서버에 연결할 수 없습니다\" 화면과 <b>다시 연결</b> 버튼이 나옵니다.",
    "<b>Ctrl + 마우스 휠</b>로 화면을 확대·축소할 수 있어, 작은 노트북 화면에서도 아래 항목까지 볼 수 있습니다.",
    "설치 파일은 비공개 저장소에 있고, 받을 때마다 짧은 시간만 유효한 주소로 제공됩니다. (같은 PC에서 1시간에 10번까지) 새 버전이 나오면 같은 방법으로 받아 다시 설치하면 <b>덮어써서</b> 갱신됩니다. (서버 기능은 프로그램을 다시 설치하지 않아도 항상 최신입니다.)",
    "제거: <b>설정 → 앱 → 설치된 앱</b>에서 프로그램을 찾아 제거합니다. 서버의 회계 데이터는 영향을 받지 않습니다.",
    "예전 오프라인 프로그램과 <b>함께 설치</b>할 수 있습니다. 7-2의 데이터 이전을 마친 뒤 예전 프로그램을 정리하세요.",
])

# ───────────── 10. 보안 ─────────────
S += [P("10. 보안 수칙", H1)]
S += table([
    ["항목", "내용"],
    ["비밀번호 관리", "다른 사람과 공유하지 마세요. 임시 비밀번호는 받자마자 본인 비밀번호로 바꾸세요."],
    ["잠금", "비밀번호를 <b>5번 연속</b> 틀리면 계정이 <b>15분간 잠깁니다.</b> 급하면 조직 관리자에게 비밀번호 초기화를 요청하세요."],
    ["자동 로그아웃", "로그인은 <b>8시간</b> 뒤에 끝납니다. 비밀번호를 바꾸면 다른 기기의 로그인은 모두 종료됩니다."],
    ["기록", "로그인, 전표 작성·승인·반려·승인취소, 계정 발급·변경, 파일 업로드 등은 <b>누가 언제 했는지 서버에 기록</b>되며 수정·삭제할 수 없습니다."],
    ["퇴직·이동", "조직 관리자가 해당 계정을 <b>즉시 비활성화</b>합니다."],
    ["폰·PC 분실", "조직 관리자에게 <b>비밀번호 초기화</b>를 요청하면 기존 로그인이 모두 끝납니다. 기기에는 회계 데이터가 저장되어 있지 않습니다."],
], [0.2, 0.8], bold_first_col=True)

# ───────────── 11. FAQ ─────────────
S += [P("11. 문제가 생겼을 때", H1)]
S += table([
    ["이런 때", "이렇게 하세요"],
    ["\"아이디 또는 비밀번호가 올바르지 않습니다\"", "아이디와 비밀번호(대소문자 구분)를 확인하세요. 5번 틀려 잠겼다면 15분 뒤에 다시 하거나 조직 관리자에게 초기화를 요청하세요."],
    ["\"데이터베이스를 깨우는 중입니다\"", "정상입니다. 한동안 쓰지 않으면 절전 상태가 되어 첫 접속이 최대 1분 걸립니다. 기다리면 자동으로 이어집니다."],
    ["\"서버에 연결할 수 없습니다\"", "인터넷 연결을 확인한 뒤 <b>다시 시도</b>(PC 프로그램은 <b>다시 연결</b>)를 누르세요."],
    ["결재선 선택 창이 안 나와요", "조직 관리자가 <b>결재 설정</b>에서 추가 결재선을 만들지 않았다면 정식 결재선으로 바로 상신됩니다."],
    ["도장 칸에 서명이 안 나와요", "서명은 <b>등록한 뒤 승인한 결재부터</b> 기록됩니다. 계정 메뉴의 <b>내 서명</b>에서 등록했는지 확인하세요. 이미 승인된 칸은 나중에 등록해도 바뀌지 않습니다."],
    ["결재 버튼이 안 보여요", "내 결재 단계 차례가 아니거나(대결 지정이 없는 경우), 결재자 계정이 아니거나, 이미 승인 또는 반려가 끝난 전표일 수 있습니다. 목록의 \"다음: ○○\"를 확인하세요."],
    ["전표를 수정할 수 없어요", "결재 중이면 <b>회수</b> 후 수정, 승인된 전표는 조직 관리자의 <b>승인취소</b>가 필요합니다. 다른 사람이 작성한 전표는 수정할 수 없습니다 (조직 관리자 제외)."],
    ["\"다른 사용자가 먼저 수정했습니다\"", "새로고침해서 최신 내용을 확인한 뒤 다시 작성하세요."],
    ["\"○○회계연도는 마감되어…\"", "마감된 연도에는 전표·예산을 바꿀 수 없습니다. 다음 회계연도 일자로 작성하세요."],
    ["첨부 파일이 안 열려요", "\"(PC 전용)\"이 붙은 파일은 예전 프로그램에서 그 PC에만 저장된 것입니다. 서버에 다시 첨부하세요. 그 외에는 인터넷 연결을 확인하세요."],
    ["증빙 포함 일괄인쇄 버튼이 안 보여요", "서버에 올린 첨부가 있는 전표에만 나타납니다. \"(PC 전용)\" 표시 파일은 제외됩니다. PDF가 열리지 않으면 브라우저의 팝업 차단을 풀어 주세요."],
    ["파일이 올라가지 않아요", "20MB 이하인지, 지원하는 형식인지 확인하세요 (6장). 올린 뒤에는 전표를 저장해야 연결됩니다."],
    ["앱 설치 버튼이 안 보여요", "Chrome 오른쪽 위 점 세 개 메뉴의 <b>앱 설치 / 홈 화면에 추가</b>를 쓰세요. 이미 설치되어 있거나 시크릿 창이면 보이지 않을 수 있습니다."],
], [0.32, 0.68], bold_first_col=True)

S += box("<b>문의</b> — 로그인·계정·권한·비밀번호 초기화는 소속 조직의 <b>조직 관리자</b>에게, 조직 추가·조직 관리자 계정은 <b>시스템관리자</b>에게 문의하세요. "
         "사용 중 오류는 <b>화면에 나온 문구와 하던 작업</b>을 함께 알려 주세요.")

doc.build(S)
print("wrote", OUT)
