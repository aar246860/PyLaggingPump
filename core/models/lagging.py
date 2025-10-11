
"""Lagging Theory model placeholder.

Define s(t; T, S, tau_q, tau_s, r, Q).
This file should expose two functions:
- drawdown_time_domain(...)
- drawdown_laplace_domain(...)

Units (suggested):
- T: m^2/s
- S (or Ss): dimensionless (or 1/m if storativity per unit thickness)
- tau_q, tau_s: time [s]
- r: m
- Q: m^3/s (convert from m^3/h at API layer)

TODO: implement real math.
"""

from typing import Sequence, Dict
import numpy as np

def drawdown_time_domain(t: np.ndarray, T: float, S: float, tau_q: float, tau_s: float, r: float, Q: float) -> np.ndarray:
    # Placeholder: simple smoothed step to make plots; replace with real formulation.
    t = np.asarray(t, dtype=float) + 1e-9
    k = (Q/(4*np.pi*T)) * np.log(1 + t/(tau_q + 1e-6))
    return k

def params_info() -> Dict[str, str]:
    return {"T":"m^2/s","S":"-","tau_q":"s","tau_s":"s","r":"m","Q":"m^3/s"}
