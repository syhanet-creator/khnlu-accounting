-- 결재자 서명 이미지 + 결재 시 서명 기록
-- Azure 포털 > SQL 데이터베이스 > Query editor 에서 실행한다. 여러 번 실행해도 안전하다(이미 있으면 건너뜀).

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
