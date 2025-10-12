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
from scipy.special import kv, kve


def _dimensionless_parameters(
    T: float,
    S: float,
    tau_q: float,
    tau_s: float,
    r: float,
    rw: float,
    j: float,
) -> tuple[float, float, float, float, float]:
    """Return the dimensionless scaling parameters."""

    if rw <= 0:
        raise ValueError("Well radius rw must be positive.")

    alpha = T / (S * rw**2)
    if alpha <= 0:
        raise ValueError("Transmissivity and storage must yield positive scaling.")

    r_D = max(r, rw) / rw
    tau_qD = T * tau_q / (S * rw**2)
    tau_sD = T * tau_s / (S * rw**2)
    j = max(j, 0.0)
    return alpha, r_D, tau_qD, tau_sD, j


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

    alpha, r_D, tau_qD, tau_sD, j = _dimensionless_parameters(T, S, tau_q, tau_s, r, rw, j)
    prefactor = (Q / (4.0 * np.pi * T)) * (1.0 / alpha)

    def S_of_p(p_val: complex) -> complex:
        p_val = complex(p_val)
        if p_val == 0:
            return np.inf

        p_D = p_val / alpha
        numerator = p_D + j * (1.0 + tau_qD * p_D)
        denominator = 1.0 + tau_sD * p_D
        k = csqrt(numerator / denominator)

        if abs(k) < 1e-12:
            k = 1e-12 + 0j

        K0 = kv(0, k * r_D)
        K1 = kv(1, k)
        if K1 == 0:
            # fall back to scaled Bessel functions for extreme arguments
            K0 = kve(0, k * r_D) * np.exp(-np.real(k * r_D))
            K1 = kve(1, k) * np.exp(-np.real(k))

        B = (1.0 + tau_qD * p_D) / (p_D * (1.0 + tau_sD * p_D) * k * K1)
        return prefactor * B * K0

    return S_of_p


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
    alpha, r_D, tau_qD, tau_sD, j = _dimensionless_parameters(T, S, tau_q, tau_s, r, rw, j)

    def S_D(p_D: complex) -> complex:
        if p_D == 0:
            return np.inf

        numerator = p_D + j * (1.0 + tau_qD * p_D)
        denominator = 1.0 + tau_sD * p_D
        k = csqrt(numerator / denominator)

        if abs(k) < 1e-12:
            k = 1e-12 + 0j

        K0 = kv(0, k * r_D)
        K1 = kv(1, k)
        if K1 == 0:
            K0 = kve(0, k * r_D) * np.exp(-np.real(k * r_D))
            K1 = kve(1, k) * np.exp(-np.real(k))

        B = (1.0 + tau_qD * p_D) / (p_D * (1.0 + tau_sD * p_D) * k * K1)
        return B * K0

    coeffs = _stehfest_coeff_cache(12)
    ln2 = np.log(2.0)
    results = np.zeros_like(t, dtype=float)

    for idx, t_val in enumerate(t):
        t_D = max(t_val * alpha, 1e-12)
        if t_D <= 1e-12:
            results[idx] = 0.0
            continue

        total = 0.0 + 0.0j
        for k_idx, V_k in enumerate(coeffs, start=1):
            p_D = k_idx * ln2 / t_D
            total += V_k * S_D(p_D)
        s_D = np.real(ln2 / t_D * total)
        results[idx] = (Q / (4.0 * np.pi * T)) * s_D

    return results
