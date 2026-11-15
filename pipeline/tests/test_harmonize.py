"""Unit tests for the harmonization maths in pipeline/03_harmonize.py (standard library unittest, no new
dependency). The arrays here are tiny hand-made fixtures with known answers; they exist only to test the
functions and are never written to data/.

Run (PowerShell, from the project root):
    python -m unittest discover -s pipeline/tests -v
"""
import importlib.util
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

PIPELINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE))
_spec = importlib.util.spec_from_file_location("harm", PIPELINE / "03_harmonize.py")
h = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(h)

RATIOS = np.array([15.0, 14.0, 8.0, 6.0, 5.0, 4.0, 4.5, 5.0, 6.0, 8.0, 14.0, 17.0])


def seasonal_fixture(n_years=4, n_cells=3):
    """MODIS counts x and VIIRS counts y = x * RATIOS[month], columns are consecutive months."""
    months = np.tile(np.arange(1, 13), n_years)
    years = np.repeat(np.arange(2012, 2012 + n_years), 12)
    base = np.arange(1, n_cells + 1)[:, None] * (1.0 + (months % 5))[None, :]
    return base, base * RATIOS[months - 1][None, :], months, years


class ModelD(unittest.TestCase):
    def test_recovers_each_months_ratio(self):
        x, y, moy, _ = seasonal_fixture()
        params = h.fit("D", x, y, moy)
        np.testing.assert_allclose(params["ratios"], RATIOS)

    def test_month_without_modis_falls_back_to_overall_ratio(self):
        x, y, moy, _ = seasonal_fixture()
        x[:, moy == 3] = 0.0
        y[:, moy == 3] = 0.0
        params = h.fit("D", x, y, moy)
        self.assertAlmostEqual(params["ratios"][2], params["r"])
        self.assertAlmostEqual(params["ratios"][0], RATIOS[0])

    def test_predict_applies_the_right_month(self):
        x, y, moy, _ = seasonal_fixture()
        params = h.fit("D", x, y, moy)
        np.testing.assert_allclose(h.predict("D", params, x, moy), y)

    def test_beats_one_ratio_when_the_ratio_is_seasonal(self):
        x, y, moy, years = seasonal_fixture()
        oof = h.loyo_predictions(x, y, years, moy)
        err = {m: np.abs(oof[m].sum() - y.sum()) for m in ("A", "D")}
        month_err = {m: np.abs(oof[m] - y).mean() for m in ("A", "D")}
        self.assertLess(month_err["D"], month_err["A"] * 0.01)  # D is essentially exact on this fixture
        self.assertLess(err["D"], err["A"] + 1e-9)


class ModelE(unittest.TestCase):
    @staticmethod
    def fixture():
        """Four cells in two 1 degree blocks. The quiet block (x=2 per cell) has VIIRS/MODIS 10, the busy block
        (x=100 per cell) has 3, in every month, so the ratio depends on activity and not on the month."""
        bid = np.array([0, 0, 1, 1])
        moy = np.tile(np.arange(1, 13), 8)
        x = np.vstack([np.full((2, moy.size), 2.0), np.full((2, moy.size), 100.0)])
        y = x * np.array([10.0, 10.0, 3.0, 3.0])[:, None]
        return x, y, moy, np.repeat(np.arange(2012, 2020), 12), bid

    def test_recovers_a_ratio_that_depends_on_activity(self):
        x, y, moy, _, bid = self.fixture()
        params = h.fit("E", x, y, moy, bid)
        np.testing.assert_allclose(h.predict("E", params, x, moy, bid), y)
        self.assertEqual(np.asarray(params["table"]).shape, (12, len(h.ACTIVITY_EDGES) + 1))

    def test_beats_the_per_month_ratio_when_the_ratio_depends_on_activity(self):
        x, y, moy, years, bid = self.fixture()
        oof = h.loyo_predictions(x, y, years, moy, bid)
        self.assertLess(np.abs(oof["E"] - y).mean(), np.abs(oof["D"] - y).mean() * 0.01)

    def test_a_thin_bin_falls_back_to_the_month_ratio(self):
        x, y, moy, _, bid = self.fixture()
        params = h.fit("E", x, y, moy, bid)
        self.assertAlmostEqual(params["table"][0][6], params["ratios"][0])  # no block is that busy in the training data

    def test_keeps_the_plain_monthly_ratios_the_app_charts(self):
        x, y, moy, _, bid = self.fixture()
        self.assertEqual(len(h.fit("E", x, y, moy, bid)["ratios"]), 12)

    def test_needs_the_cell_blocks(self):
        x, y, moy, _, _ = self.fixture()
        with self.assertRaises(SystemExit):
            h.fit("E", x, y, moy)

    def test_cross_validation_skips_it_without_blocks(self):
        x, y, moy, years, _ = self.fixture()
        self.assertNotIn("E", h.loyo_predictions(x, y, years, moy))

    def test_block_ids_group_cells_by_whole_degree(self):
        cells = pd.DataFrame({"cell_lat": [10.125, 10.875, 11.125, 10.375], "cell_lon": [20.125, 20.875, 20.125, 21.125]})
        bid = h.block_ids(cells)
        self.assertEqual(bid[0], bid[1])
        self.assertEqual(len({bid[0], bid[2], bid[3]}), 3)


