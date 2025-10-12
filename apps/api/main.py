
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import fit, report

app = FastAPI(title="Lagwell API", version="0.1.0")

raw_origins = os.getenv("CORS_ALLOW_ORIGINS", "*")
allow_origins = [
    origin.strip()
    for origin in raw_origins.split(",")
    if origin.strip()
]
if not allow_origins or allow_origins == ["*"]:
    allow_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True}

app.include_router(fit.router)
app.include_router(report.router)
