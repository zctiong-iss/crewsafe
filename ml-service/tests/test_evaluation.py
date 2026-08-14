"""Tests for model metrics and the safety-aware acceptance rule."""

from __future__ import annotations

import unittest

import numpy as np

from crewsafe_ml.evaluation import ForecastMetrics, evaluate_predictions, meets_acceptance_rule


class EvaluationTest(unittest.TestCase):
    def test_calculates_regression_and_band_metrics(self) -> None:
        actual = np.array([30.5, 31.5, 32.2, 33.4])
        predicted = np.array([30.7, 31.7, 32.4, 33.0])

        metrics = evaluate_predictions(actual, predicted)

        self.assertAlmostEqual(0.25, metrics.mae, places=5)
        self.assertEqual(1.0, metrics.macro_f1)
        self.assertEqual(1.0, metrics.recall_at_least_32)
        self.assertEqual(1.0, metrics.recall_at_least_33)
        self.assertEqual(
            {
                "BELOW_31": 0.2,
                "FROM_31_TO_32": 0.2,
                "FROM_32_TO_33": 0.2,
                "AT_LEAST_33": 0.4,
            },
            {band: round(error, 1) for band, error in metrics.mae_by_actual_band.items()},
        )

    def test_requires_better_mae_and_no_loss_of_high_risk_recall(self) -> None:
        persistence = metrics(mae=1.0, recall_32=0.8, recall_33=0.7)

        self.assertTrue(
            meets_acceptance_rule(
                metrics(mae=0.9, recall_32=0.8, recall_33=0.8),
                persistence,
            )
        )
        self.assertFalse(
            meets_acceptance_rule(
                metrics(mae=0.8, recall_32=0.79, recall_33=0.8),
                persistence,
            )
        )


def metrics(*, mae: float, recall_32: float, recall_33: float) -> ForecastMetrics:
    return ForecastMetrics(
        mae=mae,
        rmse=mae,
        mean_bias=0.0,
        macro_f1=1.0,
        recall_at_least_32=recall_32,
        recall_at_least_33=recall_33,
        mae_by_actual_band={band: mae for band in (
            "BELOW_31",
            "FROM_31_TO_32",
            "FROM_32_TO_33",
            "AT_LEAST_33",
        )},
        confusion_matrix=[
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
        ],
        sample_count=3,
    )


if __name__ == "__main__":
    unittest.main()
