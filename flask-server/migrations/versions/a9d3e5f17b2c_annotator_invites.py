"""annotator invitation codes

``annotator_invite`` - one row per temporary, single-use code an admin hands out so another account can
become an annotator (save a dataset scan's segmentation for everyone). Only the code's SHA-256 digest is
stored.

Purely additive and reversible: the table comes up empty and nothing existing is touched.

Revision ID: a9d3e5f17b2c
Revises: b72e86dc109a
Create Date: 2026-11-06 22:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a9d3e5f17b2c'
down_revision: Union[str, None] = 'b72e86dc109a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'annotator_invite',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('code_hash', sa.String(length=64), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('redeemed_by', sa.String(length=36), nullable=True),
        sa.Column('redeemed_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['user_account.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['redeemed_by'], ['user_account.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('annotator_invite', schema=None) as batch_op:
        batch_op.create_index('ix_annotator_invite_code_hash', ['code_hash'], unique=True)
        batch_op.create_index('ix_annotator_invite_expires_at', ['expires_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('annotator_invite', schema=None) as batch_op:
        batch_op.drop_index('ix_annotator_invite_expires_at')
        batch_op.drop_index('ix_annotator_invite_code_hash')
    op.drop_table('annotator_invite')
