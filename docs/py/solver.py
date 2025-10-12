import numpy as np
from scipy.optimize import least_squares
from scipy.special import expn, j0, j1, y0, y1


FOUR_PI = 4.0 * np.pi


def _ensure_array(t):
    arr = np.asarray(t, dtype=float)
    if arr.ndim != 1:
        arr = arr.ravel()
    return arr


def theis_drawdown(t, T, S, r, Q):
    """Compute drawdown using the classical Theis solution."""
    times = _ensure_array(t)
    T = float(T)
    S = float(S)
    r = float(r)
    Q = float(Q)

    safe_times = np.maximum(times, 1e-12)
    u = (r ** 2 * S) / (4.0 * T * safe_times)
    w_u = expn(1, u)
    return (Q / (FOUR_PI * T)) * w_u


def hantush_drawdown(t, T, S, r, Q, j):
    """Simple leaky aquifer approximation based on Theis."""
    times = _ensure_array(t)
    base = theis_drawdown(times, T, S, r, Q)
    leakage = 1.0 - np.exp(-times / max(j, 1e-12))
    return base * leakage


def lagging_drawdown_time(t, T, S, tau_q, tau_s, r, Q, j=0.0):
    """Lagging response using a damped Bessel-based storage term."""
    times = _ensure_array(t)
    T = float(T)
    S = float(S)
    tau_q = max(float(tau_q), 1e-6)
    tau_s = max(float(tau_s), 1e-6)
    r = float(r)
    Q = float(Q)
    j = float(j)

    base = theis_drawdown(times, T, S, r, Q)

    if j == 0.0:
        return base

    order = np.argsort(times)
    sorted_times = times[order]
    dt = np.diff(np.concatenate([[0.0], sorted_times]))
    freq = np.sqrt(sorted_times / tau_q)

    with np.errstate(divide='ignore', invalid='ignore'):
        j_term = j0(freq) - j1(freq)
        y_term = np.where(freq > 0, y0(freq) - y1(freq), 0.0)

    damping = np.exp(-sorted_times / tau_s)
    kernel = damping * (j_term + 0.15 * y_term)
    storage_term = np.cumsum(kernel * dt)

    adjustment = (Q / (FOUR_PI * T)) * storage_term * j
    adjusted = base[order] + adjustment

    result = np.empty_like(times)
    result[order] = adjusted
    return result


def _initial_guess(model_name, times, draws):
    span = np.maximum(times.max() - times.min(), 1e-3)
    draw_span = np.maximum(draws.max() - draws.min(), 1e-3)
    T0 = max(draw_span, 1e-4)
    S0 = 1e-4
    if model_name == 'lagging':
        return np.log([T0, S0, span * 0.1 + 1e-3, span * 0.3 + 1e-3]), 0.1
    return np.log([T0, S0])


def fit_model(times, draws, model_name, r, Q, priors=None):
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
            np.array([np.log(1e-8), np.log(1e-10), np.log(1e-5), np.log(1e-5), -1.0]),
            np.array([np.log(1e4), np.log(1.0), np.log(1e4), np.log(1e4), 1.0]),
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

    result = least_squares(residual, x0, bounds=bounds, max_nfev=500)

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
    rmse = float(np.sqrt(np.mean(residuals ** 2)))
    ss_tot = float(np.sum((draws_sorted - np.mean(draws_sorted)) ** 2))
    ss_res = float(np.sum(residuals ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 1.0

    metrics = {'rmse': rmse, 'r2': r2, 'success': bool(result.success)}
    fitted_curve = [[float(t), float(s)] for t, s in zip(times_sorted, fitted)]

    return params, metrics, fitted_curve
