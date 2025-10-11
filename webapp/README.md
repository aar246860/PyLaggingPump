
# Lagwell Webapp (static)

Minimal static UI to call the FastAPI backend.

## Run

Backend:
```bash
uvicorn apps.api.main:app --reload
```

Frontend:
```bash
python -m http.server 5173 --directory webapp
# open http://localhost:5173/
```

Set a custom API base (if backend is remote):
```js
localStorage.setItem('lagwell_api','https://your-api.example.com')
```
