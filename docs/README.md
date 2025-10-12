# Lagwell Pump Test Explorer (Pyodide)

Lagwell's pump-test workflow now ships as a modern, dark-mode web app that runs entirely in the browser. Pyodide loads NumPy/SciPy so the Theis and lagging analytical models are fitted locally, while jsPDF produces shareable reports—no server required.

## Key capabilities

- **100% static deployment**: load `docs/index.html` locally or via GitHub Pages and everything runs client-side.
- **Model metadata**: central `models.json` provides LaTeX formulas, parameter definitions, and assumptions rendered in the UI with MathJax.
- **Bootstrap confidence intervals**: residual bootstrap (configurable N) wraps the solver so each fit returns parameter estimates with percentile CIs.
- **Responsive dark UI**: Tailwind CDN + shadcn-inspired cards deliver a 2025 look with mobile/desktop layouts.
- **PDF exports**: jsPDF summarises inputs, metrics, parameter CIs, and embeds the observed vs fitted plot.

## Usage

```bash
# Option 1 – open directly
open docs/index.html

# Option 2 – serve locally
python -m http.server --directory docs
# then browse http://localhost:8000/
```

1. Provide drawdown data via CSV upload or by pasting text with the columns `time_min, drawdown_m` (optional `r_m`, `Q_m3ph`).
2. Pick the model (Lagging or Theis), confidence level, bootstrap sample count, and set observation radius/pumping rate.
3. Click **Fit model** to run SciPy's solver in the browser (first load takes a moment while Pyodide downloads).
4. Review parameters, confidence intervals, diagnostics, and plots. Export the PDF when satisfied.

## Notes

- Pyodide 0.28.3 is streamed from the CDN; initial load is ~10s on typical broadband, subsequent loads are cached.
- Bootstrap defaults to N=100 for fast UX. Increasing to 200 roughly doubles runtime but remains manageable on modern laptops.
- All Python objects created in Pyodide are cleaned up with `py.ffi.destroy_proxies` to avoid memory leaks during repeated fits.
- Tailwind is injected via CDN—no build step is required. Additional embellishments live in `docs/styles.css`.
