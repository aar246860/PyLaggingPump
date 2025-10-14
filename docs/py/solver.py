"""Analytical / semi-analytical drawdown utilities executed inside Pyodide.

The solver mirrors the scientific routines that ship with the desktop
application but is carefully written in pure Python/NumPy so that it can run
inside the browser via Pyodide.  The key routines exposed to the JavaScript
front-end are :func:`theis_drawdown`, :func:`lagging_drawdown_time`, and the
high level :func:`fit_model` curve fitting helper.

The lagging response is evaluated in the Laplace domain and numerically
inverted in time using the Gaver–Stehfest algorithm by default, providing a
lightweight option that runs comfortably inside Pyodide.  A Fourier-accelerated
de Hoog, Knight & Stokes (1982) implementation is also available for scenarios
that require higher accuracy.  The formulation follows Lin & Yeh (2017, *Water
Resources Research*) when neglecting skin and wellbore storage while retaining
optional parameters so the model can be extended without touching the
JavaScript bridge.
"""

from __future__ import annotations

import math
from functools import lru_cache
from typing import Callable, Dict, Iterable, Sequence, Tuple

import numpy as np
from scipy.optimize import least_squares
from scipy.special import expn, kv


FOUR_PI = 4.0 * math.pi
EPS_TIME = 1e-12


@lru_cache(maxsize=16)
def _stehfest_coefficients(n: int) -> np.ndarray:
    """Return the :math:`n` Stehfest coefficients for numerical inversion."""

    if n <= 0 or n % 2 != 0:
        raise ValueError("Stehfest requires a positive even number of terms")

    coeffs = np.zeros(n)
    half = n // 2
    for k in range(1, n + 1):
        total = 0.0
        sign = (-1) ** (k + half)
        lower = (k + 1) // 2
        upper = min(k, half)
        for j_val in range(lower, upper + 1):
            numerator = j_val**half * math.factorial(2 * j_val)
            denominator = (
                math.factorial(half - j_val)
                * math.factorial(j_val)
                * math.factorial(j_val - 1)
                * math.factorial(k - j_val)
                * math.factorial(2 * j_val - k)
            )
            total += numerator / denominator
        coeffs[k - 1] = sign * total
    return coeffs


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

    p_arr = np.asarray(p, dtype=complex)
    scalar_input = p_arr.ndim == 0

    T = float(T)
    S = float(S)
    tau_q = max(float(tau_q), 0.0)
    tau_s = max(float(tau_s), 0.0)
    Q = float(Q)
    j = float(j)
    rw = max(float(rw), 1e-6)
    skin = float(Sk)
    stor = max(float(C_D), 0.0)

    denom = 1.0 + tau_s * p_arr
    denom = np.where(np.abs(denom) < 1e-16, 1e-16 + 0j, denom)

    factor = (p_arr + j) * (1.0 + tau_q * p_arr) / denom
    diffusivity = max(T, 1e-16) / max(S, 1e-16)
    k = np.sqrt(factor / diffusivity)
    r_eval = max(float(r), rw)

    skin_factor = math.exp(-skin)
    storage = 1.0 + stor * p_arr
    coeff = (Q * skin_factor) / (2.0 * math.pi * T)
    result = coeff * kv(0, k * r_eval) / (p_arr * storage)

    if scalar_input:
        return complex(result)

    return result


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


