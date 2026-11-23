"""project scans

``project_scan`` - the index of the scans project owners have uploaded into their projects: the project's own case number,
the id the viewer uses, the original file name, modality, size, hash, geometry and who uploaded it.

Purely additive and reversible: the table comes up empty and nothing existing is touched.

Revision ID: e3c8b5a41f07
Revises: d1f6a39b8c52
Create Date: 2026-11-21 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3c8b5a41f07'
down_revision: Union[str, None] = 'd1f6a39b8c52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'project_scan',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('project_id', sa.String(length=36), nullable=False),
        sa.Column('number', sa.Integer(), nullable=False),
        sa.Column('case_id', sa.String(length=32), nullable=False),
        sa.Column('original_name', sa.String(length=255), nullable=False),
        sa.Column('modality', sa.String(length=8), nullable=False),
        sa.Column('size_bytes', sa.BigInteger(), nullable=False),
        sa.Column('sha256', sa.String(length=64), nullable=False),
        sa.Column('shape', sa.Text(), nullable=False),
        sa.Column('spacing', sa.Text(), nullable=False),
        sa.Column('uploaded_by', sa.String(length=36), nullable=True),
        sa.Column('uploaded_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['project.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['uploaded_by'], ['user_account.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('case_id'),
        sa.UniqueConstraint('project_id', 'number', name='uq_project_scan_project_id_number'),
        sa.UniqueConstraint('project_id', 'sha256', name='uq_project_scan_project_id_sha256'),
    )
    with op.batch_alter_table('project_scan', schema=None) as batch_op:
        batch_op.create_index('ix_project_scan_project_id', ['project_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('project_scan', schema=None) as batch_op:
        batch_op.drop_index('ix_project_scan_project_id')
    op.drop_table('project_scan')
