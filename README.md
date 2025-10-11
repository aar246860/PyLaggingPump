
# lagwell

A minimal MVP skeleton for a pumping test analysis tool based on **Lagging Theory**, with FastAPI endpoints and placeholders for core models, fitters, QA/QC, and PDF report generation.

## What's inside
- `apps/api`: FastAPI service with `/health`, `/fit` (stub), and `/report` (stub)
- `core/models`: placeholders for `lagging.py`, `theis.py`, `neuman.py`
- `core/fitters`: search/optimisation + de Hoog inverse Laplace (to be implemented)
- `core/qc`: data quality checks
- `report`: Jinja2 template and builder (stub)
- `datasets`: example CSVs
- `tests`: unit tests skeleton
- `cli`: local CLI wrapper
- `licensing`: placeholder for license validation
- Dockerfile & docker-compose for deployment

## Quickstart (local)
```bash
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

uvicorn apps.api.main:app --reload
# open http://127.0.0.1:8000/docs
```

### Test the API
```bash
# Health check
curl http://127.0.0.1:8000/health

# Minimal fit (stubbed response)
curl -X POST http://127.0.0.1:8000/fit -H "Content-Type: application/json" -d '{
  "r": 30.0,
  "Q": 120.0,
  "data": [{"t":0.1,"s":0.02},{"t":0.2,"s":0.05}],
  "model":"lagging",
  "conf":0.95
}'
```
The current `/fit` endpoint returns a placeholder payload. You (or Codex) can implement the real math in `core/models/lagging.py` and `core/fitters/search.py`.
