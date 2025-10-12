
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
# serve the docs site at http://localhost:5173
python -m http.server 5173 --directory docs
# then open http://localhost:5173/
```

- 前端會在 `localStorage` 中記住 API Base，亦可透過網址後加上 `?api=https://your-api.onrender.com` 或在頁面上的 **API Base URL** 欄位修改。

## 如何開啟網站

在 GitHub Pages 設定頁面選擇 **Deploy from a branch**，並設定：

- **Source**：Deploy from a branch
- **Branch**：main（或你使用的分支）
- **Folder**：/docs

儲存後，GitHub Pages 會從 `docs/` 目錄發佈靜態網站。

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