class ModelA(unittest.TestCase):
    def test_single_ratio_is_the_ratio_of_sums(self):
        x = np.array([[1.0, 2.0], [3.0, 4.0]])
        y = 5.0 * x
        self.assertAlmostEqual(h.fit("A", x, y, np.array([1, 2]))["r"], 5.0)

    def test_refuses_to_fit_without_modis(self):
        with self.assertRaises(SystemExit):
            h.fit("A", np.zeros((2, 2)), np.ones((2, 2)), np.array([1, 2]))


class Scoring(unittest.TestCase):
    def test_aoi_metrics_drops_months_with_zero_actual(self):
        out = h.aoi_metrics(np.array([0.0, 10.0, 20.0]), np.array([5.0, 11.0, 18.0]))
        self.assertEqual(out["n_aoi_months"], 2)
        self.assertAlmostEqual(out["median_ape_pct"], 10.0)

    def test_aoi_metrics_bias_sign(self):
        self.assertGreater(h.aoi_metrics(np.array([10.0, 10.0]), np.array([12.0, 12.0]))["bias_pct"], 0)
        self.assertLess(h.aoi_metrics(np.array([10.0, 10.0]), np.array([8.0, 8.0]))["bias_pct"], 0)


class SelectModel(unittest.TestCase):
    @staticmethod
    def aoi(**kw):
        return {m: {"median_ape_pct": e, "bias_pct": b} for m, (e, b) in kw.items()}

    def test_lowest_error_among_models_within_the_bias_limit(self):
        # A has the lowest error but a large bias, so it is not eligible.
        chosen, table, none = h.select_model(self.aoi(A=(20.0, 30.0), B=(25.0, 5.0), C=(22.0, -14.9), D=(30.0, 0.0)))
        self.assertEqual(chosen, "C")
        self.assertFalse(none)
        self.assertEqual([r["qualifies"] for r in table], [False, True, True, True])

    def test_the_bias_limit_itself_qualifies_and_just_above_does_not(self):
        self.assertEqual(h.select_model(self.aoi(A=(10.0, 15.0), B=(50.0, 0.0), C=(50.0, 0.0), D=(50.0, 0.0)))[0], "A")
        self.assertEqual(h.select_model(self.aoi(A=(10.0, 15.01), B=(50.0, 0.0), C=(60.0, 0.0), D=(60.0, 0.0)))[0], "B")

    def test_ties_go_to_the_simpler_model(self):
        self.assertEqual(h.select_model(self.aoi(A=(40.0, 0.0), B=(10.0, 1.0), C=(10.0, 1.0), D=(12.0, 1.0)))[0], "B")

    def test_when_none_qualifies_the_lowest_absolute_bias_wins_and_it_is_flagged(self):
        chosen, _, none = h.select_model(self.aoi(A=(5.0, 40.0), B=(5.0, -20.0), C=(5.0, 25.0), D=(50.0, 18.0)))
        self.assertEqual(chosen, "D")
        self.assertTrue(none)

    def test_the_candidate_table_lists_every_model_with_error_and_bias(self):
        _, table, _ = h.select_model(self.aoi(A=(1.0, 2.0), B=(3.0, 4.0), C=(5.0, 6.0), D=(7.0, 8.0)))
        self.assertEqual([r["model"] for r in table], ["A", "B", "C", "D"])  # only the models that were run
        self.assertEqual((table[3]["median_ape_pct"], table[3]["bias_pct"]), (7.0, 8.0))

    def test_the_rule_is_recorded_as_set_after_seeing_results(self):
        self.assertIn("after seeing", h.SELECTION_NOTE)


