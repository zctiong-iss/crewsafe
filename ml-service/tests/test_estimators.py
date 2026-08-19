"""Tests for transparent safety constraints around trained forecasts."""

from __future__ import annotations

import unittest

import numpy as np
import pandas as pd
from sklearn.dummy import DummyRegressor

from crewsafe_ml.estimators import PersistenceFloorRegressor, apply_persistence_floor


class PersistenceFloorTest(unittest.TestCase):
    def test_uses_the_warmer_of_model_prediction_and_current_wbgt(self) -> None:
        predictions = apply_persistence_floor(
            np.array([30.0, 34.0]),
            np.array([32.0, 33.0]),
        )

        np.testing.assert_array_equal(np.array([32.0, 34.0]), predictions)

    def test_regressor_keeps_the_current_wbgt_floor_after_fitting(self) -> None:
        features = pd.DataFrame({"wbgt_t": [31.0, 33.0], "other": [1.0, 2.0]})
        model = PersistenceFloorRegressor(DummyRegressor(strategy="constant", constant=32.0))

        model.fit(features, np.array([31.5, 33.5]))

        np.testing.assert_array_equal(np.array([32.0, 33.0]), model.predict(features))

    def test_rejects_missing_current_wbgt(self) -> None:
        model = PersistenceFloorRegressor(DummyRegressor())
        features = pd.DataFrame({"other": [1.0]})
        target = np.array([30.0])

        with self.assertRaisesRegex(ValueError, "missing wbgt_t"):
            model.fit(features, target)


if __name__ == "__main__":
    unittest.main()
