import unittest
from datetime import datetime, timedelta, timezone

from routing.services.checkpoint_service import CheckpointService


class CheckpointServiceTests(unittest.TestCase):
    def setUp(self):
        self.service = CheckpointService()

        self.departure = datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc)

        # Approximately 69 miles along the equator.
        self.geometry = {"type": "LineString", "coordinates": [[0.0, 0.0], [1.0, 0.0]]}

    def generate(self, **overrides):
        arguments = {
            "geometry": self.geometry,
            "interval_miles": 25,
            "duration_seconds": 3600,
            "departure_datetime": self.departure,
        }

        arguments.update(overrides)

        return self.service.generate_checkpoints(**arguments)

    def test_generates_checkpoints_at_correct_interval(self):
        result = self.generate()

        checkpoints = result["checkpoints"]

        self.assertEqual(checkpoints[0]["distance_miles"], 0.0)

        self.assertEqual(checkpoints[1]["distance_miles"], 25.0)

        self.assertEqual(checkpoints[2]["distance_miles"], 50.0)

        # Destination must always be included.
        self.assertAlmostEqual(
            checkpoints[-1]["distance_miles"], result["total_distance_miles"], places=2
        )

    def test_includes_origin_and_destination(self):
        result = self.generate()

        checkpoints = result["checkpoints"]

        self.assertEqual(checkpoints[0]["longitude"], 0.0)

        self.assertEqual(checkpoints[0]["latitude"], 0.0)

        self.assertAlmostEqual(checkpoints[-1]["longitude"], 1.0, places=5)

        self.assertAlmostEqual(checkpoints[-1]["latitude"], 0.0, places=5)

    def test_calculates_checkpoint_eta_using_route_progress(self):
        result = self.generate()

        checkpoint = result["checkpoints"][1]

        distance = checkpoint["distance_miles"]
        total_distance = result["total_distance_miles"]

        expected_elapsed_seconds = 3600 * distance / total_distance

        expected_eta = self.departure + timedelta(seconds=expected_elapsed_seconds)

        actual_eta = datetime.fromisoformat(checkpoint["estimated_arrival"])

        self.assertAlmostEqual((actual_eta - expected_eta).total_seconds(), 0, delta=1)

    def test_destination_eta_matches_route_duration(self):
        result = self.generate()

        destination = result["checkpoints"][-1]

        actual_eta = datetime.fromisoformat(destination["estimated_arrival"])

        expected_eta = self.departure + timedelta(seconds=3600)

        self.assertEqual(actual_eta, expected_eta)

    def test_checkpoint_intervals_10_25_and_50_are_supported(self):
        for interval in [10, 25, 50]:
            result = self.generate(interval_miles=interval)

            self.assertGreaterEqual(result["checkpoint_count"], 2)

            self.assertEqual(result["checkpoints"][0]["distance_miles"], 0.0)

    def test_rejects_naive_departure_datetime(self):
        naive_datetime = datetime(2026, 1, 1, 10, 0, 0)

        with self.assertRaises(ValueError):
            self.generate(departure_datetime=naive_datetime)

    def test_rejects_zero_route_duration(self):
        with self.assertRaises(ValueError):
            self.generate(duration_seconds=0)

    def test_rejects_negative_route_duration(self):
        with self.assertRaises(ValueError):
            self.generate(duration_seconds=-100)

    def test_rejects_invalid_route_duration(self):
        with self.assertRaises(ValueError):
            self.generate(duration_seconds="invalid")

    def test_rejects_invalid_checkpoint_interval(self):
        with self.assertRaises(ValueError):
            self.generate(interval_miles=15)

    def test_rejects_missing_route_geometry(self):
        with self.assertRaises(ValueError):
            self.generate(geometry={"coordinates": []})

    def test_rejects_invalid_longitude(self):
        invalid_geometry = {"type": "LineString", "coordinates": [[200.0, 0.0], [201.0, 0.0]]}

        with self.assertRaises(ValueError):
            self.generate(geometry=invalid_geometry)

    def test_rejects_invalid_latitude(self):
        invalid_geometry = {"type": "LineString", "coordinates": [[0.0, 95.0], [1.0, 95.0]]}

        with self.assertRaises(ValueError):
            self.generate(geometry=invalid_geometry)

    def test_rejects_malformed_coordinate(self):
        invalid_geometry = {"type": "LineString", "coordinates": [[0.0, 0.0], [1.0]]}

        with self.assertRaises(ValueError):
            self.generate(geometry=invalid_geometry)

    def test_rejects_non_numeric_coordinate(self):
        invalid_geometry = {"type": "LineString", "coordinates": [[0.0, 0.0], ["invalid", 0.0]]}

        with self.assertRaises(ValueError):
            self.generate(geometry=invalid_geometry)

    def test_rejects_zero_length_route(self):
        invalid_geometry = {"type": "LineString", "coordinates": [[0.0, 0.0], [0.0, 0.0]]}

        with self.assertRaises(ValueError):
            self.generate(geometry=invalid_geometry)

    def test_returns_checkpoint_count(self):
        result = self.generate()

        self.assertEqual(result["checkpoint_count"], len(result["checkpoints"]))

    def test_checkpoint_ids_are_sequential(self):
        result = self.generate()

        checkpoint_ids = [checkpoint["checkpoint_id"] for checkpoint in result["checkpoints"]]

        self.assertEqual(checkpoint_ids, list(range(1, len(checkpoint_ids) + 1)))


if __name__ == "__main__":
    unittest.main()