class SizeClasses(unittest.TestCase):
    def test_class_boundaries_use_the_longer_side(self):
        got = [h.size_class_of(v) for v in (1.0, 1.99, 2.0, 2.99, 3.0, 5.0, 7.0)]
        self.assertEqual(got, ["1-2", "1-2", "2-3", "2-3", "3-5", "3-5", "3-5"])

    def test_median_and_count_weighted_error_are_both_reported_and_differ(self):
        out = h.error_stats(np.array([100.0, 100.0, 1.0, 0.0]), np.array([110.0, 90.0, 3.0, 1.0]))
        self.assertAlmostEqual(out["median_ape_pct"], 10.0)  # months 1-3 only: errors 10%, 10%, 200%
        self.assertAlmostEqual(out["count_weighted_error_pct"], 100 * 23 / 201)  # all four months
        self.assertEqual(out["median_actual_count_nonzero"], 100.0)
        self.assertEqual(out["median_actual_count_all"], 50.5)
        self.assertEqual((out["n_pairs"], out["n_nonzero"]), (4, 3))

    def test_no_error_stats_when_the_actual_is_always_zero(self):
        self.assertIsNone(h.error_stats(np.zeros(3), np.ones(3)))

    def test_random_aois_use_the_same_draws_as_random_masks(self):
        g = np.arange(0.125, 10, 0.25)
        cells = pd.DataFrame([(a, b) for a in g for b in g], columns=["cell_lat", "cell_lon"])
        aois = h.random_aois(cells, [0, 0, 10, 10], np.random.default_rng(h.SEED))
        masks = h.random_masks(cells, [0, 0, 10, 10], np.random.default_rng(h.SEED))
        self.assertEqual(len(aois), h.N_RECTS)
        for (m, side), m2 in zip(aois, masks):
            np.testing.assert_array_equal(m, m2)
            self.assertGreaterEqual(side, h.RECT_MIN_DEG)
            self.assertLessEqual(side, h.RECT_MAX_DEG)

    def test_size_class_table_has_every_class_and_the_whole_region(self):
        g = np.arange(0.125, 10, 0.25)
        cells = pd.DataFrame([(a, b) for a in g for b in g], columns=["cell_lat", "cell_lon"])
        aois = h.random_aois(cells, [0, 0, 10, 10], np.random.default_rng(h.SEED))
        n_cells, n_months = len(cells), 24
        moy = np.tile(np.arange(1, 13), 2)
        years = np.repeat([2012, 2013], 12)
        y = np.full((n_cells, n_months), 5.0)
        p = y * 1.1
        pooled = (np.ones(12), np.ones(12))
        rows = h.size_class_table(y, p, aois, moy, years, False, [0, 0, 10, 10], pooled)
        self.assertEqual([r["id"] for r in rows], ["1-2", "2-3", "3-5", "region"])
        self.assertEqual(sum(r["n_aois"] for r in rows[:3]), h.N_RECTS)
        for r in rows:
            self.assertEqual(len(r["lo_mult_by_month"]), 12)
            self.assertEqual(len(r["hi_mult_by_month"]), 12)
            self.assertAlmostEqual(r["bias_pct"], 10.0, places=6)
            self.assertAlmostEqual(r["median_ape_pct"], 10.0, places=6)
        self.assertEqual(rows[3]["n_aois"], 1)


class IntervalCoverage(unittest.TestCase):
    @staticmethod
    def pairs(n_years=10, n_aois=5):
        # predicted is 100 everywhere; actual spreads evenly over 50..150, so the true 10-90 band is about 60..140
        idx = np.arange(n_years * 12 * n_aois)
        sp = np.full(idx.size, 100.0)
        sy = 100.0 * (0.5 + ((idx * 37) % 100) / 100.0)
        mm = np.tile(np.repeat(np.arange(1, 13), n_aois), n_years)
        yy = np.repeat(np.arange(2010, 2010 + n_years), 12 * n_aois)
        return sy, sp, mm, yy

    def test_coverage_is_near_the_target_for_a_well_calibrated_band(self):
        cov = h.interval_coverage(*self.pairs(), per_month=False)
        self.assertGreater(cov["held_out_years_pct"], 70)
        self.assertLess(cov["held_out_years_pct"], 90)
        self.assertGreater(cov["in_sample_pct"], 70)
        self.assertEqual(cov["target_pct"], h.COVERAGE_TARGET)

    def test_a_band_fitted_on_other_years_undercovers_a_year_that_behaves_differently(self):
        sy, sp, mm, yy = self.pairs()
        sy[yy == 2019] *= 3.0  # the last year is far from the rest
        cov = h.interval_coverage(sy, sp, mm, yy, per_month=False)
        self.assertLess(cov["held_out_years_pct"], cov["in_sample_pct"] + 1e-9)

    def test_no_coverage_numbers_when_there_is_nothing_to_check(self):
        cov = h.interval_coverage(np.zeros(4), np.zeros(4), np.arange(1, 5), np.full(4, 2012), per_month=False)
        self.assertIsNone(cov["held_out_years_pct"])
        self.assertEqual(cov["n"], 0)


