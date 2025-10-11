
import numpy as np
from core.models.lagging import drawdown_time_domain

def test_lagging_placeholder():
    t = np.array([0.1, 0.2, 0.5, 1.0])
    y = drawdown_time_domain(t, 1e-3, 1e-4, 1e-2, 5e-3, 30.0, 120.0/3600.0)
    assert y.shape == t.shape
