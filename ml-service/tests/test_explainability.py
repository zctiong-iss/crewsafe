"""Unit coverage for SHAP driver importance (SCRUM-152)."""

from __future__ import annotations

import unittest

from sklearn.linear_model import Ridge

from crewsafe_ml.estimators import PersistenceFloorRegressor
from crewsafe_ml.explainability import compute_shap_drivers
from crewsafe_ml.features import TARGET_BY_HORIZON, build_feature_frame, model_feature_columns
from crewsafe_ml.training import _ridge_pipeline, build_hist_gradient_pipeline
from tests.test_features import synthetic_readings


def _fitted_features_and_columns():
    readings = synthetic_readings(periods=200)
    feature_frame = build_feature_frame(readings)
    numeric_features, categorical_features = model_feature_columns(feature_frame)
    feature_columns = numeric_features + categorical_features
    target = TARGET_BY_HORIZON[30]
    # The last few rows of a chronological series have no future value to predict.
    feature_frame = feature_frame.dropna(subset=[target]).reset_index(drop=True)
    return feature_frame, numeric_features, categorical_features, feature_columns, target


class ComputeShapDriversTest(unittest.TestCase):
    def test_ranks_real_feature_names_for_a_bare_hist_gradient_pipeline(self) -> None:
        feature_frame, numeric, categorical, feature_columns, target = _fitted_features_and_columns()
        pipeline = build_hist_gradient_pipeline(numeric, categorical, max_leaf_nodes=15)
        pipeline.fit(feature_frame[feature_columns], feature_frame[target])

        drivers = compute_shap_drivers(pipeline, feature_frame[feature_columns])

        self.assertGreater(len(drivers), 0)
        self.assertTrue(all({"feature", "mean_abs_shap"} == set(driver) for driver in drivers))
        # Sorted descending by importance.
        values = [driver["mean_abs_shap"] for driver in drivers]
        self.assertEqual(values, sorted(values, reverse=True))
        # No raw one-hot station column should leak through - it must collapse to "station_id".
        self.assertFalse(any(driver["feature"].startswith("station_id_") for driver in drivers))

    def test_ranks_real_feature_names_for_a_persistence_floor_wrapped_pipeline(self) -> None:
        feature_frame, numeric, categorical, feature_columns, target = _fitted_features_and_columns()
        wrapped = PersistenceFloorRegressor(
            build_hist_gradient_pipeline(numeric, categorical, max_leaf_nodes=15)
        )
        wrapped.fit(feature_frame[feature_columns], feature_frame[target])

        drivers = compute_shap_drivers(wrapped, feature_frame[feature_columns])

        self.assertGreater(len(drivers), 0)

    def test_returns_empty_for_a_linear_model_with_no_tree_to_explain(self) -> None:
        feature_frame, numeric, categorical, feature_columns, target = _fitted_features_and_columns()
        ridge = _ridge_pipeline(numeric, categorical, alpha=1.0)
        ridge.fit(feature_frame[feature_columns], feature_frame[target])

        self.assertEqual([], compute_shap_drivers(ridge, feature_frame[feature_columns]))

    def test_returns_empty_when_no_model_was_selected(self) -> None:
        self.assertEqual([], compute_shap_drivers(None, None))

    def test_returns_empty_for_an_unfitted_bare_estimator(self) -> None:
        self.assertEqual([], compute_shap_drivers(Ridge(), None))
