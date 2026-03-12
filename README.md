# Advance Wars Style Balance Analyzer

Single-file web app for comparative unit balance analysis from three CSV inputs:
- Units.csv
- Terrain.csv
- Damage.csv

The scoring model is strategic and procedural (not a board simulator), with normalized scores for:
- Combat Exchange
- Durability
- Threat Projection
- Endurance
- Fog Vision
- Utility

It also produces:
- Top 5 by total
- Top 5 by combat
- Top 5 by utility
- Bottom 5 overall

## Project Structure

- index.html: full app (UI + parser + scoring algorithm)
- csv_balance_analyzer_webapp.jsx: original React prototype preserved for reference

## Run Locally

You can open index.html directly in a browser.

If your browser blocks local file behaviors, run a tiny static server instead.

### PowerShell quick server (Python)

```powershell
python -m http.server 8080
```

Then visit:

- http://localhost:8080/

## Deploy to GitHub Pages (No Build Step)

This project is already static, so deployment is simple.

1. Create a GitHub repository and push this folder.
2. In GitHub repository settings, open Pages.
3. Under Build and deployment:
   - Source: Deploy from a branch
   - Branch: main
   - Folder: / (root)
4. Save and wait for deployment.
5. Open the provided Pages URL.

## Notes

- Terrain.csv is currently loaded for completeness and future extension, but not used in scoring yet.
- Damage cells with "-" are treated as 0.
- If multiple damage rows exist per attacker (e.g., multi-weapon rows), the highest value per defender is used.

## Maintenance Guidance

- Keep algorithm helpers small and pure.
- Keep role weighting values centralized in the scoring section.
- Add future model dimensions as new raw categories first, then normalize and weight.
