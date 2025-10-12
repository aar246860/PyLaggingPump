
# Lagwell Webapp（純前端版）

Lagwell 抽水試驗頁面完全以前端執行：瀏覽器透過 **Pyodide** 載入 Python/NumPy/SciPy 執行 Theis 與 Lagging（半解析）擬合，並使用 **jsPDF** 生成 PDF 報告，無需任何後端 API。部署到 GitHub Pages 或任一靜態空間即可運作。
# Lagwell Webapp（靜態版）

Lagwell 抽水試驗頁面完全以前端執行：瀏覽器透過 **Pyodide** 載入 Python/NumPy/SciPy 做擬合，並使用 **jsPDF** 產出報告，無需任何後端 API。部署到 GitHub Pages 等純靜態空間即可。


## 使用方式

```bash
# 直接開啟 docs/index.html，或啟動簡單的靜態伺服器
python -m http.server --directory docs
# 然後瀏覽 http://localhost:8000/
```

1. 首次開啟時，頁面會顯示「Python 載入中」並自動下載 Pyodide / NumPy / SciPy。
2. 貼上或上傳含 `time_min, drawdown_m` 欄位的 CSV，設定 `r`、`Q` 與模型（Theis 或 Lagging）。
3. 按「開始擬合」即可由瀏覽器端 Python 完成曲線擬合與圖表繪製。
4. 「下載 PDF 報告」會由 jsPDF 直接輸出離線報告檔案。

> ❗️ 無需設定 API Base，也不用啟動 FastAPI；所有計算與報告生成都在使用者瀏覽器完成，完全符合 GitHub Pages 「純靜態檔案」的部署條件。

無需設定 API Base，也不用執行 FastAPI；所有計算都在使用者的瀏覽器完成。
