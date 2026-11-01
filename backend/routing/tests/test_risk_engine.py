from django.test import SimpleTestCase

from routing.services.risk_engine import RiskEngine


class RiskEngineTests(SimpleTestCase):
    def setUp(self):
        self.engine = RiskEngine()

    # -------------------------------------------------
    # WIND THRESHOLDS
    # -------------------------------------------------

    def test_wind_thresholds(self):
        cases = [
            (20, "Low"),
            (30, "Moderate"),
            (40, "High"),
            (50, "Severe"),
            (55, "No Travel"),
        ]

        for value, expected in cases:
            with self.subTest(wind=value):
                self.assertEqual(self.engine.get_risk_level(value, "wind"), expected)

    def test_wind_exact_boundaries(self):
        cases = [
            (25, "Moderate"),
            (35, "High"),
            (45, "Severe"),
            (55, "No Travel"),
        ]

        for value, expected in cases:
            with self.subTest(wind=value):
                self.assertEqual(self.engine.get_risk_level(value, "wind"), expected)

    # -------------------------------------------------
    # RAIN THRESHOLDS
    # -------------------------------------------------

    def test_rain_thresholds(self):
        cases = [
            (0.05, "Low"),
            (0.15, "Moderate"),
            (0.30, "High"),
            (0.75, "Severe"),
            (1.10, "No Travel"),
        ]

        for value, expected in cases:
            with self.subTest(rain=value):
                self.assertEqual(self.engine.get_risk_level(value, "rain"), expected)

    def test_rain_exact_boundaries(self):
        cases = [
            (0.10, "Moderate"),
            (0.25, "High"),
            (0.50, "High"),
            (1.00, "Severe"),
            (1.01, "No Travel"),
        ]

        for value, expected in cases:
            with self.subTest(rain=value):
                self.assertEqual(self.engine.get_risk_level(value, "rain"), expected)

    # -------------------------------------------------
    # SNOW THRESHOLDS
    # -------------------------------------------------

    def test_snow_thresholds(self):
        cases = [
            (0.2, "Low"),
            (0.7, "Moderate"),
            (1.5, "High"),
            (2.5, "Severe"),
            (3.5, "No Travel"),
        ]

        for value, expected in cases:
            with self.subTest(snow=value):
                self.assertEqual(self.engine.get_risk_level(value, "snow"), expected)

    def test_snow_exact_boundaries(self):
        cases = [
            (0.5, "Moderate"),
            (1.0, "High"),
            (2.0, "Severe"),
            (3.0, "Severe"),
            (3.01, "No Travel"),
        ]

        for value, expected in cases:
            with self.subTest(snow=value):
                self.assertEqual(self.engine.get_risk_level(value, "snow"), expected)

    # -------------------------------------------------
    # LOAD RESTRICTIONS
    # -------------------------------------------------

    def test_heavy_load_increases_risk(self):
        result = self.engine.calculate_checkpoint_risk(
            weather={"wind_mph": 40, "rain_inches_per_hour": 0.15, "snow_inches_per_hour": 0},
            load_weight=45000,
        )

        self.assertEqual(result["overall_risk"], "Severe")

    def test_wind_55_means_no_travel(self):
        result = self.engine.calculate_checkpoint_risk(
            weather={"wind_mph": 55, "rain_inches_per_hour": 0, "snow_inches_per_hour": 0},
            load_weight=10000,
        )

        self.assertEqual(result["overall_risk"], "No Travel")
        self.assertTrue(result["no_travel"])

    def test_wind_50_and_heavy_load_means_no_travel(self):
        result = self.engine.calculate_checkpoint_risk(
            weather={"wind_mph": 50, "rain_inches_per_hour": 0, "snow_inches_per_hour": 0},
            load_weight=35000,
        )

        self.assertEqual(result["overall_risk"], "No Travel")

    def test_exact_load_threshold_is_not_triggered(self):
        result = self.engine.calculate_checkpoint_risk(
            weather={"wind_mph": 40, "rain_inches_per_hour": 0, "snow_inches_per_hour": 0},
            load_weight=40000,
        )

        self.assertEqual(result["overall_risk"], "High")

    def test_load_above_30000_at_45_mph_means_no_travel(self):
        result = self.engine.calculate_checkpoint_risk(
            weather={"wind_mph": 45, "rain_inches_per_hour": 0, "snow_inches_per_hour": 0},
            load_weight=30001,
        )

        self.assertEqual(result["overall_risk"], "No Travel")

    def test_load_of_exactly_30000_does_not_trigger_rule(self):
        result = self.engine.calculate_checkpoint_risk(
            weather={"wind_mph": 45, "rain_inches_per_hour": 0, "snow_inches_per_hour": 0},
            load_weight=30000,
        )

        self.assertEqual(result["overall_risk"], "Severe")

    def test_load_of_exactly_40000_does_not_trigger_rule(self):
        result = self.engine.calculate_checkpoint_risk(
            weather={"wind_mph": 40, "rain_inches_per_hour": 0, "snow_inches_per_hour": 0},
            load_weight=40000,
        )

        self.assertEqual(result["overall_risk"], "High")

    # -------------------------------------------------
    # COMBINED WEATHER RISK
    # -------------------------------------------------

    def test_highest_weather_risk_is_selected(self):
        result = self.engine.calculate_checkpoint_risk(
            weather={"wind_mph": 20, "rain_inches_per_hour": 0.75, "snow_inches_per_hour": 1.5},
            load_weight=10000,
        )

        self.assertEqual(result["wind_risk"], "Low")
        self.assertEqual(result["rain_risk"], "Severe")
        self.assertEqual(result["snow_risk"], "High")
        self.assertEqual(result["overall_risk"], "Severe")

    def test_rain_can_trigger_no_travel(self):
        result = self.engine.calculate_checkpoint_risk(
            weather={"wind_mph": 20, "rain_inches_per_hour": 1.1, "snow_inches_per_hour": 0},
            load_weight=10000,
        )

        self.assertEqual(result["overall_risk"], "No Travel")

    def test_snow_can_trigger_no_travel(self):
        result = self.engine.calculate_checkpoint_risk(
            weather={"wind_mph": 20, "rain_inches_per_hour": 0, "snow_inches_per_hour": 3.5},
            load_weight=10000,
        )

        self.assertEqual(result["overall_risk"], "No Travel")

    def test_no_travel_flag_is_correct(self):
        result = self.engine.calculate_checkpoint_risk(
            weather={"wind_mph": 55, "rain_inches_per_hour": 0, "snow_inches_per_hour": 0},
            load_weight=10000,
        )

        self.assertTrue(result["no_travel"])

    def test_safe_weather_has_no_travel_flag_false(self):
        result = self.engine.calculate_checkpoint_risk(
            weather={"wind_mph": 10, "rain_inches_per_hour": 0, "snow_inches_per_hour": 0},
            load_weight=10000,
        )

        self.assertFalse(result["no_travel"])
        self.assertEqual(result["overall_risk"], "Low")

    # -------------------------------------------------
    # INVALID INPUTS
    # -------------------------------------------------

    def test_missing_weather_value_is_rejected(self):
        with self.assertRaises(ValueError):
            self.engine.get_risk_level(None, "wind")

    def test_negative_weather_value_is_rejected(self):
        with self.assertRaises(ValueError):
            self.engine.get_risk_level(-5, "wind")

    def test_unsupported_weather_condition_is_rejected(self):
        with self.assertRaises(ValueError):
            self.engine.get_risk_level(10, "temperature")

    def test_get_higher_risk(self):
        self.assertEqual(self.engine.get_higher_risk("High", "Severe"), "Severe")

        self.assertEqual(self.engine.get_higher_risk("No Travel", "Severe"), "No Travel")

        self.assertEqual(self.engine.get_higher_risk("Low", "Moderate"), "Moderate")
