
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import fit, report

app = FastAPI(title="Lagwell API", version="0.1.0")

# CORS: allow local dev (adjust before production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True}

app.include_router(fit.router)
app.include_router(report.router)
