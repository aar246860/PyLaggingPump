"""Classical Theis confined aquifer drawdown solution."""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike
from scipy.special import exp1


def drawdown_time_domain(t: ArrayLike, T: float, S: float, r: float, Q: float) -> np.ndarray:
    """Return the Theis drawdown (metres) evaluated at ``t`` seconds.

    Parameters
    ----------
    t : array-like of float
        Time since pumping started (seconds).
    T : float
        Transmissivity (:math:`m^2/s`).
    S : float
        Storage coefficient (dimensionless).
    r : float
        Observation radius (metres).
    Q : float
        Pumping rate (:math:`m^3/s`).
    """

    t = np.asarray(t, dtype=float)
    t = np.maximum(t, 1e-16)
    u = (r**2 * S) / (4.0 * T * t)
    return (Q / (4.0 * np.pi * T)) * exp1(u)
