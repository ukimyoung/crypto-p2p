-- Operator management from the console: the admin role is now called administrator,
-- and administrators can delete operator accounts.

ALTER TABLE operators DROP CONSTRAINT operators_role_check;
UPDATE operators SET role = 'administrator' WHERE role = 'admin';
ALTER TABLE operators ADD CONSTRAINT operators_role_check CHECK (role IN ('reviewer', 'administrator'));

-- Someone has to be able to manage operators. If no active operator is an administrator yet,
-- the first one created becomes one.
UPDATE operators SET role = 'administrator'
WHERE id = (SELECT id FROM operators WHERE status = 'active' ORDER BY created_at, id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM operators WHERE role = 'administrator' AND status = 'active');

-- A deleted operator keeps its row so audit logs and past decisions still show who acted.
-- Its email can be registered again.
ALTER TABLE operators DROP CONSTRAINT operators_status_check;
ALTER TABLE operators ADD CONSTRAINT operators_status_check CHECK (status IN ('active', 'disabled', 'deleted'));
ALTER TABLE operators DROP CONSTRAINT operators_email_key;
CREATE UNIQUE INDEX operators_email_uq ON operators (email) WHERE status <> 'deleted';
ALTER TABLE operators ADD COLUMN updated_at timestamptz;
