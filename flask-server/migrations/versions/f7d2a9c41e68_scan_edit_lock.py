"""scan edit lock

``scan_edit_lock`` - one row per dataset scan someone is editing right now: the scan, who holds it, and when the
hold lapses if their page goes quiet. Only one annotator edits a scan's shared version at a time; see
models/scan_edit_lock.py.

Purely additive and reversible: the table comes up empty and nothing existing is touched.

Revision ID: f7d2a9c41e68
Revises: e3c8b5a41f07
Create Date: 2026-11-23 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7d2a9c41e68'
down_revision: Union[str, None] = 'e3c8b5a41f07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'scan_edit_lock',
        sa.Column('case_key', sa.String(length=32), nullable=False),
        sa.Column('holder_id', sa.String(length=36), nullable=False),
        sa.Column('acquired_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['holder_id'], ['user_account.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('case_key'),
    )
    with op.batch_alter_table('scan_edit_lock', schema=None) as batch_op:
        batch_op.create_index('ix_scan_edit_lock_holder_id', ['holder_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('scan_edit_lock', schema=None) as batch_op:
        batch_op.drop_index('ix_scan_edit_lock_holder_id')
    op.drop_table('scan_edit_lock')
