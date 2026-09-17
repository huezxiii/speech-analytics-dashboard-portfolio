# Speech Analytics Power BI Export

This project uses the Power BI Project (.pbip) format. Before opening it, three preview features must be enabled in Power BI Desktop (verified against build 2.157.879.0 Microsoft Store).

## Before you open this project

1. Open Power BI Desktop.
2. Navigate to: `File > Options and settings > Options > Preview features`.
3. Ensure the following three toggles are checked:
   - `Power BI Project (.pbip) save option`
   - `Store semantic model using TMDL format`
   - `Store reports using enhanced metadata format (PBIR)`
4. Select OK.

Power BI Desktop must be restarted after enabling the preview toggles for the changes to take effect.

## Opening the report and loading data

1. Extract this ZIP to a folder on your computer.
2. In Power BI Desktop, use File > Open and select `powerbi/SpeechAnalytics.pbip`.
3. Click "Refresh now" when prompted. Power BI will report that CsvFolderPath has not been set yet. This is expected — continue to step 4.
4. On the Home ribbon, open Transform data > Edit parameters and set `CsvFolderPath` to the extracted `SpeechAnalytics.SemanticModel` folder (the folder that contains `data/`) — not the ZIP root and not the CSV file itself. Select OK.
5. Click "Apply changes" in the yellow banner. Power BI holds parameter edits until you apply them, so refreshing before this step reuses the old value and shows the same error again.
6. Click Refresh. The Calls table now loads.

You only do this once per extracted copy. If you move the folder later, repeat steps 4-6 with the new location.

Relative-date windows are measured against your computer's current system date; a dataset whose calls all predate the last 7 or 30 days will legitimately show an empty selection when a relative window is picked, reflecting that the data is historical rather than that the report is broken.

## Call Detail & Data Exposure

Call Detail displays unaggregated call transcripts and agent identifiers verbatim. Page hiding is navigation-only, not an access boundary; this report has no row-level security (RLS), and all data is accessible to anyone with file access.

The Call Detail page is a drill-through target reached by right-clicking data points in Coaching Focus or Calls by Category. It is set to hidden in view mode so it is reached by drilling rather than by tab navigation. This hiding is a navigation choice that removes nothing from reach: all underlying data remains directly accessible through dashboard-ready.csv, DAX expressions, and Power Query.

## Report targets and reference values

Visual targets and reference lines in this report use a generator default, not a published organizational target, or a whole-dataset rate computed from the loaded data, not an organizational target. They do not represent confirmed organizational performance standards.

- **barQueueBreakdown**: 85 (points) — QA target 85 of 100 (generator default, not a published organizational target)
- **gaugeFcrRate**: measure `FCR Target` — FCR target 75% (generator default, not a published organizational target)
- **gaugeComplianceRisk**: measure `Compliance Risk Rate (All Data)` — Whole-dataset flagged-call rate (whole-dataset rate computed from the loaded data, not an organizational target)

## Export scope

Export scope: full dataset (1200 rows).
Every row of the loaded source file is included.

## If something goes wrong

| Symptom | What to do |
|---|---|
| Repair prompt on open | Preview toggles not enabled or Desktop not restarted. Ensure all three preview features are enabled and restart Power BI Desktop before opening the .pbip file. |
| Folder moved after extraction | If the project directory was moved or renamed, repeat steps 4-6 with the new folder location. |
| CsvFolderPath pointed at the extracted ZIP root | CsvFolderPath must point to the extracted SemanticModel subfolder containing `data/`, not the root directory. |
| CsvFolderPath pointed directly at the CSV file | CsvFolderPath must point to the `.SemanticModel` folder itself, not directly to `dashboard-ready.csv`. |
| Preview toggles not enabled or Desktop not restarted | Open `File > Options and settings > Options > Preview features`, enable all three toggles, and restart Power BI Desktop. |
| A bar or line point is missing on a chart whose subtitle reads Axis starts at N | That chart's value axis starts at N instead of zero. The generator checked every such floor against the data it was built from, but after a refresh with different data a value at or below N is not drawn. Read that value from its data label or tooltip. |
