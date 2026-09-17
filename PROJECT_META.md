---
project_name: "speech-analytics-dashboard-portfolio"
primary_language: "JavaScript"
technologies: ["JavaScript", "Python", "Chart.js", "PapaParse", "pywebview", "TMDL", "IndexedDB"]
type: "PORTFOLIO"
domain: "DATA-ANALYTICS"
stage: "PROTO"
stack: "JS-VANILLA"
tags: ["speech-analytics", "dashboard", "white-label", "portfolio", "power-bi", "preprocessor"]
---

# Project Overview
A white-labeled, public portfolio repository demonstrating an end-to-end speech analytics solution. It pairs a local-first client-side analytics dashboard with a Python desktop preprocessing application and a TMDL-based Power BI semantic model generator.

## Technologies Used
* **Languages:** JavaScript, Python, HTML5, CSS3, DAX
* **Frameworks/Libraries:** Chart.js, PapaParse, JSZip, pywebview, PyInstaller, pytest
* **Databases/Tools:** IndexedDB, Power BI (.pbip / TMDL), Git

## Key Details
* **Core Functionality:** 4-tab speech analytics dashboard (Executive Summary Hub, Ops & QA Command, Compliance & Coaching, NLP Query Sandbox with W/15 proximity search), client-side CSV processing and persistence, desktop GUI preprocessor with raw vs. transformed diff preview, and automated Power BI report/model generation.
* **Notable Architecture:** Core/Shell separation in preprocessor (`preprocess_core.py` vs `gui/app.py`), local-first in-browser analytics with zero server dependency, and programmatic TMDL/PBIR artifact compilation.
