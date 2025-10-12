# Lagwell Webapp（靜態版）

Lagwell 抽水試驗頁面完全以前端執行：瀏覽器透過 **Pyodide** 載入 Python/NumPy/SciPy 做擬合，並使用 **jsPDF** 產出報告，無需任何後端 API。部署到 GitHub Pages 等純靜態空間即可。

## 使用方式

```bash
# 直接開啟 docs/index.html，或啟動簡單的靜態伺服器
python -m http.server --directory docs
# 然後瀏覽 http://localhost:8000/
```

無需設定 API Base，也不用執行 FastAPI；所有計算都在使用者的瀏覽器完成。
