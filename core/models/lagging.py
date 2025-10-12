"""Lagging (dual time-lag) confined aquifer model.

This module implements a stable time-domain approximation of the Lin & Yeh
(2017) dual time-lag confined aquifer model. The formulation follows the
dimensionless system provided in the project specification, namely

.. math::
    (1+\tau_{sD}\partial_{t_D})(\nabla^2 s_D)
    - (1+\tau_{qD}\partial_{t_D}) j s_D
    = (1+\tau_{qD}\partial_{t_D}) \partial_{t_D} s_D

with the dimensionless variables

.. math::
    s_D = \frac{4\pi T}{Q} s,\quad
    t_D = \frac{T t}{S r_w^2},\quad
    r_D = \frac{r}{r_w},\quad
    \tau_{qD} = \frac{T \tau_q}{S r_w^2},\quad
    \tau_{sD} = \frac{T \tau_s}{S r_w^2}.

We assume SI base units throughout the public interface: ``t`` and ``tau_*``
are in seconds, transmissivity ``T`` in :math:`m^2/s`, storage ``S``
dimensionless, radii in metres, and pumping rate ``Q`` in :math:`m^3/s`. The
current time-domain implementation uses a Gaver–Stehfest numerical inverse
Laplace transform of the analytical Laplace-domain solution while omitting
wellbore storage and skin for stability (these terms will be reinstated when
the de Hoog solver is introduced in task 2).

The approximation satisfies the expected degenerations:

* ``tau_q -> 0`` and ``tau_s -> 0`` :math:`\Rightarrow` Theis drawdown.
* ``j -> 0`` :math:`\Rightarrow` non-leaky confined aquifer behaviour.

References
----------
Lin, C.-P., & Yeh, H.-D. (2017). Analytical solutions for radial flow with two
memory terms in a confined aquifer. *Water Resources Research*, 53.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Callable

import numpy as np
from numpy.lib.scimath import sqrt as csqrt
from numpy.typing import ArrayLike
from scipy.special import kv


def _lagging_laplace_value(
    p_val: complex,
    T: float,
    S: float,
    tau_q: float,
    tau_s: float,
    r: float,
    Q: float,
    j: float,
    rw: float,
) -> complex:
    """Evaluate the lagging drawdown in the Laplace domain."""

    p_val = complex(p_val)
    if p_val == 0:
        return np.inf

    T_eff = max(float(T), 1e-16)
    S_eff = max(float(S), 1e-16)
    tau_q = max(float(tau_q), 0.0)
    tau_s = max(float(tau_s), 0.0)
    Q = float(Q)
    j = max(float(j), 0.0)
    rw = max(float(rw), 1e-8)
    r_eff = max(float(r), rw)

    denom = 1.0 + tau_s * p_val
    if denom == 0:
        denom = 1e-30

    factor = (p_val + j) * (1.0 + tau_q * p_val) / denom
    k = csqrt((S_eff / T_eff) * factor)
    arg = r_eff * k

    return (Q / (2.0 * np.pi * T_eff)) * kv(0, arg) / p_val


def _stehfest_coefficients(n: int) -> np.ndarray:
    """Return Stehfest coefficients for an even ``n``."""

    if n % 2 != 0 or n <= 0:
        raise ValueError("Stehfest requires a positive even number of terms.")

    coeffs = np.zeros(n)
    half = n // 2
    for k in range(1, n + 1):
        total = 0.0
        sign = (-1) ** (k + half)
        lower = (k + 1) // 2
        upper = min(k, half)
        for j_val in range(lower, upper + 1):
            numerator = j_val**half * np.math.factorial(2 * j_val)
            denominator = (
                np.math.factorial(half - j_val)
                * np.math.factorial(j_val)
                * np.math.factorial(j_val - 1)
                * np.math.factorial(k - j_val)
                * np.math.factorial(2 * j_val - k)
            )
            total += numerator / denominator
        coeffs[k - 1] = sign * total
    return coeffs


@lru_cache(maxsize=16)
def _stehfest_coeff_cache(n: int) -> np.ndarray:
    return _stehfest_coefficients(n)


def drawdown_laplace_domain(
    p: ArrayLike,
    T: float,
    S: float,
    tau_q: float,
    tau_s: float,
    r: float,
    Q: float,
    j: float = 0.0,
    rw: float = 0.1,
    rc: float = 0.1,
    Sk: float = 0.0,
) -> Callable[[complex], complex]:
    """Return the Laplace transform :math:`\tilde{s}(p)` of the drawdown."""

    return lambda p_val: _lagging_laplace_value(p_val, T, S, tau_q, tau_s, r, Q, j, rw)


def drawdown_time_domain(
    t: ArrayLike,
    T: float,
    S: float,
    tau_q: float,
    tau_s: float,
    r: float,
    Q: float,
    j: float = 0.0,
    rw: float = 0.1,
    rc: float = 0.1,
    Sk: float = 0.0,
) -> np.ndarray:
    """Return the lagging drawdown (metres) evaluated at ``t`` seconds."""

    t = np.asarray(t, dtype=float)
    coeffs = _stehfest_coeff_cache(12)
    ln2 = np.log(2.0)
    results = np.zeros_like(t, dtype=float)

    laplace_eval = drawdown_laplace_domain(
        np.asarray([], dtype=float), T, S, tau_q, tau_s, r, Q, j=j, rw=rw, rc=rc, Sk=Sk
    )

    for idx, t_val in enumerate(t):
        t_eff = max(t_val, 0.0)
        if t_eff <= 0.0:
            results[idx] = 0.0
            continue

        scale = ln2 / max(t_eff, 1e-12)
        total = 0.0 + 0.0j
        for k_idx, V_k in enumerate(coeffs, start=1):
            p_val = k_idx * scale
            total += V_k * laplace_eval(p_val)
        results[idx] = float(np.real(scale * total))

    return results
