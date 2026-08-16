"""Regression tests for the policy answer key used by the agent evaluation set."""

from __future__ import annotations

import unittest
from typing import Literal

from eval_scenarios import ExpectedAction, WorkerContext, expected_policy_decision


TEST_WORKER_ID = "worker-1"
SEVERE_RULE_REFERENCE = "UNACCLIMATISED_HEAVY_WORK_RULE"


class ExpectedPolicyDecisionTest(unittest.TestCase):
    def test_emergency_stop_overrides_worker_specific_heat_actions(self) -> None:
        mandatory, advisory = expected_policy_decision(
            33.0,
            [self.worker(TEST_WORKER_ID, "LIGHT", day=10)],
        )

        self.assert_actions(
            mandatory,
            [
                ("STOP_WORK", "MANDATORY", "EMERGENCY_STOP_RULE", [TEST_WORKER_ID]),
                (
                    "CLOSE_MONITORING",
                    "MANDATORY",
                    "EMERGENCY_STOP_RULE",
                    [TEST_WORKER_ID],
                ),
            ],
        )
        self.assertEqual([], advisory)

    def test_unacclimatised_heavy_worker_receives_severe_actions(self) -> None:
        mandatory, advisory = expected_policy_decision(
            21.0,
            [self.worker(TEST_WORKER_ID, "HEAVY", day=2)],
        )

        self.assert_actions(
            mandatory,
            [
                (
                    "REST_15_MIN_HOURLY",
                    "MANDATORY",
                    SEVERE_RULE_REFERENCE,
                    [TEST_WORKER_ID],
                ),
                (
                    "HYDRATE_HOURLY",
                    "MANDATORY",
                    SEVERE_RULE_REFERENCE,
                    [TEST_WORKER_ID],
                ),
            ],
        )
        self.assert_actions(
            advisory,
            [
                (
                    "CLOSE_MONITORING",
                    "ADVISORY",
                    SEVERE_RULE_REFERENCE,
                    [TEST_WORKER_ID],
                ),
                (
                    "RESCHEDULE_HEAVY_WORK",
                    "ADVISORY",
                    SEVERE_RULE_REFERENCE,
                    [TEST_WORKER_ID],
                ),
                (
                    "ROTATE_TO_LIGHT_DUTY",
                    "ADVISORY",
                    SEVERE_RULE_REFERENCE,
                    [TEST_WORKER_ID],
                ),
            ],
        )

    def test_acclimatised_heavy_worker_receives_standard_actions(self) -> None:
        mandatory, advisory = expected_policy_decision(
            24.0,
            [self.worker(TEST_WORKER_ID, "HEAVY", day=10)],
        )

        self.assertEqual(
            ["REST_10_MIN_HOURLY", "HYDRATE_HOURLY"],
            [action.action_code for action in mandatory],
        )
        self.assertEqual(
            ["CLOSE_MONITORING", "RESCHEDULE_HEAVY_WORK"],
            [action.action_code for action in advisory],
        )

    def test_safe_worker_receives_only_advisory_actions(self) -> None:
        mandatory, advisory = expected_policy_decision(
            27.9,
            [self.worker(TEST_WORKER_ID, "LIGHT", day=10)],
        )

        self.assertEqual([], mandatory)
        self.assertEqual(
            ["HYDRATE_REGULARLY", "SHADE_RECOVERY"],
            [action.action_code for action in advisory],
        )

    def test_same_action_is_merged_across_workers(self) -> None:
        mandatory, advisory = expected_policy_decision(
            28.0,
            [
                self.worker(TEST_WORKER_ID, "LIGHT", day=10),
                self.worker("worker-2", "LIGHT", day=10),
            ],
        )

        self.assertEqual(
            [TEST_WORKER_ID, "worker-2"],
            mandatory[0].applies_to,
        )
        self.assertEqual(
            [TEST_WORKER_ID, "worker-2"],
            advisory[0].applies_to,
        )

    @staticmethod
    def worker(
        worker_id: str,
        intensity: Literal["LIGHT", "MODERATE", "HEAVY"],
        *,
        day: int,
    ) -> WorkerContext:
        return WorkerContext(
            worker_id=worker_id,
            intensity=intensity,
            acclimatisation_day=day,
        )

    def assert_actions(
        self,
        actual: list[ExpectedAction],
        expected: list[tuple[str, str, str, list[str]]],
    ) -> None:
        self.assertEqual(
            expected,
            [
                (
                    action.action_code,
                    action.origin,
                    action.rule_reference,
                    action.applies_to,
                )
                for action in actual
            ],
        )


if __name__ == "__main__":
    unittest.main()
