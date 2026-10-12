-- 한수원노동조합 회계관리 시스템 - Azure SQL Database 스키마 (v1)
-- 실행 방법: Azure 포털 > SQL 데이터베이스 > Query editor 에서 전체를 붙여넣고 실행한다.
-- (Query editor는 GO 구문을 지원하지 않으므로 사용하지 않는다. 문장은 세미콜론으로 구분한다.)
-- 설계 배경은 docs/SERVER_DESIGN.md 참고.

-- ===== 조직(중앙/본부/지부) =====
CREATE TABLE dbo.organizations (
  id             INT IDENTITY(1,1) PRIMARY KEY,
  name           NVARCHAR(100) NOT NULL,
  org_type       VARCHAR(20)   NOT NULL CHECK (org_type IN ('central','headquarters','branch')),
  approval_steps NVARCHAR(MAX) NOT NULL CHECK (ISJSON(approval_steps) = 1),  -- 결재선 JSON 배열 ["사무장","부위원장",...]
  settings       NVARCHAR(MAX) NOT NULL DEFAULT '{}' CHECK (ISJSON(settings) = 1),
  current_fy     INT           NOT NULL,
  is_active      BIT           NOT NULL DEFAULT 1,
  created_at     DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UX_organizations_name UNIQUE (name)
);

-- ===== 사용자 =====
-- role: super(시스템관리자, 조직 없음) / admin(조직관리자) / accountant(회계담당) / approver(결재자) / viewer(조회전용)
-- approval_step: approver 가 승인할 수 있는 결재선 단계 이름(조직의 approval_steps 중 하나)
CREATE TABLE dbo.users (
  id                   INT IDENTITY(1,1) PRIMARY KEY,
  org_id               INT NULL REFERENCES dbo.organizations(id),
  login_id             NVARCHAR(50)  NOT NULL,
  display_name         NVARCHAR(50)  NOT NULL,
  password_hash        VARCHAR(200)  NOT NULL,          -- scrypt 해시(솔트 포함). 평문은 어디에도 저장하지 않는다.
  role                 VARCHAR(20)   NOT NULL CHECK (role IN ('super','admin','accountant','approver','viewer')),
  approval_step        NVARCHAR(50)  NULL,
  is_active            BIT           NOT NULL DEFAULT 1,
  must_change_password BIT           NOT NULL DEFAULT 1,
  failed_attempts      INT           NOT NULL DEFAULT 0,
  locked_until         DATETIME2(0)  NULL,
  last_login_at        DATETIME2(0)  NULL,
  created_at           DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  created_by           INT           NULL,
  CONSTRAINT UX_users_login UNIQUE (login_id),
  CONSTRAINT CK_users_org CHECK ((role = 'super' AND org_id IS NULL) OR (role <> 'super' AND org_id IS NOT NULL)),
  CONSTRAINT CK_users_step CHECK (role = 'approver' OR approval_step IS NULL)
);

-- ===== 로그인 세션 (토큰 원문은 저장하지 않고 SHA-256 해시만 저장 → 서버에서 즉시 폐기 가능) =====
CREATE TABLE dbo.sessions (
  token_hash   CHAR(64)      NOT NULL PRIMARY KEY,
  user_id      INT           NOT NULL REFERENCES dbo.users(id),
  created_at   DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  expires_at   DATETIME2(0)  NOT NULL,
  last_seen_at DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  ip           VARCHAR(45)   NULL,
  user_agent   NVARCHAR(200) NULL
);
CREATE INDEX IX_sessions_user ON dbo.sessions(user_id);

-- ===== 전표(회계결의서) =====
-- 조회·검색용 컬럼 + 원본 전체(JSON). 모든 행은 org_id 로 조직이 분리되며, org_id 는 항상 로그인 세션에서 가져온다.
CREATE TABLE dbo.vouchers (
  org_id       INT           NOT NULL REFERENCES dbo.organizations(id),
  id           VARCHAR(40)   NOT NULL,
  doc_no       NVARCHAR(40)  NOT NULL,                  -- 서버가 채번 (동시 입력 시 중복 방지)
  voucher_date DATE          NOT NULL,
  title        NVARCHAR(200) NOT NULL DEFAULT '',
  voucher_type VARCHAR(20)   NOT NULL,                  -- income | expense | transfer
  status       VARCHAR(20)   NOT NULL CHECK (status IN ('draft','pending','approved','rejected')),
  body         NVARCHAR(MAX) NOT NULL CHECK (ISJSON(body) = 1),
  version      INT           NOT NULL DEFAULT 1,        -- 낙관적 동시성 제어(동시에 같은 전표를 고치면 한쪽에 충돌 안내)
  created_by   INT           NOT NULL REFERENCES dbo.users(id),
  created_at   DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_by   INT           NOT NULL REFERENCES dbo.users(id),
  updated_at   DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_vouchers PRIMARY KEY (org_id, id),
  CONSTRAINT UX_vouchers_docno UNIQUE (org_id, doc_no)
);
CREATE INDEX IX_vouchers_date ON dbo.vouchers(org_id, voucher_date);
CREATE INDEX IX_vouchers_status ON dbo.vouchers(org_id, status);