def inv_laplace_stehfest(
    F: Callable[[complex], complex],
    t_arr: Sequence[float],
    n_terms: int = 12,
) -> np.ndarray:
    """Numerically invert ``F`` using the Gaver–Stehfest algorithm."""

    times = _ensure_array(t_arr)
    coeffs = _stehfest_coefficients(int(n_terms)).astype(float)
    ln2 = math.log(2.0)
    out = np.zeros_like(times, dtype=float)

    positive_mask = times > 0.0
    if not np.any(positive_mask):
        return out

    positive_times = times[positive_mask]
    safe_times = np.maximum(positive_times, EPS_TIME)
    scales = ln2 / safe_times

    k_vals = np.arange(1, coeffs.size + 1, dtype=float)
    p_matrix = np.outer(k_vals, scales)

    laplace_vals = np.asarray(F(p_matrix), dtype=complex)
    if laplace_vals.shape != p_matrix.shape:
        laplace_vals = np.broadcast_to(laplace_vals, p_matrix.shape)

    summed = laplace_vals.T @ coeffs
    values = scales * summed
    out[positive_mask] = np.real_if_close(values, tol=1000.0).astype(float)
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
    method: str = "stehfest",
    stehfest_terms: int = 12,
) -> np.ndarray:
    """Lagging model in the time domain via numerical inverse Laplace."""

    times = _ensure_array(t)

    def F(p):
        return _lagging_s_bar(p, r, T, S, tau_q, tau_s, Q, j=j)

    method_lower = method.lower()
    if method_lower == "stehfest":
        values = inv_laplace_stehfest(F, times, n_terms=stehfest_terms)
    elif method_lower == "dehoog":
        values = inv_laplace_dehoog(F, times)
    else:
        raise ValueError(f"Unknown Laplace inversion method: {method}")

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
    conf: float = 0.95,
    **kwargs,
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
    fit_j = bool(kwargs.pop("fit_j", False))

    if model_name == 'lagging':
        log_init, j_init = _initial_guess(model_name, times_sorted, draws_sorted)
        logT0, logS0, log_tau_q0, log_tau_s0 = log_init

        if fit_j:

            def residual(theta, t_arr, draw_arr, radius, rate):
                logT, logS, log_tau_q, log_tau_s, j_param = theta
                T = np.exp(logT)
                S = np.exp(logS)
                tau_q = np.exp(log_tau_q)
                tau_s = np.exp(log_tau_s)
                pred = lagging_drawdown_time(t_arr, T, S, tau_q, tau_s, radius, rate, j_param)
                return pred - draw_arr

            j0 = priors.get('j', j_init)
            x0 = np.array([logT0, logS0, log_tau_q0, log_tau_s0, j0])
            bounds = (
                np.array([np.log(1e-8), np.log(1e-10), np.log(1e-6), np.log(1e-6), -1.0]),
                np.array([np.log(1e4), np.log(1.0), np.log(1e6), np.log(1e6), 1.0]),
            )
        else:

            def residual(theta, t_arr, draw_arr, radius, rate):
                logT, logS, log_tau_q, log_tau_s = theta
                T = np.exp(logT)
                S = np.exp(logS)
                tau_q = np.exp(log_tau_q)
                tau_s = np.exp(log_tau_s)
                pred = lagging_drawdown_time(t_arr, T, S, tau_q, tau_s, radius, rate)
                return pred - draw_arr

            x0 = np.array([logT0, logS0, log_tau_q0, log_tau_s0])
            bounds = (
                np.array([np.log(1e-8), np.log(1e-10), np.log(1e-6), np.log(1e-6)]),
                np.array([np.log(1e4), np.log(1.0), np.log(1e6), np.log(1e6)]),
            )

        lsq_args = (times_sorted, draws_sorted, r, Q)
    elif model_name == 'theis':
        logT0, logS0 = _initial_guess(model_name, times_sorted, draws_sorted)

        def residual(theta, t_arr, draw_arr, radius, rate):
            logT, logS = theta
            T = np.exp(logT)
            S = np.exp(logS)
            pred = theis_drawdown(t_arr, T, S, radius, rate)
            return pred - draw_arr

        x0 = np.array([logT0, logS0])
        bounds = (
            np.array([np.log(1e-8), np.log(1e-10)]),
            np.array([np.log(1e4), np.log(1.0)]),
        )
        lsq_args = (times_sorted, draws_sorted, r, Q)
    else:
        raise ValueError(f'Unsupported model: {model_name}')

    extra_args = kwargs.get("lsq_args", ())
    if extra_args is None:
        extra_args = ()
    if not isinstance(extra_args, tuple):
        extra_args = tuple(extra_args)
    args = lsq_args + extra_args
    result = least_squares(residual, x0, bounds=bounds, max_nfev=600, args=args)

    if model_name == 'lagging':
        if fit_j:
            logT, logS, log_tau_q, log_tau_s, j_param = result.x
            params = {
                'T': float(np.exp(logT)),
                'S': float(np.exp(logS)),
                'tau_q': float(np.exp(log_tau_q)),
                'tau_s': float(np.exp(log_tau_s)),
                'j': float(np.clip(j_param, -1.0, 1.0)),
            }
            fitted = lagging_drawdown_time(
                times_sorted,
                params['T'],
                params['S'],
                params['tau_q'],
                params['tau_s'],
                r,
                Q,
                params['j'],
            )
        else:
            logT, logS, log_tau_q, log_tau_s = result.x
            params = {
                'T': float(np.exp(logT)),
                'S': float(np.exp(logS)),
                'tau_q': float(np.exp(log_tau_q)),
                'tau_s': float(np.exp(log_tau_s)),
            }
            fitted = lagging_drawdown_time(
                times_sorted,
                params['T'],
                params['S'],
                params['tau_q'],
                params['tau_s'],
                r,
                Q,
            )
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


