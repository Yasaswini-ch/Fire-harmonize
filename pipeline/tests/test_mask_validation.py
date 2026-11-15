"""Unit tests for the scoring in pipeline/05_validate_mask.py, on tiny hand-made rows with known answers.
Run (PowerShell):  python -m unittest discover -s pipeline/tests -v
"""
import importlib.util
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

PIPELINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE))
_spec = importlib.util.spec_from_file_location("maskval", PIPELINE / "05_validate_mask.py")
mv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mv)


def rows(spec):
    """spec: list of (lat, lon, date, confidence, type)."""
    return pd.DataFrame(spec, columns=["latitude", "longitude", "acq_date", "confidence", "type"]).astype(str)


class Keys(unittest.TestCase):
    def test_points_in_the_same_bin_share_a_key_and_neighbouring_bins_do_not(self):
        a, b, c = mv.keys([10.001], [20.001])[0], mv.keys([10.002], [20.0009])[0], mv.keys([10.006], [20.001])[0]
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)

    def test_the_neighbourhood_adds_the_eight_adjacent_bins(self):
        base = mv.keys([10.0], [20.0])
        self.assertEqual(len(mv.neighbourhood(base)), 9)
        self.assertIn(mv.keys([10.005], [20.005])[0], mv.neighbourhood(base))


class Score(unittest.TestCase):
    def setUp(self):
        # one static location at (10, 20); the mask knows it. A vegetation fire sits exactly on it (a false drop) and another
        # sits one bin away (only the 3x3 mask would drop it).
        self.mask = mv.keys([10.0], [20.0])
        self.mask3 = mv.neighbourhood(self.mask)
        self.df = rows([
            (10.0, 20.0, "2020-01-05", "n", 2),    # static, on the mask: removed
            (10.0, 20.0, "2020-01-06", "n", 2),    # static, on the mask: removed
            (50.0, 60.0, "2020-01-07", "n", 2),    # static, not on the mask: missed
            (10.0, 20.0, "2020-01-08", "n", 0),    # vegetation on the mask: falsely removed
            (10.005, 20.0, "2020-01-09", "n", 0),  # vegetation one bin away: kept by the exact mask, dropped by 3x3
            (30.0, 40.0, "2020-02-01", "h", 0),    # vegetation elsewhere: kept
            (30.1, 40.1, "2020-02-02", "l", 0),    # vegetation, low confidence: kept but not counted in the net bias
            (51.0, 61.0, "2020-02-03", "n", 2),    # static, not on the mask: missed, so it inflates February
        ])
        self.out = mv.score(self.df, self.mask, self.mask3)

    def test_totals(self):
        self.assertEqual((self.out["rows"], self.out["static"], self.out["veg"]), (8, 4, 4))

    def test_exact_mask_recall_and_false_drops(self):
        e = self.out["exact"]
        self.assertEqual((e["static_removed"], e["veg_removed"]), (2, 1))

    def test_neighbourhood_mask_removes_more_of_both(self):
        n = self.out["neighbourhood_3x3"]
        self.assertEqual((n["static_removed"], n["veg_removed"]), (2, 2))

    def test_monthly_counts_for_the_net_bias(self):
        self.assertEqual(self.out["monthly"], {"2020-01": 2, "2020-02": 1})  # true vegetation rows that are not low confidence
        # kept = everything the mask did not remove: January keeps the missed static row and the nearby vegetation fire,
        # February keeps the vegetation fire and the missed static row
        self.assertEqual(self.out["exact"]["kept_not_low"], {"2020-01": 2, "2020-02": 2})

    def test_summary_percentages(self):
        total = mv.merge({}, self.out)
        s = mv.summarize(total, "exact")
        self.assertAlmostEqual(s["recall_pct"], 50.0, places=2)
        self.assertAlmostEqual(s["false_drop_pct"], 25.0, places=3)
        # January: kept 2 vs true 2 -> 0 percent; February: kept 2 vs true 1 -> +100 percent
        self.assertEqual(s["net_monthly_bias_pct"]["min"], 0.0)
        self.assertEqual(s["net_monthly_bias_pct"]["max"], 100.0)

    def test_merging_two_files_adds_their_counts(self):
        total = mv.merge(mv.merge({}, self.out), self.out)
        self.assertEqual(total["rows"], 16)
        self.assertEqual(total["exact"]["static_removed"], 4)
        self.assertEqual(total["monthly"]["2020-01"], 4)


if __name__ == "__main__":
    unittest.main()
