---
project_name: "speech-analytics-dashboard-portfolio"
primary_language: "JavaScript"
technologies: ["JavaScript", "Python", "Chart.js", "PapaParse", "JSZip", "pywebview", "PyInstaller", "Power BI", "TMDL", "IndexedDB"]
type: "PORTFOLIO"
domain: "DATA-ANALYTICS"
stage: "COMPLETE"
stack: "JS-VANILLA"
tags: ["speech-analytics", "dashboard", "white-label", "portfolio", "power-bi", "preprocessor", "tmdl", "pbir"]
---

# Project Overview
An enterprise-grade, 100% sanitized speech analytics and contact center intelligence platform. Features an offline-first client-side web dashboard, a pure Python preprocessing engine with pywebview desktop GUI, and a programmatic client-side Power BI project (.pbip / TMDL) generator.

## Technologies Used
* **Languages:** JavaScript (ES2022), Python 3.10+, HTML5, CSS3, DAX
* **Frameworks/Libraries:** Chart.js, PapaParse, JSZip, pywebview, PyInstaller, pytest
* **Databases/Tools:** IndexedDB, Microsoft Power BI Desktop (.pbip, TMDL, PBIR), Git

## Key Details
* **Core Functionality:** 4-tab analytical command center (Executive Summary Hub, Ops & QA Command, Compliance & Coaching, and Speech Analytics NLP Query Sandbox with Boolean and W/15 proximity search), companion desktop preprocessor with visual diff preview table, and in-browser programmatic Power BI project generation.
* **Notable Architecture:** Zero-CDN offline-first web architecture, strict Core/Shell separation in preprocessor (`preprocess_core.py` vs `gui/app.py`), mathematically sound duration-weighted ratio DAX measures, WCAG 2.1 AA ARIA screen-reader accessibility tables, and 12 automated structural quality gate checks.
