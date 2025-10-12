import numpy as np

from core.models.lagging import drawdown_time_domain
from core.models.theis import drawdown_time_domain as theis_drawdown


def test_lagging_matches_theis_when_tau_zero():
    T = 1.2e-3
    S = 5e-5
    r = 30.0
    Q = 0.03
    times = np.logspace(-1, 4, 24)

    lagging = drawdown_time_domain(times, T, S, 1e-8, 1e-8, r, Q, j=0.0, rw=0.15)
    theis = theis_drawdown(times, T, S, r, Q)

    rel_err = np.max(np.abs(lagging - theis) / np.maximum(theis, 1e-12))
    assert rel_err < 0.05


def test_lagging_drawdown_decreases_with_leakage():
    T = 9e-4
    S = 1.5e-4
    r = 45.0
    Q = 0.025
    times = np.logspace(0, 4, 20)

    no_leak = drawdown_time_domain(times, T, S, 20.0, 10.0, r, Q, j=0.0, rw=0.2)
    with_leak = drawdown_time_domain(times, T, S, 20.0, 10.0, r, Q, j=1e-2, rw=0.2)

    assert np.all(with_leak <= no_leak + 1e-10)
    assert with_leak[-1] < no_leak[-1]
