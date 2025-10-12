
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

- 前端會在 `localStorage` 中記住 API Base；可於網址加上 `?api=https://your-api.example.com` 或透過頁面下方的「連線設定」區塊調整。

## 在本機測試（HTTP ↔ HTTP）

1. 啟動後端：`uvicorn apps.api.main:app --reload`
2. 啟動前端靜態站台：`python -m http.server 5173 --directory docs`
3. 開啟 `http://localhost:5173/`，預設 API Base 會填入 `http://localhost:8000`，`連線設定` 中應顯示 ✅ 已連線。
4. 可上傳 CSV、貼上資料並執行擬合，下載 PDF 報告。

## 如何開啟網站

到 Repository 的 **Settings → Pages**，將 **Source** 改為 **Deploy from a branch**，並設定：

- **Branch**：`main`（或你使用的分支）
- **Folder**：`/docs`

儲存後，GitHub Pages 會從 `docs/` 目錄發佈靜態網站；入口檔必須位於 `docs/` 根層，可使用 `index.html`、`index.md` 或 `README.md` 任一檔案作為首頁。

## 在 GitHub Pages（HTTPS）測試

1. 將 FastAPI 後端部署在支援 HTTPS 的服務（如 Render、Fly.io 等），並設定環境變數 `CORS_ALLOW_ORIGINS=https://<你的 GitHub 帳號>.github.io`。
2. 開啟你的 Pages 網站，網址後面加上 `?api=https://你的https後端.example.com`，或在頁面「連線設定」輸入該 HTTPS API Base 後按「儲存」。
3. 重新整理後，`連線設定` 中應顯示 ✅ 已連線；此時就能正常呼叫 `/fit` 與 `/report`。
4. 若瀏覽器 Console 顯示 **Mixed Content** 或 `#apiStatus` 出現⚠️警告，代表在 HTTPS 頁面呼叫 HTTP 後端，此請求會被瀏覽器封鎖。請改用 HTTPS 後端或在本機以 HTTP 服務前端。

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
