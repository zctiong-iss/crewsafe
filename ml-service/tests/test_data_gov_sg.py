"""Tests for historical weather acquisition and normalization."""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from crewsafe_ml.data_gov_sg import (
    HistoricalWeatherClient,
    UpstreamPayloadError,
    UpstreamRequestError,
    WeatherMetric,
)
from crewsafe_ml.dataset_io import build_historical_dataset


class HistoricalWeatherClientTest(unittest.TestCase):
    def test_reads_every_wbgt_page_and_normalizes_utc_timestamp(self) -> None:
        calls: list[dict[str, list[str]]] = []

        def requester(url: str, headers: dict[str, str], timeout: float):
            del headers, timeout
            parameters = parse_qs(urlparse(url).query)
            calls.append(parameters)
            token = parameters.get("paginationToken", [None])[0]
            if token is None:
                return wbgt_payload("2025-03-01T23:45:00+08:00", "27.5", "next")
            return wbgt_payload("2025-03-01T23:30:00+08:00", "27.4", None)

        client = HistoricalWeatherClient(
            requester=requester,
            minimum_request_interval_seconds=0,
        )

        pages = list(client.iter_day(WeatherMetric.WBGT, date(2025, 3, 1)))

        self.assertEqual(2, len(pages))
        self.assertEqual("2025-03-01T15:45:00+00:00", pages[0].readings[0].observed_at.isoformat())
        self.assertEqual("27.5", str(pages[0].readings[0].value))
        self.assertEqual("next", calls[1]["paginationToken"][0])

    def test_normalizes_standard_weather_and_station_metadata(self) -> None:
        client = HistoricalWeatherClient(
            requester=lambda *_: standard_payload(),
            minimum_request_interval_seconds=0,
        )

        page = next(client.iter_day(WeatherMetric.AIR_TEMPERATURE, date(2025, 3, 1)))

        reading = page.readings[0]
        self.assertEqual("air_temperature", reading.metric)
        self.assertEqual("S109", reading.station_id)
        self.assertEqual("28.8", str(reading.value))
        self.assertEqual("2025-03-01T00:29:00+00:00", reading.observed_at.isoformat())

    def test_reuses_station_metadata_when_a_later_page_omits_it(self) -> None:
        def requester(url: str, *_):
            token = parse_qs(urlparse(url).query).get("paginationToken", [None])[0]
            if token is None:
                return standard_payload(token="next")
            return standard_payload(
                value=29.0,
                timestamp="2025-03-01T08:30:00+08:00",
                include_stations=False,
            )

        client = HistoricalWeatherClient(
            requester=requester,
            minimum_request_interval_seconds=0,
        )

        pages = list(
            client.iter_day(WeatherMetric.AIR_TEMPERATURE, date(2025, 3, 1))
        )

        self.assertEqual(2, len(pages))
        self.assertEqual(1, pages[1].reused_station_metadata_reading_count)
        self.assertEqual("S109", pages[1].readings[0].station_id)

    def test_accepts_and_reports_an_official_station_name_correction(self) -> None:
        def requester(url: str, *_):
            token = parse_qs(urlparse(url).query).get("paginationToken", [None])[0]
            if token is None:
                return standard_payload(token="next")
            return standard_payload(station_name="Tuas Terminal Gateway")

        client = HistoricalWeatherClient(
            requester=requester,
            minimum_request_interval_seconds=0,
        )

        pages = list(
            client.iter_day(WeatherMetric.AIR_TEMPERATURE, date(2025, 3, 1))
        )

        correction = pages[1].station_metadata_corrections[0]
        self.assertEqual("Ang Mo Kio Avenue 5", correction.previous_station_name)
        self.assertEqual("Tuas Terminal Gateway", correction.corrected_station_name)
        self.assertEqual(0, correction.distance_metres)

    def test_rejects_a_station_device_identity_change(self) -> None:
        def requester(url: str, *_):
            token = parse_qs(urlparse(url).query).get("paginationToken", [None])[0]
            if token is None:
                return standard_payload(token="next")
            return standard_payload(device_id="different-device")

        client = HistoricalWeatherClient(
            requester=requester,
            minimum_request_interval_seconds=0,
        )
        pages = client.iter_day(WeatherMetric.AIR_TEMPERATURE, date(2025, 3, 1))

        with self.assertRaisesRegex(UpstreamPayloadError, "conflicting.*metadata"):
            list(pages)

    def test_accepts_and_reports_an_official_location_correction_within_limit(
        self,
    ) -> None:
        def requester(url: str, *_):
            token = parse_qs(urlparse(url).query).get("paginationToken", [None])[0]
            if token is None:
                return standard_payload(token="next")
            return standard_payload(
                timestamp="2025-03-01T08:30:00+08:00",
                latitude=1.3685,
                longitude=103.8425,
            )

        client = HistoricalWeatherClient(
            requester=requester,
            minimum_request_interval_seconds=0,
        )

        pages = list(
            client.iter_day(WeatherMetric.AIR_TEMPERATURE, date(2025, 3, 1))
        )

        self.assertEqual(1, len(pages[1].station_metadata_corrections))
        correction = pages[1].station_metadata_corrections[0]
        self.assertEqual("S109", correction.station_id)
        self.assertGreater(correction.distance_metres, 1_000)
        self.assertLess(correction.distance_metres, 2_000)

    def test_rejects_a_large_station_location_change(self) -> None:
        def requester(url: str, *_):
            token = parse_qs(urlparse(url).query).get("paginationToken", [None])[0]
            if token is None:
                return standard_payload(token="next")
            return standard_payload(latitude=1.40, longitude=103.90)

        client = HistoricalWeatherClient(
            requester=requester,
            minimum_request_interval_seconds=0,
        )
        pages = client.iter_day(WeatherMetric.AIR_TEMPERATURE, date(2025, 3, 1))

        with self.assertRaisesRegex(UpstreamPayloadError, "conflicting.*metadata"):
            list(pages)

    def test_skips_official_missing_markers_but_keeps_a_count(self) -> None:
        client = HistoricalWeatherClient(
            requester=lambda *_: wbgt_payload(
                "2025-03-01T23:45:00+08:00",
                "27.5",
                None,
                include_missing=True,
            ),
            minimum_request_interval_seconds=0,
        )

        page = next(client.iter_day(WeatherMetric.WBGT, date(2025, 3, 1)))

        self.assertEqual(1, len(page.readings))
        self.assertEqual(1, page.skipped_missing_reading_count)

    def test_rejects_unknown_non_numeric_weather_text(self) -> None:
        client = HistoricalWeatherClient(
            requester=lambda *_: wbgt_payload(
                "2025-03-01T23:45:00+08:00", "offline", None
            ),
            minimum_request_interval_seconds=0,
        )
        pages = client.iter_day(WeatherMetric.WBGT, date(2025, 3, 1))

        with self.assertRaisesRegex(UpstreamPayloadError, "not numeric"):
            list(pages)

    def test_retries_temporary_failure_without_logging_response_body(self) -> None:
        attempts = 0
        sleeps: list[float] = []

        def requester(*_):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise UpstreamRequestError("data.gov.sg returned HTTP 500", retryable=True)
            return standard_payload()

        client = HistoricalWeatherClient(
            requester=requester,
            minimum_request_interval_seconds=0,
            initial_backoff_seconds=0.25,
            sleeper=sleeps.append,
        )

        pages = list(client.iter_day(WeatherMetric.AIR_TEMPERATURE, date(2025, 3, 1)))

        self.assertEqual(1, len(pages))
        self.assertEqual(2, attempts)
        self.assertEqual([0.25], sleeps)

    def test_rejects_unknown_station_reference(self) -> None:
        payload = standard_payload()
        payload["data"]["readings"][0]["data"][0]["stationId"] = "UNKNOWN"
        client = HistoricalWeatherClient(
            requester=lambda *_: payload,
            minimum_request_interval_seconds=0,
        )
        pages = client.iter_day(WeatherMetric.AIR_TEMPERATURE, date(2025, 3, 1))

        with self.assertRaisesRegex(UpstreamPayloadError, "unknown station"):
            list(pages)

    def test_rejects_out_of_range_humidity(self) -> None:
        payload = standard_payload(value=101)
        client = HistoricalWeatherClient(
            requester=lambda *_: payload,
            minimum_request_interval_seconds=0,
        )
        pages = client.iter_day(WeatherMetric.RELATIVE_HUMIDITY, date(2025, 3, 1))

        with self.assertRaisesRegex(UpstreamPayloadError, "outside the accepted range"):
            list(pages)

    def test_rejects_repeated_pagination_token(self) -> None:
        client = HistoricalWeatherClient(
            requester=lambda *_: wbgt_payload(
                "2025-03-01T23:45:00+08:00", "27.5", "repeat"
            ),
            minimum_request_interval_seconds=0,
        )
        pages = client.iter_day(WeatherMetric.WBGT, date(2025, 3, 1))

        with self.assertRaisesRegex(UpstreamPayloadError, "repeated pagination token"):
            list(pages)

    def test_stops_when_upstream_exceeds_the_configured_page_limit(self) -> None:
        page_number = 0

        def requester(*_):
            nonlocal page_number
            page_number += 1
            return wbgt_payload(
                "2025-03-01T23:45:00+08:00",
                "27.5",
                f"next-{page_number}",
            )

        client = HistoricalWeatherClient(
            requester=requester,
            minimum_request_interval_seconds=0,
            max_pages_per_day=3,
        )
        pages = client.iter_day(WeatherMetric.WBGT, date(2025, 3, 1))

        with self.assertRaisesRegex(UpstreamPayloadError, "exceeded 3 pages"):
            list(pages)

        self.assertEqual(3, page_number)