-- 결재 이력: 누가 어느 단계를 승인했는지 서버가 기록한다(화면에서 임의로 만들 수 없음).
CREATE TABLE dbo.voucher_approvals (
  org_id      INT          NOT NULL,
  voucher_id  VARCHAR(40)  NOT NULL,
  step_name   NVARCHAR(50) NOT NULL,
  approved_by INT          NOT NULL REFERENCES dbo.users(id),
  approved_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_voucher_approvals PRIMARY KEY (org_id, voucher_id, step_name),
  CONSTRAINT FK_voucher_approvals_voucher FOREIGN KEY (org_id, voucher_id)
    REFERENCES dbo.vouchers(org_id, id) ON DELETE CASCADE
);

-- 전표번호 채번용 (조직 + 연월별 순번)
CREATE TABLE dbo.doc_counters (
  org_id  INT     NOT NULL REFERENCES dbo.organizations(id),
  ym      CHAR(6) NOT NULL,
  last_no INT     NOT NULL DEFAULT 0,
  CONSTRAINT PK_doc_counters PRIMARY KEY (org_id, ym)
);

-- ===== 그 외 업무 데이터(예산·예산변경·비품·계약·연도마감) =====
-- kind: budget(id=회계연도) | budgetRevision | asset | contract | yearClosing(id=회계연도)
CREATE TABLE dbo.records (
  org_id     INT           NOT NULL REFERENCES dbo.organizations(id),
  kind       VARCHAR(20)   NOT NULL CHECK (kind IN ('budget','budgetRevision','asset','contract','yearClosing')),
  id         VARCHAR(40)   NOT NULL,
  body       NVARCHAR(MAX) NOT NULL CHECK (ISJSON(body) = 1),
  version    INT           NOT NULL DEFAULT 1,
  updated_by INT           NOT NULL REFERENCES dbo.users(id),
  updated_at DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_records PRIMARY KEY (org_id, kind, id)
);

-- ===== 감사 로그 (추가만 가능, 수정/삭제는 아래에서 앱 계정에 금지) =====
CREATE TABLE dbo.audit_log (
  id       BIGINT IDENTITY(1,1) PRIMARY KEY,
  at       DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  org_id   INT           NULL,
  user_id  INT           NULL,
  login_id NVARCHAR(50)  NULL,
  action   VARCHAR(40)   NOT NULL,   -- login, login_fail, voucher_create, voucher_approve, user_create ...
  target   NVARCHAR(100) NULL,
  detail   NVARCHAR(MAX) NULL,
  ip       VARCHAR(45)   NULL
);
CREATE INDEX IX_audit_org_at ON dbo.audit_log(org_id, at);

-- ===== 앱 전용 DB 계정 (최소 권한) =====
-- 아래 2줄은 <앱계정 비밀번호> 를 직접 정한 강한 비밀번호로 바꾼 뒤 실행한다. (채팅에 붙여넣지 말 것)
-- 관리자 계정은 이 스키마를 만들 때만 쓰고, Vercel 에는 이 앱 계정(app_user)만 등록한다.
-- CREATE USER app_user WITH PASSWORD = '<앱계정 비밀번호>';
-- ALTER ROLE db_datareader ADD MEMBER app_user;
-- ALTER ROLE db_datawriter ADD MEMBER app_user;
-- DENY UPDATE, DELETE ON dbo.audit_log TO app_user;

