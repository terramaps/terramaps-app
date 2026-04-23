"""Background tasks for map operations."""

import logging

from src.models.graph import MapModel
from src.models.jobs import MapJobModel
from src.services.computation import ComputationService
from src.workers import DatabaseTask, celery_app

logger = logging.getLogger(__name__)


def _set_job_status(
    task: DatabaseTask,
    job: MapJobModel,
    status: str,
    step: str | None = None,
    error: str | None = None,
) -> None:
    job.status = status  # type: ignore[assignment]
    if step is not None:
        job.step = step
    if error is not None:
        job.error = error
    task.db.flush()
    task.db.commit()


@celery_app.task(base=DatabaseTask, bind=True, queue="terramaps", name="src.workers.tasks.maps.import_map_task")
def import_map_task(self: DatabaseTask, job_id: str, map_id: str) -> None:  # type: ignore[misc]
    """Compute geometry and data aggregations for a newly imported map.

    Runs a full bottom-to-top recompute for all layers since every node is new.
    """
    job = self.db.get(MapJobModel, job_id)
    if not job:
        logger.error("import_map_task: job %s not found", job_id)
        return
    try:
        computation = ComputationService(db=self.db)

        _set_job_status(self, job, "processing", step="Computing geometry")
        layers = computation.recompute_all_layers(map_id)
        logger.info("[%s]: geometry complete, %d layers", job_id, len(layers))
        if layers:
            map_model = self.db.get(MapModel, map_id)
            if map_model:
                map_model.tile_version += 1
            self.db.flush()
        _set_job_status(self, job, "complete", step="Done")
        logger.info("[%s]: complete", job_id)
    except Exception as exc:
        logger.exception("import_map_task [%s]: failed", job_id)
        _set_job_status(self, job, "failed", error=str(exc))
        raise
