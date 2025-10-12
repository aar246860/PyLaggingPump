
# Lagwell Webapp (static)

Pure front-end pumping test UI. By default the page runs **Pyodide** inside the browser to fit data without needing the FastAPI backend.

## Run

Backend:
```bash
uvicorn apps.api.main:app --reload
```

Frontend only:
```bash
# simply double-click docs/index.html or
python -m http.server --directory docs
# open http://localhost:8000/
```

Optional remote backend:
```js
localStorage.setItem('lagwell_api','https://your-api.example.com')
```
