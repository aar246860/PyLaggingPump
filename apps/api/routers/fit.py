
from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import List, Literal, Optional

router = APIRouter(prefix="/fit", tags=["fit"])

class DataPoint(BaseModel):
    t: float = Field(..., description="time in minutes")
    s: float = Field(..., description="drawdown in meters")

class FitRequest(BaseModel):
    r: float = Field(..., description="observation radius (m)")
    Q: float = Field(..., description="pumping rate (m^3/h)")
    data: List[DataPoint]
    model: Literal["lagging","theis","neuman"] = "lagging"
    priors: Optional[dict] = None
    conf: float = 0.95

@router.post("")
def fit(req: FitRequest):
    # TODO: wire to core.fitters.search(...) + core.models.*
    # Return a stub so the UI can run end-to-end.
    return {
        "model": req.model,
        "params": {"T": 1e-3, "S": 1e-4, "tau_q": 1e-2 if req.model=="lagging" else None, "tau_s": 5e-3 if req.model=="lagging" else None},
        "ci": {"T": [8e-4, 1.2e-3], "S": [8e-5, 1.2e-4], "tau_q": [5e-3, 2e-2] if req.model=="lagging" else None, "tau_s": [2e-3, 1e-2] if req.model=="lagging" else None},
        "metrics": {"rmse": 0.01, "r2": 0.98},
        "diagnostics": {"coverage": {"early":0.4,"mid":0.5,"late":0.1}},
        "curves": {"observed": [(d.t,d.s) for d in req.data], "fitted": [(d.t, d.s*0.95) for d in req.data]}
    }
