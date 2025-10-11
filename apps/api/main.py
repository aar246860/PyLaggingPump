
from fastapi import FastAPI
from .routers import fit, report

app = FastAPI(title="Lagwell API", version="0.1.0")

@app.get("/health")
def health():
    return {"ok": True}

app.include_router(fit.router)
app.include_router(report.router)