def bootstrap_fit(
    times: Sequence[float],
    draws: Sequence[float],
    model_name: str,
    r: float,
    Q: float,
    priors: Dict[str, float] | None = None,
    conf: float = 0.95,
    n_boot: int = 100,
    seed: int | None = None,
    base_fit: Tuple[Dict[str, float], Sequence[Tuple[float, float]]] | None = None,
    **kwargs,
) -> Dict[str, Dict[str, Sequence[float]]]:
    """Residual bootstrap confidence intervals for fitted parameters."""

    kwargs = dict(kwargs)
    fit_j = bool(kwargs.pop('fit_j', False))

    times_arr = _ensure_array(times)
    draws_arr = _ensure_array(draws)
    if len(times_arr) != len(draws_arr):
        raise ValueError('times and draws must have same length')

    order = np.argsort(times_arr)
    times_sorted = times_arr[order]
    draws_sorted = draws_arr[order]

    priors = priors or {}

    if base_fit is None:
        base_params, _, base_curve = fit_model(
            times_sorted,
            draws_sorted,
            model_name,
            r,
            Q,
            priors=priors,
            conf=conf,
            fit_j=fit_j,
            **kwargs,
        )
    else:
        base_params, base_curve = base_fit

    base_curve = list(base_curve or [])
    if not base_curve:
        raise ValueError('Base fit did not return curve values for bootstrap')

    base_times = np.array([float(pt[0]) for pt in base_curve], dtype=float)
    base_values = np.array([float(pt[1]) for pt in base_curve], dtype=float)

    if base_times.shape != base_values.shape:
        raise ValueError('Malformed fitted curve data')

    residuals = draws_sorted - base_values
    if residuals.size == 0:
        raise ValueError('Not enough data for bootstrap')

    rng = np.random.default_rng(seed)
    alpha = max(0.0, min(1.0, 1.0 - float(conf)))
    lower_pct = 100.0 * (alpha / 2.0)
    upper_pct = 100.0 * (1.0 - alpha / 2.0)

    n_boot = int(max(0, n_boot))
    samples: Dict[str, list[float]] = {key: [] for key in base_params.keys()}

    for _ in range(n_boot):
        draws_star = base_values + rng.choice(residuals, size=residuals.size, replace=True)
        params_b, _, _ = fit_model(
            times_sorted,
            draws_star,
            model_name,
            r,
            Q,
            priors=priors,
            conf=conf,
            fit_j=fit_j,
            **kwargs,
        )
        for key, value in params_b.items():
            samples.setdefault(key, []).append(float(value))

    ci: Dict[str, Sequence[float]] = {}
    filtered_samples: Dict[str, list[float]] = {}
    for key, values in samples.items():
        if not values:
            continue
        arr = np.asarray(values, dtype=float)
        ci[key] = [
            float(np.percentile(arr, lower_pct)),
            float(np.percentile(arr, upper_pct)),
        ]
        filtered_samples[key] = list(arr.tolist())

    return {'ci': ci, 'samples': filtered_samples}


def fit_with_ci(
    times: Sequence[float],
    draws: Sequence[float],
    model_name: str,
    r: float,
    Q: float,
    priors: Dict[str, float] | None = None,
    conf: float = 0.95,
    n_boot: int = 100,
    **kwargs,
):
    """Fit model and compute bootstrap confidence intervals."""

    fit_j = bool(kwargs.get('fit_j', False))

    params, metrics, fitted = fit_model(
        times,
        draws,
        model_name,
        r,
        Q,
        priors=priors,
        conf=conf,
        **kwargs,
    )

    params_out = dict(params)
    if not fit_j:
        params_out.pop('j', None)

    bootstrap_result = bootstrap_fit(
        times,
        draws,
        model_name,
        r,
        Q,
        priors=priors,
        conf=conf,
        n_boot=n_boot,
        base_fit=(params_out, fitted),
        **kwargs,
    )

    ci = bootstrap_result.get('ci', {})
    samples = bootstrap_result.get('samples', {})

    if not fit_j:
        ci = {key: value for key, value in ci.items() if key in params_out}
        samples = {key: value for key, value in samples.items() if key in params_out}

    return params_out, metrics, fitted, ci, samples
