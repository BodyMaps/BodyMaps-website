"""projects and project members

``project`` - a group of people working on a set of cases; the row ``jhu`` is the built-in project for the existing library.
``project_member`` - one role (owner or collaborator) per person per project. The ``jhu`` project's people are the accounts
holding the annotation_manager / annotator roles, so nothing is copied for it.

Purely additive and reversible: the only row written is the built-in ``jhu`` project, and nothing existing is touched.

Revision ID: c4a8e61b7d09
Revises: b8e41d6a2f93
Create Date: 2026-11-20 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4a8e61b7d09'
down_revision: Union[str, None] = 'b8e41d6a2f93'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    project = op.create_table(
        'project',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('slug', sa.String(length=80), nullable=False),
        sa.Column('is_default', sa.Boolean(), nullable=False),
        sa.Column('allow_training', sa.Boolean(), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['user_account.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('slug'),
    )
    op.create_table(
        'project_member',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('project_id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False),
        sa.Column('added_by', sa.String(length=36), nullable=True),
        sa.Column('added_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['project.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user_account.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['added_by'], ['user_account.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'user_id', name='uq_project_member_project_id_user_id'),
    )
    with op.batch_alter_table('project_member', schema=None) as batch_op:
        batch_op.create_index('ix_project_member_project_id', ['project_id'], unique=False)
        batch_op.create_index('ix_project_member_user_id', ['user_id'], unique=False)
    from datetime import datetime
    op.bulk_insert(project, [{
        'id': 'jhu', 'name': 'JHU', 'slug': 'jhu', 'is_default': True, 'allow_training': False,
        'created_by': None, 'created_at': datetime.utcnow(),
    }])


def downgrade() -> None:
    with op.batch_alter_table('project_member', schema=None) as batch_op:
        batch_op.drop_index('ix_project_member_user_id')
        batch_op.drop_index('ix_project_member_project_id')
    op.drop_table('project_member')
    op.drop_table('project')
