-- 결재선 선택(직상신/생략) + 대결(부재 기간 대리 결재) 지원
-- Azure 포털 > SQL 데이터베이스 > Query editor 에서 실행한다. 여러 번 실행해도 안전하다(이미 있으면 건너뜀).

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