-- ===== (2026-10-13) 결재선 선택 · 대결 — db/migrations/2026-10-13_approval_lines.sql 과 동일 =====
-- 1) 조직별 허용 결재선: 작성자는 상신할 때 이 목록(+ 기본 "정식 결재선")에서만 고른다. 마지막 결재자는 항상 포함되어야 한다(서버가 검사).
IF OBJECT_ID('dbo.approval_lines', 'U') IS NULL
CREATE TABLE dbo.approval_lines (
  id         INT IDENTITY(1,1) PRIMARY KEY,
  org_id     INT           NOT NULL REFERENCES dbo.organizations(id),
  name       NVARCHAR(40)  NOT NULL,
  steps      NVARCHAR(MAX) NOT NULL CHECK (ISJSON(steps) = 1),   -- 결재 단계 이름 JSON 배열(조직 결재선의 부분 순서)
  is_active  BIT           NOT NULL DEFAULT 1,
  created_by INT           NULL,
  created_at DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UX_approval_lines_name UNIQUE (org_id, name)
);

-- 2) 대결: 부재 기간 동안 지정한 결재자(대결자)가 해당 단계를 대신 승인할 수 있다.
IF OBJECT_ID('dbo.approval_delegations', 'U') IS NULL
CREATE TABLE dbo.approval_delegations (
  id               INT IDENTITY(1,1) PRIMARY KEY,
  org_id           INT          NOT NULL REFERENCES dbo.organizations(id),
  step_name        NVARCHAR(50) NOT NULL,
  absent_user_id   INT          NOT NULL REFERENCES dbo.users(id),   -- 원래 결재자(부재자)
  delegate_user_id INT          NOT NULL REFERENCES dbo.users(id),   -- 대결자
  from_date        DATE         NOT NULL,
  to_date          DATE         NOT NULL,
  note             NVARCHAR(100) NULL,
  is_active        BIT          NOT NULL DEFAULT 1,
  created_by       INT          NOT NULL,
  created_at       DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_delegation_dates CHECK (to_date >= from_date),
  CONSTRAINT CK_delegation_diff CHECK (absent_user_id <> delegate_user_id)
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_delegations_lookup')
CREATE INDEX IX_delegations_lookup ON dbo.approval_delegations(org_id, step_name, delegate_user_id, is_active);

-- 3) 대결로 승인한 경우 원래 결재자를 기록한다.
IF COL_LENGTH('dbo.voucher_approvals', 'acting_for_user_id') IS NULL
ALTER TABLE dbo.voucher_approvals ADD acting_for_user_id INT NULL REFERENCES dbo.users(id);

SELECT 'ok' AS result,
       (SELECT COUNT(*) FROM sys.tables WHERE name IN ('approval_lines','approval_delegations')) AS new_tables,
       (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.voucher_approvals') AND name = 'acting_for_user_id') AS new_column;

-- ===== 결재자 서명 (2026-10-13) =====
-- 1) 서명 이미지(PNG)를 올릴 때마다 한 행씩 쌓는다. 이미 결재에 쓰인 서명은 이후 바뀌어도 그 결재 칸에는 당시 서명이 남는다.
IF OBJECT_ID('dbo.user_signatures', 'U') IS NULL
CREATE TABLE dbo.user_signatures (
  id         INT IDENTITY(1,1) PRIMARY KEY,
  org_id     INT            NOT NULL REFERENCES dbo.organizations(id),
  user_id    INT            NOT NULL REFERENCES dbo.users(id),
  mime       VARCHAR(20)    NOT NULL,
  data       VARBINARY(MAX) NOT NULL,
  width      INT            NOT NULL,
  height     INT            NOT NULL,
  created_at DATETIME2(0)   NOT NULL DEFAULT SYSUTCDATETIME()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_user_signatures_user' AND object_id = OBJECT_ID('dbo.user_signatures'))
CREATE INDEX IX_user_signatures_user ON dbo.user_signatures (org_id, user_id);

-- 2) 계정의 현재 서명, 결재 기록에 남는 서명
IF COL_LENGTH('dbo.users', 'signature_id') IS NULL
ALTER TABLE dbo.users ADD signature_id INT NULL;

IF COL_LENGTH('dbo.voucher_approvals', 'signature_id') IS NULL
ALTER TABLE dbo.voucher_approvals ADD signature_id INT NULL;

SELECT 'ok' AS result,
       (SELECT COUNT(*) FROM sys.tables WHERE name = 'user_signatures') AS new_table,
       (SELECT COUNT(*) FROM sys.columns WHERE name = 'signature_id' AND object_id IN (OBJECT_ID('dbo.users'), OBJECT_ID('dbo.voucher_approvals'))) AS new_columns;
