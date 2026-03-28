# 🏛️ State Public Finance (SPF) Dashboard

**An open, interactive dashboard for analysing India's state public finances — 28 states · 10 fiscal years · sourced from CAG Annual Finance Accounts & GSDP from MOSPI.**

> **Status:** Proof of Concept v1.0 — Static data, browser-only. A database-backed production version is in planning. 

---

## 📊 What This Is

This dashboard gives researchers, policymakers, and citizens a single place to explore how India's 28 states raise revenue, spend money, and manage debt — without having to download and parse CAG PDFs.

**Data covered (FY 2014-15 to 2023-24):**

| Category | Indicators |
|---|---|
| Revenue Receipts | Total, States' Own Tax (SGST, Excise, Stamps, Motor Vehicle, Sales Tax), Share in Union Taxes, Grants |
| Expenditure | Revenue Expenditure, Capital Expenditure — by sector and major function |
| Committed Expenditure | Salaries, Pension, Interest Payments |
| Debt | Internal Debt, Central Government Loans, Public Account Liabilities |
| FRBM Parameters | Fiscal Deficit, Revenue Deficit, Outstanding Guarantees |
| GSDP | State Gross Domestic Product (for normalisation ratios) |

**Dashboard features:**
- 🗺️ **Interactive India choropleth map** — 4-bucket quantile colouring so mid-range states are always visible
- 📐 **Metric normalisation** — Raw ₹ Cr · % of GSDP · % of Total Expenditure · % of Total Revenue
- 📑 **6 analytical tabs** — Overview · Receipts · Expenditure · Fiscal Health · State Compare · All States Table
- 🔀 **Multi-state comparison** with dynamic year range
- ⬇️ **Download** charts as PNG and tables as CSV or Excel
- 📱 **Responsive design** — works on laptops, tablets, and large monitors

---

## 🗂️ Repository Structure

```
spf-dashboard/
│
├── src/
│   ├── index.js                  ← React entry point
│   ├── App.js                    ← Root component
│   ├── psf_dashboard_v5.jsx      ← Main dashboard component (all tabs, charts, map)
│   ├── psf_data.js               ← All fiscal data (28 states × 10 years)
│   └── psf_geo.js                ← India state boundary SVG paths (from GeoJSON)
│
├── public/
│   └── index.html                ← HTML shell
│
├── package.json                  ← Dependencies and scripts
├── .gitignore
├── LICENSE                       ← MIT + data attribution
└── README.md                     ← This file
```

---

## 🚀 Running Locally

You need [Node.js](https://nodejs.org/) installed (version 16 or higher). If you haven't used Node before, download the "LTS" version from nodejs.org and install it like any normal program.

**Step 1 — Clone the repository**
```bash
git clone https://github.com/YOUR-USERNAME/spf-dashboard.git
cd spf-dashboard
```

**Step 2 — Install dependencies**
```bash
npm install
```
This downloads all the required libraries into a `node_modules` folder. It takes 1–2 minutes.

**Step 3 — Start the development server**
```bash
npm start
```
Your browser will automatically open at `http://localhost:3000` with the dashboard running.

**Step 4 — Build for production (optional)**
```bash
npm run build
```
This creates an optimised `build/` folder you can upload to any static hosting service (AWS S3, Netlify, Vercel, GitHub Pages).

---

## 📁 Key Files Explained

### `src/psf_data.js`
Contains all fiscal data as JavaScript exports. Each dataset is a nested object:
```js
// Example: Revenue Receipts
// rev_rec[state][year_index] = value in ₹ Crore
// year_index 0 = 2023-24, index 9 = 2014-15

export const rev_rec = {
  "Maharashtra": [405847, 364154, ...],
  "Karnataka":   [255724, 235011, ...],
  // ...all 28 states
};
```

### `src/psf_geo.js`
SVG path data for the India map, projected using Web Mercator from the source GeoJSON. Exports:
- `GEO_PATHS_PSF` — 28 states with PSF data
- `GEO_PATHS_UT` — 8 UTs rendered in grey (no fiscal data available)
- `GEO_CENTS` — centroid coordinates for state labels
- `GEO_ABBR_PSF` / `GEO_ABBR_UT` — 2-letter state/UT codes

### `src/psf_dashboard_v5.jsx`
The main React component (~1,400 lines). Imports data and geo files, renders all 6 tabs, handles all interactivity. No external API calls — fully browser-based.

---

## 📚 Data Sources

All data is from official Government of India publications:

| Source | URL |
|---|---|
| CAG Annual Finance Accounts 2023-24 | https://cag.gov.in/en/audit-report |
| State GSDP — MoSPI / CSO | https://mospi.gov.in/ |
| Administrative Boundaries (GeoJSON) | Publicly available India state boundary data - from Github |

> **Note:** This dashboard covers data up to FY 2023-24, the most recent CAG Finance Accounts release. New data will need to be added manually as each year's accounts are published.

---

## 🗺️ Roadmap

This is a **Proof of Concept**. The planned production platform will add:

- [ ] **Database backend** — PostgreSQL on AWS RDS, replacing static JS files
- [ ] **REST API** — Query any state, year, or indicator combination
- [ ] **Crowdsourced data** — Data collated by other institutions in PFM ecosystem
- [ ] **Economic indicators** — GSDP growth, employment, social sector, agriculture
- [ ] **District-level data** — Where available from primary sources
- [ ] **Automated ETL** — New CAG/RBI/MoSPI releases ingested automatically

---

## 🤝 Contributing

Contributions are welcome — both to the code and to the data.

### Contributing Code
1. Fork this repository (click the **Fork** button at the top right of this page)
2. Create a branch: `git checkout -b my-feature`
3. Make your changes
4. Submit a Pull Request with a clear description of what you changed and why

### Contributing Data
If you have data that would improve or extend this dashboard, please open an **Issue** with:
- The indicator name and definition
- The data source (must be a primary government or credible research source)
- The state(s) and year(s) covered
- The data in a CSV or Excel attachment

The team will review, validate, and integrate approved contributions.

### Reporting Issues
Found a number that looks wrong? A chart that doesn't render? Please open an **Issue** with:
- Which tab and which chart
- What you expected to see vs. what you saw
- Your browser and operating system

---

## ⚖️ License

Code: **MIT License** — free to use, modify, and distribute with attribution.

Data: All fiscal data belongs to the Government of India (CAG, MoSPI). It is reproduced here under fair use for public research and policy analysis. Please cite the original CAG Finance Accounts when using this data in publications.

See [`LICENSE`](LICENSE) for full terms and data attribution.

---

## 📬 Contact
For questions about the data, methodology, or the production roadmap, please open a GitHub Issue or reach out through your institutional contact.

---

*Built with [React](https://react.dev/) · [Recharts](https://recharts.org/) · [html2canvas](https://html2canvas.hertzen.com/) · [SheetJS](https://sheetjs.com/)*
