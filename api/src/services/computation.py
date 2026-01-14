"""Computation service for graph geometry roll-ups."""

import logging
from collections.abc import Sequence
from typing import Annotated

from fastapi import Depends
from geoalchemy2.elements import WKBElement
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from src.app.database import DatabaseSession
from src.models.graph import NodeModel
from src.services.base import BaseService

logger = logging.getLogger(__name__)


class ComputationService(BaseService):
    """Compute derived data for graph nodes."""

    def compute_geometry(self, db: Session, node: NodeModel) -> WKBElement | None:
        """Compute or reuse union geometry for a node using Postgres-side hash comparison.

        Performs a post-order traversal: children first, then a single SQL statement
        that (1) aggregates child inputs, (2) hashes them in SQL (md5), (3) conditionally
        updates the parent geometry only if inputs changed or geom is NULL.
        """
        children = self._get_children(db, node.id)
        if children:
            for child in children:
                self.compute_geometry(db, child)

            # Single SQL: build signature, compute hash, union, conditional update
            stmt = text(
                """
                WITH child_data AS (
                  SELECT :parent_id AS pid,
                         STRING_AGG(c.id::text || ':' || COALESCE(c.geom_cache_key,'null'), ';' ORDER BY c.id) AS signature,
                         ARRAY_AGG(c.id ORDER BY c.id) AS child_ids
                  FROM nodes c
                  WHERE c.parent_node_id = :parent_id
                ), calc AS (
                  SELECT pid,
                         signature,
                         md5(signature) AS inputs_hash,
                         (
                           SELECT ST_UnaryUnion(ST_Collect(ST_MakeValid(n.geom)))
                           FROM nodes n
                           WHERE n.id = ANY(child_ids) AND n.geom IS NOT NULL
                         ) AS union_geom
                  FROM child_data
                ), upd AS (
                  UPDATE nodes p
                  SET geom = calc.union_geom,
                      geom_inputs_cache_key = calc.inputs_hash,
                      geom_cache_key = md5(ST_AsEWKB(calc.union_geom)::text)
                  FROM calc
                  WHERE p.id = calc.pid
                    AND calc.union_geom IS NOT NULL
                    AND (
                      p.geom_inputs_cache_key IS DISTINCT FROM calc.inputs_hash OR p.geom IS NULL
                    )
                  RETURNING p.geom
                )
                SELECT geom FROM upd
                UNION ALL
                SELECT p.geom FROM nodes p WHERE p.id = :parent_id AND NOT EXISTS (SELECT 1 FROM upd)
                """
            )
            new_geom = db.execute(stmt, {"parent_id": node.id}).scalar()
            if new_geom is not None:
                node.geom = new_geom
        return node.geom

    def bulk_recompute_layer(self, layer_id: int, force: bool = False) -> dict[str, object]:
        """Bulk recompute geometries for all parent nodes in a layer.

        Performs set-based signature hashing to detect which parents need recompute unless
        `force=True`, in which case all parents found with children are recomputed.

        Returns timing metrics and counts similar to benchmark output.
        """
        import time

        start = time.perf_counter()
        grouping_sql = text(
            """
            WITH child_groups AS (
              SELECT c.parent_node_id AS pid,
                     STRING_AGG(c.id::text || ':' || COALESCE(c.geom_cache_key,'null'), ';' ORDER BY c.id) AS signature,
                     COUNT(*) AS child_count
              FROM nodes c
              JOIN nodes p ON p.id = c.parent_node_id
              WHERE p.layer_id = :layer_id
              GROUP BY c.parent_node_id
            )
            SELECT cg.pid,
                   md5(cg.signature) AS inputs_hash,
                   p.geom_inputs_cache_key AS existing_hash,
                   cg.child_count
            FROM child_groups cg
            JOIN nodes p ON p.id = cg.pid
            """
        )
        rows = self.db.execute(grouping_sql, {"layer_id": layer_id}).mappings().all()
        grouping_ms = (time.perf_counter() - start) * 1000.0

        if force:
            changed_parent_ids = [r["pid"] for r in rows]
        else:
            changed_parent_ids = [
                r["pid"] for r in rows if r["existing_hash"] != r["inputs_hash"] or r["existing_hash"] is None
            ]

        if not changed_parent_ids:
            total_ms = (time.perf_counter() - start) * 1000.0
            return {
                "layer_id": layer_id,
                "parents_considered": len(rows),
                "parents_recomputed": 0,
                "timing_ms": {
                    "grouping": round(grouping_ms, 2),
                    "union_and_update": 0.0,
                    "total": round(total_ms, 2),
                    "avg_per_parent": 0.0,
                },
                "notes": {"message": "No parents needed recompute", "force": force},
            }

        union_start = time.perf_counter()
        union_update_sql = text(
            """
            WITH changed AS (
              SELECT p.id AS pid
              FROM nodes p
              WHERE p.id = ANY(:changed_ids)
            ), child_data AS (
              SELECT ch.pid,
                     STRING_AGG(c.id::text || ':' || COALESCE(c.geom_cache_key,'null'), ';' ORDER BY c.id) AS signature
              FROM changed ch
              JOIN nodes c ON c.parent_node_id = ch.pid
              GROUP BY ch.pid
            ), calc AS (
              SELECT pid,
                     md5(signature) AS inputs_hash,
                     (
                       SELECT ST_UnaryUnion(ST_Collect(ST_MakeValid(n.geom)))
                       FROM nodes n WHERE n.parent_node_id = pid AND n.geom IS NOT NULL
                     ) AS union_geom
              FROM child_data
            ), upd AS (
              UPDATE nodes p
              SET geom = calc.union_geom,
                  geom_inputs_cache_key = calc.inputs_hash,
                  geom_cache_key = md5(ST_AsEWKB(calc.union_geom)::text)
              FROM calc
              WHERE p.id = calc.pid
                AND calc.union_geom IS NOT NULL
                AND (
                  p.geom_inputs_cache_key IS DISTINCT FROM calc.inputs_hash OR p.geom IS NULL OR :force
                )
              RETURNING p.id
            )
            SELECT COUNT(*) AS updated_count FROM upd;
            """
        )
        updated_count = (
            self.db.execute(union_update_sql, {"changed_ids": changed_parent_ids, "force": force}).scalar() or 0
        )
        if updated_count:
            self.db.flush()
        union_ms = (time.perf_counter() - union_start) * 1000.0
        total_ms = (time.perf_counter() - start) * 1000.0

        avg_per_parent = union_ms / updated_count if updated_count else 0.0

        return {
            "layer_id": layer_id,
            "parents_considered": len(rows),
            "parents_recomputed": int(updated_count),
            "timing_ms": {
                "grouping": round(grouping_ms, 2),
                "union_and_update": round(union_ms, 2),
                "total": round(total_ms, 2),
                "avg_per_parent": round(avg_per_parent, 2),
            },
            "notes": {"changed_parent_ids_sample": changed_parent_ids[:10], "force": force},
        }

    @staticmethod
    def _get_children(db: Session, parent_id: int) -> Sequence[NodeModel]:
        rows = db.execute(select(NodeModel).where(NodeModel.parent_node_id == parent_id)).scalars().all()
        return rows


def get_computation_service(db: DatabaseSession) -> ComputationService:
    """Get computation service."""
    return ComputationService(db=db)


ComputationServiceDependency = Annotated[ComputationService, Depends(get_computation_service)]
