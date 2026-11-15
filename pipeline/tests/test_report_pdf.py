"""Unit tests for the small pure parts of pipeline/06_report_pdf.py, on hand-made input with known answers.
Run (PowerShell):  python -m unittest discover -s pipeline/tests -v
"""
import importlib.util
import sys
import unittest
from pathlib import Path

PIPELINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE))
_spec = importlib.util.spec_from_file_location("reportpdf", PIPELINE / "06_report_pdf.py")
rp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rp)

ROWS = [{"month": "2020-01", "count": 10.0}, {"month": "2020-02", "count": 30.0}]
REP = {
    "rows": ROWS, "total": 40.0, "estimatedMonths": 1,
    "comparison": {"label": "above", "percentDiff": 95.54, "month": "2020-02", "provisional": True},
    "topMonths": [{"month": "2020-02", "count": 30.0}], "topYears": [{"year": 2020, "total": 40.0}],
}


class ReportPdf(unittest.TestCase):
    def test_month_label_and_number_format(self):
        self.assertEqual(rp.month_label("2026-11"), "November 2026")
        self.assertEqual(rp.fmt(18297259.6), "18,297,260")

    def test_headline_stats(self):
        s = {label: value for label, value, _ in rp.stat_values(REP)}
        self.assertEqual(s["Now vs normal"], "+96%")
        self.assertEqual(s["Detections in range"], "40")
        self.assertEqual(s["Estimated share"], "50%")
        self.assertEqual(s["Peak month"], "February 2020")

    def test_no_baseline_is_n_a_not_a_number(self):
        s = {label: value for label, value, _ in rp.stat_values({**REP, "comparison": None})}
        self.assertEqual(s["Now vs normal"], "n/a")

    def test_every_year_row_has_a_source_flag_and_estimated_years_a_range(self):
        rep = {"anomaly": {"years": [
            {"year": 2005, "total": 100.0, "lo": 80.0, "hi": 150.0, "estimated": True, "provisional": False},
            {"year": 2015, "total": 200.0, "lo": 200.0, "hi": 200.0, "estimated": False, "provisional": False}]}}
        rows = rp.annual_table(rep)
        self.assertEqual(rows[1], [2005, "100", "80 to 150", "modis_estimated"])
        self.assertEqual(rows[2], [2015, "200", "observed", "viirs_native"])


if __name__ == "__main__":
    unittest.main()
