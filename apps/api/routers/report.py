
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import base64, io
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

router = APIRouter(prefix="/report", tags=["report"])

class ReportRequest(BaseModel):
    model: str
    Q: float
    r: float
    conf: float = 0.95
    params: dict
    ci: dict
    license_sn: Optional[str] = None

@router.post("")
def make_report(req: ReportRequest):
    # Minimal PDF stub using reportlab (works without system cairo)
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, height-50, "Pumping Test Result")
    c.setFont("Helvetica", 10)
    y = height-80
    lines = [
        f"Model: {req.model}",
        f"Q: {req.Q} m^3/h, r: {req.r} m",
        f"Confidence: {int(req.conf*100)}%",
        f"Params: {req.params}",
        f"CI: {req.ci}",
    ]
    for line in lines:
        c.drawString(40, y, line)
        y -= 14

    if req.license_sn:
        c.setFont("Helvetica-Oblique", 8)
        c.drawString(40, 40, f"License: {req.license_sn} • For research/pre-evaluation only, not a signed report.")
    c.showPage()
    c.save()
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return {"pdf_base64": base64.b64encode(pdf_bytes).decode("ascii")}