class ZeroPredictionRange(unittest.TestCase):
    def test_zero_pred_hi_is_a_percentile_of_the_actual_counts_in_zero_prediction_months(self):
        sy = np.array([0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 50.0])
        sp = np.array([0.0] * 10 + [10.0])
        self.assertAlmostEqual(h.zero_pred_hi(sy, sp), float(np.percentile(sy[:10], 90)))

    def test_zero_pred_hi_is_zero_when_the_model_never_predicts_zero(self):
        self.assertEqual(h.zero_pred_hi(np.array([1.0, 2.0]), np.array([1.0, 2.0])), 0.0)

    def test_months_predicted_zero_with_detections_now_count_as_covered_when_inside_the_bound(self):
        # 6 years x 12 months; predicted 100 in most months, 0 in some where VIIRS still saw a few detections
        years = np.repeat(np.arange(2012, 2018), 12)
        mm = np.tile(np.arange(1, 13), 6)
        sp = np.where(mm <= 8, 100.0, 0.0)
        sy = np.where(mm <= 8, 100.0 * (0.8 + 0.4 * ((mm * 7) % 10) / 10), (mm % 3).astype(float))
        cov = h.interval_coverage(sy, sp, mm, years, per_month=False)
        self.assertGreater(cov["held_out_years_pct"], 85)
        # per year: months 1-8 all have detections (8), months 10 and 11 have 1 and 2 (2 more); only those 2 were predicted 0
        self.assertAlmostEqual(cov["zero_pred_share_pct"], 20.0, places=6)
        self.assertIsNotNone(cov["held_out_years_pct_predicted_positive"])

    def test_the_zero_prediction_share_counts_only_months_with_detections(self):
        sy = np.array([0.0, 5.0, 5.0, 5.0])
        sp = np.array([0.0, 0.0, 4.0, 6.0])
        cov = h.interval_coverage(sy, sp, np.array([1, 1, 1, 1]), np.array([2012, 2013, 2014, 2015]), per_month=False)
        self.assertAlmostEqual(cov["zero_pred_share_pct"], 100.0 / 3)


class RecentBridge(unittest.TestCase):
    def months(self, n):
        return pd.date_range("2025-04-01", periods=n, freq="MS")  # 16 months end in 2026-07

    def test_a_recent_drift_is_flagged_even_when_the_whole_overlap_looks_fine(self):
        ratios = np.array([1.0] * 10 + [1.2, 1.25, 1.3, 1.2, 1.25, 1.3])
        out = h.recent_bridge(self.months(16), ratios)
        self.assertTrue(out["recent_outside_tolerance"])
        self.assertAlmostEqual(out["recent_ratio_median"], 1.25)
        self.assertEqual(out["recent_months"], ["2026-02", "2026-07"])
        self.assertAlmostEqual(float(np.median(ratios)), 1.0 + 0.0, delta=0.15)  # the whole-overlap median hides it

    def test_a_steady_ratio_is_not_flagged(self):
        out = h.recent_bridge(self.months(12), np.full(12, 1.02))
        self.assertFalse(out["recent_outside_tolerance"])

    def test_no_months_gives_no_verdict(self):
        out = h.recent_bridge(self.months(0), np.array([]))
        self.assertIsNone(out["recent_ratio_median"])
        self.assertFalse(out["recent_outside_tolerance"])


class SensorKeys(unittest.TestCase):
    def test_terra_modis_is_dropped_and_products_are_mapped(self):
        df = pd.DataFrame({
            "region": ["r"] * 4, "cell_lat": [0.0] * 4, "cell_lon": [0.0] * 4, "year": [2015] * 4, "month": [1] * 4,
            "product": ["modis_sp", "modis_sp", "viirs_snpp_sp", "unknown_product"],
            "platform": ["aqua", "terra", "snpp", "snpp"], "n_detections": [5, 7, 9, 11],
        })
        out = h.to_sensor_keys(df)
        self.assertEqual(sorted(out["sensor"]), ["modis_aqua", "viirs_snpp"])
        self.assertEqual(int(out.loc[out["sensor"] == "modis_aqua", "count"].iloc[0]), 5)


if __name__ == "__main__":
    unittest.main()
