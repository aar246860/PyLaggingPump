
# lagwell

Pumping test analysis tool (MVP) based on **Lagging Theory** with a FastAPI backend and a minimal static **webapp** UI.

## Quickstart

Backend:
```bash
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn apps.api.main:app --reload
# open http://127.0.0.1:8000/docs
```

Frontend (static):
```bash
# serve the webapp at http://localhost:5173
python -m http.server 5173 --directory webapp
# then open http://localhost:5173/
```

## Fit API (stub initially)
POST /fit
```json
{
  "r": 30.0,
  "Q": 120.0,
  "data": [{"t":0.1,"s":0.02},{"t":0.2,"s":0.05}],
  "model":"lagging",
  "conf":0.95
}
```

## Report API
POST /report -> returns `{ "pdf_base64": "..." }`
