"""assignments belong to a project

``annotation_assignment.project_id`` - the project an assignment's cases belong to. Every existing assignment is
handed to the built-in ``jhu`` project (added by the previous migration), so nothing about the current team's work moves.

Reversible: downgrade drops the column.

Revision ID: d1f6a39b8c52
Revises: c4a8e61b7d09
Create Date: 2026-11-20 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1f6a39b8c52'
down_revision: Union[str, None] = 'c4a8e61b7d09'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('annotation_assignment', schema=None) as batch_op:
        batch_op.add_column(sa.Column('project_id', sa.String(length=36), nullable=False, server_default='jhu'))
        batch_op.create_foreign_key(
            'fk_annotation_assignment_project_id_project', 'project', ['project_id'], ['id'], ondelete='CASCADE',
        )
        batch_op.create_index('ix_annotation_assignment_project_id', ['project_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('annotation_assignment', schema=None) as batch_op:
        batch_op.drop_index('ix_annotation_assignment_project_id')
        batch_op.drop_constraint('fk_annotation_assignment_project_id_project', type_='foreignkey')
        batch_op.drop_column('project_id')
