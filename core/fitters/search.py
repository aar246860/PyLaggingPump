
"""Fitting/search placeholder.
Coarse-to-fine: CMA-ES (pycma) -> scipy least_squares (later).
"""
import numpy as np

def fit(times, draws, model_name: str, r: float, Q: float, priors=None, conf=0.95):
    # Return a stable stub so the pipeline runs
    params = {"T":1e-3,"S":1e-4}
    if model_name == "lagging":
        params.update({"tau_q":1e-2,"tau_s":5e-3})
    rmse = 0.01
    r2 = 0.98
    ci = {k:[v*0.8, v*1.2] for k,v in params.items()}
    fitted = np.column_stack([times, np.interp(times, times, draws)]).tolist()
    return params, ci, {"rmse":rmse,"r2":r2}, fitted
