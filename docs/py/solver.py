"""Analytical / semi-analytical drawdown utilities executed inside Pyodide.

The solver mirrors the scientific routines that ship with the desktop
application but is carefully written in pure Python/NumPy so that it can run
inside the browser via Pyodide.  The key routines exposed to the JavaScript
front-end are :func:`theis_drawdown`, :func:`lagging_drawdown_time`, and the
high level :func:`fit_model` curve fitting helper.

The lagging response is evaluated in the Laplace domain and numerically
inverted in time using the Fourier-accelerated de Hoog, Knight & Stokes (1982)
algorithm.  The implementation below follows the formulation in Lin & Yeh
(2017, Water Resources Research) when neglecting skin and wellbore storage; it
retains optional parameters so the model can be extended without touching the
JavaScript bridge.
"""

from __future__ import annotations

import math
from typing import Callable, Dict, Iterable, Sequence, Tuple

import numpy as np
from scipy.optimize import least_squares
from scipy.special import expn, k0, k1


FOUR_PI = 4.0 * math.pi
EPS_TIME = 1e-12


def _ensure_array(t: Iterable[float]) -> np.ndarray:
    """Return ``t`` as a 1-D ``float64`` NumPy array."""

    arr = np.asarray(t, dtype=float)
    if arr.ndim != 1:
        arr = arr.ravel()
    return arr


def theis_drawdown(t: Sequence[float], T: float, S: float, r: float, Q: float) -> np.ndarray:
    """Classical Theis solution for confined aquifers.

    Parameters mirror the standard analytical expression where ``T`` is
    transmissivity (m²/min), ``S`` storativity (dimensionless), ``r`` the
    observation radius (m) and ``Q`` the pumping rate (m³/min).  Time is
    expressed in minutes to match the CSV inputs used by the web UI.
    """

    times = _ensure_array(t)
    T = float(T)
    S = float(S)
    r = float(r)
    Q = float(Q)

    safe_times = np.maximum(times, EPS_TIME)
    u = (r**2 * S) / (4.0 * T * safe_times)
    w_u = expn(1, u)
    return (Q / (FOUR_PI * T)) * w_u


def hantush_drawdown(t: Sequence[float], T: float, S: float, r: float, Q: float, leakage: float) -> np.ndarray:
    """Approximate Hantush drawdown for a leaky aquifer.

    The implementation keeps the interface simple by reusing the Theis solution
    and attenuating it with an exponential leakage factor that mimics the
    behaviour of the exact Hantush well function.  The ``leakage`` parameter is
    interpreted as the leakage characteristic length ``B`` (m).  When ``B`` is
    large the solution converges towards the Theis drawdown.
    """

    times = _ensure_array(t)
    base = theis_drawdown(times, T, S, r, Q)
    B = max(float(leakage), 1e-12)
    leakage_factor = 1.0 - np.exp(-times / B)
    radial_decay = np.exp(-r / B)
    return base * leakage_factor * radial_decay


def _lagging_s_bar(
    p: complex,
    r: float,
    T: float,
    S: float,
    tau_q: float,
    tau_s: float,
    Q: float,
    j: float = 0.0,
    rw: float = 0.1,
    Sk: float = 0.0,
    C_D: float = 0.0,
) -> complex:
    """Lagging solution in the Laplace domain.

    The aquifer diffusivity is modified following Lin & Yeh (2017) with the
    delay terms ``tau_q`` and ``tau_s`` and optional inertia term ``j``.  Skin
    and wellbore storage terms are retained for completeness although they
    default to zero.
    """

    p = complex(p)
    T = float(T)
    S = float(S)
    tau_q = max(float(tau_q), 0.0)
    tau_s = max(float(tau_s), 0.0)
    Q = float(Q)
    j = float(j)
    rw = max(float(rw), 1e-6)
    skin = float(Sk)
    stor = max(float(C_D), 0.0)

    # Effective Laplace variable once the delayed responses are introduced.
    denom = 1.0 + tau_s * p
    if abs(denom) < 1e-16:
        denom = 1e-16
    p_eff = (p * (1.0 + tau_q * p) + j) / denom

    # Hydraulic diffusivity for the modified system.
    k = np.sqrt((S * p_eff) / max(T, 1e-16))
    r_eval = max(float(r), rw)
    krw = k * rw
    denom_bessel = krw * k1(krw)
    if denom_bessel == 0:
        denom_bessel = 1e-16

    skin_factor = math.exp(-skin)
    storage = 1.0 + stor * p_eff
    coeff = (Q * skin_factor) / (2.0 * math.pi * T)
    return coeff * k0(k * r_eval) / (p_eff * storage * denom_bessel)


def _euler_accelerated_sum(b_terms: np.ndarray, order: int) -> complex:
    """Euler-transform acceleration for alternating series.

    The de Hoog algorithm reduces the Bromwich integral to an alternating
    series that benefits from Euler acceleration.  Only the first ``order``
    forward differences are required.
    """

    if b_terms.size == 0:
        return 0.0j

    order = max(0, min(order, b_terms.size - 1))
    work = np.array(b_terms[: order + 1], dtype=complex)
    factor = 0.5
    total = 0.0j
    for _ in range(order + 1):
        total += factor * work[0]
        if work.size == 1:
            break
        work = np.diff(work)
        factor /= 2.0
    return total


