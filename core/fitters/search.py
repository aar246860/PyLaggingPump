"""Lightweight parameter search to support the initial API wiring."""

from __future__ import annotations

from typing import Dict, Iterable, List, Mapping, Tuple

import numpy as np
from numpy.typing import ArrayLike
from scipy.optimize import least_squares
from scipy.special import erfinv

from core.models.lagging import drawdown_time_domain as lagging_drawdown
from core.models.theis import drawdown_time_domain as theis_drawdown


def _model_evaluator(model_name: str):
    if model_name == "lagging":
        def fn(times, T, S, tau_q, tau_s, r, Q, j=0.0):
            return lagging_drawdown(times, T, S, tau_q, tau_s, r, Q, j)
        param_names = ["T", "S", "tau_q", "tau_s"]
    elif model_name == "theis":
        def fn(times, T, S, tau_q, tau_s, r, Q, j=0.0):
            return theis_drawdown(times, T, S, r, Q)
        param_names = ["T", "S"]
    else:
        raise ValueError(f"Unsupported model '{model_name}'.")
    return fn, param_names


def _initial_log_params(param_names: Iterable[str], priors: Mapping | None) -> np.ndarray:
    defaults = {
        "T": 1e-3,
        "S": 1e-4,
        "tau_q": 10.0,
        "tau_s": 10.0,
    }
    priors = priors or {}
    values = [float(priors.get(name, defaults[name])) for name in param_names]
    return np.log(np.clip(values, 1e-12, None))


def _bounds(param_names: Iterable[str]) -> Tuple[np.ndarray, np.ndarray]:
    lower = []
    upper = []
    for name in param_names:
        if name in {"T", "S"}:
            lower.append(np.log(1e-8))
            upper.append(np.log(1e-1))
        elif name in {"tau_q", "tau_s"}:
            lower.append(np.log(1e-6))
            upper.append(np.log(1e5))
        else:
            lower.append(np.log(1e-8))
            upper.append(np.log(1e5))
    return np.array(lower), np.array(upper)


def fit(
    times: ArrayLike,
    draws: ArrayLike,
    model_name: str,
    r: float,
    Q: float,
    priors: Mapping | None = None,
    conf: float = 0.95,
    j: float = 0.0,
) -> Tuple[Dict[str, float], Dict[str, Tuple[float, float]], Dict[str, float], List[Tuple[float, float]]]:
    """Fit the requested model to the observed drawdown curve.

    This provisional implementation only supports the lagging and Theis
    solutions.  Parameters are optimised in log-space via ``least_squares``
    and approximate confidence intervals are obtained from the Jacobian of the
    fit (assuming locally linear behaviour in log-space).
    """

    times = np.asarray(times, dtype=float)
    draws = np.asarray(draws, dtype=float)
    if times.ndim != 1:
        raise ValueError("times must be a one-dimensional array")
    if draws.shape != times.shape:
        raise ValueError("draws must match the shape of times")

    model_fn, param_names = _model_evaluator(model_name)

    def residuals(log_params: np.ndarray) -> np.ndarray:
        params = np.exp(log_params)
        kwargs = dict(zip(param_names, params))
        model_values = model_fn(times, kwargs.get("T"), kwargs.get("S"), kwargs.get("tau_q", 0.0), kwargs.get("tau_s", 0.0), r, Q, j)
        return model_values - draws

    x0 = _initial_log_params(param_names, priors)
    lower, upper = _bounds(param_names)
    result = least_squares(residuals, x0, bounds=(lower, upper), method="trf")

    if not result.success:
        raise RuntimeError(f"Model fit failed: {result.message}")

    log_params = result.x
    params = {name: float(np.exp(val)) for name, val in zip(param_names, log_params)}

    residual = result.fun
    dof = max(1, len(times) - len(log_params))
    sigma2 = float(residual @ residual) / dof
    jac = result.jac
    try:
        cov_log = np.linalg.inv(jac.T @ jac) * sigma2
    except np.linalg.LinAlgError:
        cov_log = np.full((len(log_params), len(log_params)), np.nan)

    z = 1.96 if np.isclose(conf, 0.95) else float(abs(np.sqrt(2) * erfinv(conf)))
    ci = {}
    for idx, name in enumerate(param_names):
        var_log = cov_log[idx, idx]
        if not np.isfinite(var_log):
            ci[name] = (np.nan, np.nan)
            continue
        sigma_log = np.sqrt(max(var_log, 0.0))
        center = params[name]
        ci[name] = (center * np.exp(-z * sigma_log), center * np.exp(z * sigma_log))

    fitted = model_fn(times, params.get("T"), params.get("S"), params.get("tau_q", 0.0), params.get("tau_s", 0.0), r, Q, j)
    rmse = float(np.sqrt(np.mean((fitted - draws) ** 2)))
    ss_res = float(np.sum((draws - fitted) ** 2))
    ss_tot = float(np.sum((draws - np.mean(draws)) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")

    fitted_curve = list(zip(times.tolist(), fitted.tolist()))

    return params, ci, {"rmse": rmse, "r2": r2}, fitted_curve
