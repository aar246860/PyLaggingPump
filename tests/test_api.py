import numpy as np
from fastapi.testclient import TestClient

from apps.api.main import app
from core.models.lagging import drawdown_time_domain

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json().get("ok") is True


def test_fit_endpoint():
    T = 1.1e-3
    S = 8e-5
    tau_q = 40.0
    tau_s = 15.0
    r_obs = 35.0
    Q_si = 0.028
    Q_m3h = Q_si * 3600.0

    times_minutes = np.logspace(-2, 1.5, 18)
    times_seconds = times_minutes * 60.0
    draws = drawdown_time_domain(times_seconds, T, S, tau_q, tau_s, r_obs, Q_si)

    payload = {
        "r": r_obs,
        "Q": Q_m3h,
        "data": [{"t": float(t), "s": float(s)} for t, s in zip(times_minutes, draws)],
        "model": "lagging",
        "conf": 0.95,
    }

    response = client.post("/fit", json=payload)
    assert response.status_code == 200
    body = response.json()

    assert body["model"] == "lagging"
    params = body["params"]
    assert abs(params["T"] - T) / T < 0.2
    assert abs(params["S"] - S) / S < 0.3
    assert abs(params["tau_q"] - tau_q) / tau_q < 0.5
    assert abs(params["tau_s"] - tau_s) / tau_s < 0.5

    assert len(body["curves"]["observed"]) == len(times_minutes)
    assert len(body["curves"]["fitted"]) == len(times_minutes)
    assert body["metrics"]["rmse"] < 1e-3