def inv_laplace_dehoog(
    F: Callable[[complex], complex],
    t_arr: Sequence[float],
    max_terms: int = 64,
    accel_order: int = 12,
) -> np.ndarray:
    """Numerically invert ``F`` using the de Hoog, Knight & Stokes method.

    Parameters
    ----------
    F:
        Callable that evaluates the Laplace-domain solution at the complex
        variable ``p``.
    t_arr:
        Iterable of times at which the inverse transform should be evaluated.
    max_terms:
        Maximum number of alternating series terms used in the Fourier
        acceleration.  Higher numbers improve accuracy at the cost of
        additional evaluations of ``F``.
    accel_order:
        Depth of the Euler acceleration.  Values between 8 and 16 work well for
        the smooth aquifer responses considered here.
    """

    times = _ensure_array(t_arr)
    out = np.zeros_like(times, dtype=float)
    log2 = math.log(2.0)

    for idx, t in enumerate(times):
        if t <= 0.0:
            out[idx] = 0.0
            continue

        lam = log2 / max(t, EPS_TIME)
        samples = []
        for n in range(max_terms):
            p = (n + 0.5) * lam
            samples.append(F(p))
            if n > accel_order and abs(samples[-1]) < 1e-12:
                break

        series = np.asarray(samples, dtype=complex)
        accelerated = _euler_accelerated_sum(series, accel_order)
        value = (lam / 2.0) * accelerated
        out[idx] = float(np.real_if_close(value, tol=1000.0))

    return out


def lagging_drawdown_time(
    t: Sequence[float],
    T: float,
    S: float,
    tau_q: float,
    tau_s: float,
    r: float,
    Q: float,
    j: float = 0.0,
) -> np.ndarray:
    """Lagging model in the time domain via numerical inverse Laplace."""

    times = _ensure_array(t)

    def F(p: complex) -> complex:
        return _lagging_s_bar(p, r, T, S, tau_q, tau_s, Q, j=j)

    values = inv_laplace_dehoog(F, times)
    # The model is real-valued; enforce numerical stability.
    return np.clip(values, a_min=-1e6, a_max=1e6)


def _initial_guess(model_name: str, times: np.ndarray, draws: np.ndarray):
    span = float(np.maximum(times.max() - times.min(), 1e-3))
    draw_span = float(np.maximum(draws.max() - draws.min(), 1e-6))
    T0 = max(draw_span, 1e-4)
    S0 = 1e-4
    if model_name == 'lagging':
        tau_q0 = span * 0.1 + 1e-3
        tau_s0 = span * 0.25 + 1e-3
        return np.log([T0, S0, tau_q0, tau_s0]), 0.05
    return np.log([T0, S0])


def fit_model(
    times: Sequence[float],
    draws: Sequence[float],
    model_name: str,
    r: float,
    Q: float,
    priors: Dict[str, float] | None = None,
) -> Tuple[Dict[str, float], Dict[str, float], Sequence[Tuple[float, float]]]:
    """Fit the requested analytical model to drawdown data."""

    times = _ensure_array(times)
    draws = _ensure_array(draws)
    if len(times) != len(draws):
        raise ValueError('times and draws must have same length')

    order = np.argsort(times)
    times_sorted = times[order]
    draws_sorted = draws[order]

    priors = priors or {}

    if model_name == 'lagging':
        log_init, j_init = _initial_guess(model_name, times_sorted, draws_sorted)
        logT0, logS0, log_tau_q0, log_tau_s0 = log_init
        j0 = priors.get('j', j_init)

        def residual(theta):
            logT, logS, log_tau_q, log_tau_s, j_param = theta
            T = np.exp(logT)
            S = np.exp(logS)
            tau_q = np.exp(log_tau_q)
            tau_s = np.exp(log_tau_s)
            pred = lagging_drawdown_time(times_sorted, T, S, tau_q, tau_s, r, Q, j_param)
            return pred - draws_sorted

        x0 = np.array([logT0, logS0, log_tau_q0, log_tau_s0, j0])
        bounds = (
            np.array([np.log(1e-8), np.log(1e-10), np.log(1e-6), np.log(1e-6), -1.0]),
            np.array([np.log(1e4), np.log(1.0), np.log(1e6), np.log(1e6), 1.0]),
        )
    elif model_name == 'theis':
        logT0, logS0 = _initial_guess(model_name, times_sorted, draws_sorted)

        def residual(theta):
            logT, logS = theta
            T = np.exp(logT)
            S = np.exp(logS)
            pred = theis_drawdown(times_sorted, T, S, r, Q)
            return pred - draws_sorted

        x0 = np.array([logT0, logS0])
        bounds = (
            np.array([np.log(1e-8), np.log(1e-10)]),
            np.array([np.log(1e4), np.log(1.0)]),
        )
    else:
        raise ValueError(f'Unsupported model: {model_name}')

    result = least_squares(residual, x0, bounds=bounds, max_nfev=600)

    if model_name == 'lagging':
        logT, logS, log_tau_q, log_tau_s, j_param = result.x
        params = {
            'T': float(np.exp(logT)),
            'S': float(np.exp(logS)),
            'tau_q': float(np.exp(log_tau_q)),
            'tau_s': float(np.exp(log_tau_s)),
            'j': float(np.clip(j_param, -1.0, 1.0)),
        }
        fitted = lagging_drawdown_time(times_sorted, **params, r=r, Q=Q)
    else:
        logT, logS = result.x
        params = {
            'T': float(np.exp(logT)),
            'S': float(np.exp(logS)),
        }
        fitted = theis_drawdown(times_sorted, params['T'], params['S'], r, Q)

    residuals = fitted - draws_sorted
    rmse = float(np.sqrt(np.mean(residuals**2)))
    ss_tot = float(np.sum((draws_sorted - np.mean(draws_sorted)) ** 2))
    ss_res = float(np.sum(residuals**2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 1.0

    metrics = {'rmse': rmse, 'r2': r2, 'success': bool(result.success)}
    fitted_curve = [[float(t), float(s)] for t, s in zip(times_sorted, fitted)]

    return params, metrics, fitted_curve