class DatasetIoTest(unittest.TestCase):
    def test_writes_raw_pages_normalized_csv_and_checksum_manifest(self) -> None:
        client = HistoricalWeatherClient(
            requester=lambda *_: wbgt_payload(
                "2025-03-01T23:45:00+08:00",
                "27.5",
                None,
                include_missing=True,
            ),
            minimum_request_interval_seconds=0,
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            result = build_historical_dataset(
                client,
                start_date=date(2025, 3, 1),
                end_date=date(2025, 3, 1),
                output_directory=Path(temporary_directory),
                metrics=(WeatherMetric.WBGT,),
            )

            manifest = json.loads(result.manifest_json.read_text(encoding="utf-8"))
            csv_text = result.normalized_csv.read_text(encoding="utf-8")
            raw_page = result.output_directory / "raw/2025-03-01/wbgt-page-001.json"

            self.assertEqual(1, result.row_count)
            self.assertEqual(1, result.skipped_missing_reading_count)
            self.assertEqual(result.sha256, manifest["normalized_sha256"])
            self.assertEqual(4, manifest["schema_version"])
            self.assertEqual(
                "Singapore Open Data Licence",
                manifest["source_details"]["licence"]["name"],
            )
            self.assertEqual(
                1,
                manifest["data_quality"]["skipped_missing_reading_count"],
            )
            self.assertEqual(
                {"wbgt": 1},
                manifest["data_quality"]["skipped_missing_reading_count_by_metric"],
            )
            self.assertIn("S124", csv_text)
            self.assertNotIn(",NA,", csv_text)
            self.assertIn('"wbgt": "NA"', raw_page.read_text(encoding="utf-8"))
            self.assertTrue(raw_page.is_file())
            self.assertTrue(result.prepared_15_minute_csv.is_file())
            self.assertTrue(result.station_inventory_csv.is_file())
            self.assertTrue(result.station_metadata_corrections_csv.is_file())
            self.assertTrue(result.missing_periods_csv.is_file())
            self.assertEqual(1, result.downloaded_raw_page_count)
            self.assertEqual(0, result.reused_raw_page_count)

    def test_resumes_after_an_interrupted_page_download(self) -> None:
        first_run_calls: list[str | None] = []

        def interrupted_requester(url: str, *_):
            token = parse_qs(urlparse(url).query).get("paginationToken", [None])[0]
            first_run_calls.append(token)
            if token is None:
                return wbgt_payload("2025-03-01T23:30:00+08:00", "27.4", "next")
            raise UpstreamRequestError("temporary test interruption", retryable=False)

        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            interrupted_client = HistoricalWeatherClient(
                requester=interrupted_requester,
                minimum_request_interval_seconds=0,
                max_attempts=1,
            )
            report_date = date(2025, 3, 1)
            with self.assertRaises(UpstreamRequestError):
                build_historical_dataset(
                    interrupted_client,
                    start_date=report_date,
                    end_date=report_date,
                    output_directory=output_directory,
                    metrics=(WeatherMetric.WBGT,),
                )

            checkpoint = output_directory / "raw/2025-03-01/wbgt-page-001.json"
            self.assertTrue(checkpoint.is_file())
            self.assertEqual([None, "next"], first_run_calls)

            resumed_calls: list[str | None] = []

            def resumed_requester(url: str, *_):
                token = parse_qs(urlparse(url).query).get("paginationToken", [None])[0]
                resumed_calls.append(token)
                return wbgt_payload("2025-03-01T23:45:00+08:00", "27.5", None)

            resumed_client = HistoricalWeatherClient(
                requester=resumed_requester,
                minimum_request_interval_seconds=0,
            )
            result = build_historical_dataset(
                resumed_client,
                start_date=date(2025, 3, 1),
                end_date=date(2025, 3, 1),
                output_directory=output_directory,
                metrics=(WeatherMetric.WBGT,),
            )

            self.assertEqual(["next"], resumed_calls)
            self.assertEqual(1, result.reused_raw_page_count)
            self.assertEqual(1, result.downloaded_raw_page_count)
            self.assertEqual(2, result.row_count)

    def test_reuses_a_completed_download_without_network_calls(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            first_client = HistoricalWeatherClient(
                requester=lambda *_: wbgt_payload(
                    "2025-03-01T23:45:00+08:00", "27.5", None
                ),
                minimum_request_interval_seconds=0,
            )
            build_historical_dataset(
                first_client,
                start_date=date(2025, 3, 1),
                end_date=date(2025, 3, 1),
                output_directory=output_directory,
                metrics=(WeatherMetric.WBGT,),
            )

            def unexpected_request(*_):
                raise AssertionError("completed download should not call the network")

            second_client = HistoricalWeatherClient(
                requester=unexpected_request,
                minimum_request_interval_seconds=0,
            )
            result = build_historical_dataset(
                second_client,
                start_date=date(2025, 3, 1),
                end_date=date(2025, 3, 1),
                output_directory=output_directory,
                metrics=(WeatherMetric.WBGT,),
            )

            self.assertEqual(1, result.reused_raw_page_count)
            self.assertEqual(0, result.downloaded_raw_page_count)

    def test_rejects_resuming_with_different_dates(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            client = HistoricalWeatherClient(
                requester=lambda *_: wbgt_payload(
                    "2025-03-01T23:45:00+08:00", "27.5", None
                ),
                minimum_request_interval_seconds=0,
            )
            build_historical_dataset(
                client,
                start_date=date(2025, 3, 1),
                end_date=date(2025, 3, 1),
                output_directory=output_directory,
                metrics=(WeatherMetric.WBGT,),
            )

            resumed_start_date = date(2025, 3, 1)
            resumed_end_date = date(2025, 3, 2)
            resumed_metrics = (WeatherMetric.WBGT,)

            with self.assertRaisesRegex(ValueError, "different dates or metrics"):
                build_historical_dataset(
                    client,
                    start_date=resumed_start_date,
                    end_date=resumed_end_date,
                    output_directory=output_directory,
                    metrics=resumed_metrics,
                )

    def test_reports_internal_missing_periods(self) -> None:
        def requester(url: str, *_):
            token = parse_qs(urlparse(url).query).get("paginationToken", [None])[0]
            if token is None:
                return wbgt_payload("2025-03-01T23:15:00+08:00", "27.3", "next")
            return wbgt_payload("2025-03-01T23:45:00+08:00", "27.5", None)

        client = HistoricalWeatherClient(
            requester=requester,
            minimum_request_interval_seconds=0,
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            result = build_historical_dataset(
                client,
                start_date=date(2025, 3, 1),
                end_date=date(2025, 3, 1),
                output_directory=Path(temporary_directory),
                metrics=(WeatherMetric.WBGT,),
            )

            manifest = json.loads(result.manifest_json.read_text(encoding="utf-8"))
            missing_periods = result.missing_periods_csv.read_text(encoding="utf-8")

            self.assertEqual(
                {"wbgt": 1},
                manifest["data_quality"]["internal_gap_count_by_metric"],
            )
            self.assertIn(",15,1,30.0", missing_periods)

    def test_manifest_counts_reused_station_metadata(self) -> None:
        def requester(url: str, *_):
            token = parse_qs(urlparse(url).query).get("paginationToken", [None])[0]
            if token is None:
                return standard_payload(token="next")
            return standard_payload(
                value=29.0,
                timestamp="2025-03-01T08:30:00+08:00",
                include_stations=False,
            )

        client = HistoricalWeatherClient(
            requester=requester,
            minimum_request_interval_seconds=0,
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            result = build_historical_dataset(
                client,
                start_date=date(2025, 3, 1),
                end_date=date(2025, 3, 1),
                output_directory=Path(temporary_directory),
                metrics=(WeatherMetric.AIR_TEMPERATURE,),
            )

            manifest = json.loads(result.manifest_json.read_text(encoding="utf-8"))

            self.assertEqual(1, result.reused_station_metadata_reading_count)
            self.assertEqual(
                {"air_temperature": 1},
                manifest["data_quality"][
                    "reused_prior_page_station_metadata_reading_count_by_metric"
                ],
            )

    def test_manifest_reports_accepted_station_location_corrections(self) -> None:
        def requester(url: str, *_):
            token = parse_qs(urlparse(url).query).get("paginationToken", [None])[0]
            if token is None:
                return standard_payload(token="next")
            return standard_payload(
                timestamp="2025-03-01T08:30:00+08:00",
                latitude=1.3764,
                longitude=103.8492,
            )

        client = HistoricalWeatherClient(
            requester=requester,
            minimum_request_interval_seconds=0,
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            result = build_historical_dataset(
                client,
                start_date=date(2025, 3, 1),
                end_date=date(2025, 3, 1),
                output_directory=Path(temporary_directory),
                metrics=(WeatherMetric.AIR_TEMPERATURE,),
            )

            manifest = json.loads(result.manifest_json.read_text(encoding="utf-8"))
            corrections = result.station_metadata_corrections_csv.read_text(
                encoding="utf-8"
            )

            self.assertEqual(
                1,
                manifest["data_quality"][
                    "accepted_station_metadata_correction_count"
                ],
            )
            self.assertIn("S109", corrections)


def wbgt_payload(
    timestamp: str,
    value: str,
    token: str | None,
    *,
    include_missing: bool = False,
) -> dict:
    readings = [
        {
            "station": {"id": "S124", "name": "Upper Changi Road North"},
            "location": {"latitude": "1.36777", "longitude": "103.982262"},
            "wbgt": value,
            "heatStress": "Low",
        }
    ]
    if include_missing:
        readings.append(
            {
                "station": {"id": "S144", "name": "Jurong West Street 42"},
                "location": {"latitude": "1.34", "longitude": "103.70"},
                "wbgt": "NA",
                "heatStress": "",
            }
        )
    data = {
        "records": [
            {
                "datetime": timestamp,
                "item": {
                    "readings": readings,
                },
            }
        ]
    }
    if token is not None:
        data["paginationToken"] = token
    return {"code": 0, "data": data, "errorMsg": ""}


def standard_payload(
    value: float = 28.8,
    *,
    timestamp: str = "2025-03-01T08:29:00+08:00",
    token: str | None = None,
    include_stations: bool = True,
    station_name: str = "Ang Mo Kio Avenue 5",
    device_id: str = "S109",
    latitude: float = 1.3793,
    longitude: float = 103.85,
) -> dict:
    stations = []
    if include_stations:
        stations.append(
            {
                "id": "S109",
                "deviceId": device_id,
                "name": station_name,
                "location": {"latitude": latitude, "longitude": longitude},
            }
        )
    data = {
        "stations": stations,
        "readings": [
            {
                "timestamp": timestamp,
                "data": [{"stationId": "S109", "value": value}],
            }
        ],
        "readingUnit": "deg C",
    }
    if token is not None:
        data["paginationToken"] = token
    return {
        "code": 0,
        "data": data,
        "errorMsg": "",
    }


if __name__ == "__main__":
    unittest.main()
