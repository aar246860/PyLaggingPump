
from fastapi.testclient import TestClient
from apps.api.main import app

client = TestClient(app)

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json().get("ok") is True

def test_fit_stub():
    payload = {
        "r": 30.0,
        "Q": 120.0,
        "data": [{"t":0.1,"s":0.02},{"t":0.2,"s":0.05}],
        "model":"lagging",
        "conf":0.95
    }
    r = client.post("/fit", json=payload)
    assert r.status_code == 200
    j = r.json()
    assert j["model"] == "lagging"
    assert "params" in j
