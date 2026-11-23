# fluorescence — personal spectra workbench

A local-first browser app for comparing **real FPbase excitation and emission spectra**. It remembers the small set of dyes/proteins you repeatedly work with rather than making you search again each visit.

## What is working

- Search FPbase fluorophores, cache a probe the first time you select it, and keep your previous probes in a persistent list.
- **Overlaid view:** show many probe spectra on one wavelength axis.
- **Stacked view:** each active probe has its own graph, **all with identical X-axis wavelength limits**, and one mouse-position ruler travels through every graph simultaneously. Hover reports interpolated intensities at the same wavelength.
- Per-probe on/off checkbox, EX and EM toggles, and 0–100% opacity slider. Emission is a solid curve and excitation dashed.
- Set wavelength minimum/maximum; reset to automatic range; show/hide grid and under-curve fill.
- Store named **experiment panels**, restoring selections, EX/EM switches, opacities and chart layout.
- Molecular data (where published): **extinction coefficient (EC)** in M⁻¹cm⁻¹, **quantum yield (QY)**, and **EC × QY / 1000** as a relative molecular brightness indicator. It is NOT a measured signal intensity. Graphs intentionally show independently normalized spectra.
- Import custom vendor/measured CSV curves; export the whole library as JSON and restore from backup; export charts as SVG or PNG.
- No analytics, accounts, tokens, cookies, libraries or build step.

## Publish on GitHub Pages

1. Create a **public** repository called `fluorescence` under your `vubio` GitHub account at <https://github.com/new> (do not initialize with a README when uploading with Git).
2. Upload all the files/folders from this project to the repository's **main** branch (keep `.github/workflows/pages.yml` intact). Alternatively, run `git init`, `git add .`, `git commit -m "Initial fluorescence site"`, `git branch -M main`, `git remote add origin https://github.com/vubio/fluorescence.git`, `git push -u origin main`.
3. Go to repository **Settings → Pages**, select **GitHub Actions** as the build and deployment source.
4. Go to **Actions → Refresh FPbase and publish website → Run workflow**. The workflow downloads FPbase's public metadata and real curves for the seed dye list, then publishes the static site.
5. Open **https://vubio.github.io/fluorescence/** once GitHub shows the deployment completed.

Static website hosting is free on GitHub Pages for public repositories. GitHub Pages itself cannot provide cross-device personal storage or a backend proxy. This app's saved list lives in **that browser's localStorage**; export JSON occasionally for safekeeping or to move to another computer. A future Supabase or GitHub sync may be added deliberately, rather than exposing a personal access token to a public site.

## FPbase data and limitations

- FPbase GraphQL endpoint: <https://www.fpbase.org/graphql/>.
- The script `scripts/fetch_fpbase.py` first indexes all FPbase fluorophores and then downloads **actual** excitation and emission curve points for names listed in `data/seed-probes.txt`. The cache updates weekly using GitHub Actions, when reachable.
- New names not precached may be loaded directly from the FPbase GraphQL API using the browser. Cross-origin browser requests depend on FPbase's CORS configuration; if unavailable, add the probe name to `data/seed-probes.txt` and rerun the GitHub workflow, or import its spectral CSV. Do not use an untrusted public CORS relay for scientific data.
- Different probe spectra can be incomplete, and some probe states have multiple spectra. The initial importer selects the first EX (or AB) and first EM record per named fluorophore. We should later expose state/source choice for probes where conditions (pH, environment, oxidation) matter.
- Curves are normalized to their own maxima for accurate **shape** comparisons. Relative heights of different curves in the viewer are not measured brightness.
- FPbase EC × QY is a *molecular* brightness measure under idealized conditions, not cell expression, staining amount, excitation efficiency, filter transmission, PMT gain, or laser power. The calculated column is EC × QY / 1000 (same convention used by FPbase); direct fluorescence intensity predictions require your instrument configuration.
- If the FPbase cache refresh cannot contact the API, the workflow will retain an existing `data/fpbase-cache.json` if one exists and can still deploy the site. Fresh repo without a cache may offer live API search and CSV import until the first successful cache run.

## Custom CSV schema

Preferred columns: `wavelength,excitation,emission` (nm and arbitrary intensity). `wavelength,emission` and `wavelength,excitation` also work. For two numeric columns with no headers, the app asks whether the second column is EX or EM. Values are normalized for charting, and the imported probe is tagged *Custom CSV*.

## Local testing

Run `python -m http.server 8080` inside the repo and open <http://localhost:8080/>. File:// mode may prevent JSON catalogue loading. No JavaScript dependencies are required.

## Attribution

**FPbase**: Lambert TJ (2019), *FPbase: a community-editable fluorescent protein database*, Nature Methods. DOI: [10.1038/s41592-019-0352-8](https://doi.org/10.1038/s41592-019-0352-8). Retain citations to primary references associated with individual spectral data as appropriate. The site and local source code are independently authored; the data pipeline does not scrape HTML pages or misrepresent synthetic spectra as experimental measurements.