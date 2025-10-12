from __future__ import annotations

from typing import Dict, List, Literal, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.fitters.search import fit as fit_curve

router = APIRouter(prefix="/fit", tags=["fit"])


class DataPoint(BaseModel):
    t: float = Field(..., description="time in minutes")
    s: float = Field(..., description="drawdown in metres")


class FitRequest(BaseModel):
    r: float = Field(..., description="observation radius (m)")
    Q: float = Field(..., description="pumping rate (m^3/h)")
    data: List[DataPoint]
    model: Literal["lagging", "theis"] = "lagging"
    priors: Optional[Dict[str, float]] = None
    conf: float = 0.95


def _coverage_buckets(times_seconds: np.ndarray) -> Dict[str, float]:
    if len(times_seconds) == 0:
        return {"early": 0.0, "mid": 0.0, "late": 0.0}

    log_t = np.log10(np.clip(times_seconds, 1e-12, None))
    edges = np.percentile(log_t, [33.3, 66.6])
    early = np.mean(log_t <= edges[0])
    late = np.mean(log_t >= edges[1])
    mid = 1.0 - early - late
    return {"early": float(early), "mid": float(mid), "late": float(late)}


@router.post("")
def fit(req: FitRequest):
    if not req.data:
        raise HTTPException(status_code=400, detail="data must contain at least one point")

    data = sorted(req.data, key=lambda d: d.t)
    times_minutes = np.array([point.t for point in data], dtype=float)
    drawdown = np.array([point.s for point in data], dtype=float)

    times_seconds = times_minutes * 60.0
    Q_si = req.Q / 3600.0  # convert from m^3/h to m^3/s

    priors = req.priors or {}
    j = float(priors.get("j", 0.0))

    try:
        params, ci, metrics, fitted_curve = fit_curve(
            times_seconds,
            drawdown,
            req.model,
            req.r,
            Q_si,
            priors=priors,
            conf=req.conf,
            j=j,
        )
    except Exception as exc:  # pragma: no cover - surfaced via HTTP
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    fitted_minutes = [(t / 60.0, s) for t, s in fitted_curve]

    response = {
        "model": req.model,
        "params": {k: float(v) for k, v in params.items()},
        "ci": {k: [float(v0), float(v1)] for k, (v0, v1) in ci.items()},
        "metrics": metrics,
        "diagnostics": {"coverage": _coverage_buckets(times_seconds)},
        "curves": {
            "observed": [(float(t), float(s)) for t, s in zip(times_minutes, drawdown)],
            "fitted": fitted_minutes,
        },
    }
    return response
