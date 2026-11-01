class RiskEngine:
    RISK_LEVELS = {"Low": 0, "Moderate": 1, "High": 2, "Severe": 3, "No Travel": 4}

    def get_risk_level(self, value, condition):

        if value is None:
            raise ValueError(f"Missing weather value for {condition}")

        value = float(value)

        if value < 0:
            raise ValueError(f"Invalid negative weather value for {condition}")

        # Wind thresholds: mph
        if condition == "wind":
            if value < 25:
                return "Low"

            elif value < 35:
                return "Moderate"

            elif value < 45:
                return "High"

            elif value < 55:
                return "Severe"

            else:
                return "No Travel"

        # Rain thresholds: inches per hour
        elif condition == "rain":
            if value < 0.10:
                return "Low"

            elif value < 0.25:
                return "Moderate"

            elif value <= 0.50:
                return "High"

            elif value <= 1.00:
                return "Severe"

            else:
                return "No Travel"

        # Snow thresholds: inches per hour
        elif condition == "snow":
            if value < 0.5:
                return "Low"

            elif value < 1.0:
                return "Moderate"

            elif value < 2.0:
                return "High"

            elif value <= 3.0:
                return "Severe"

            else:
                return "No Travel"

        else:
            raise ValueError(f"Unsupported weather condition: {condition}")

    def apply_load_rules(self, wind_speed, load_weight, current_risk):

        # Rule 1: Wind >= 55 mph means No Travel
        if wind_speed >= 55:
            return "No Travel"

        # Rule 2: Wind 45-54 mph + load > 30,000 lb
        if 45 <= wind_speed < 55 and load_weight > 30000:
            return "No Travel"

        # Rule 3: Wind 35-44 mph + load > 40,000 lb
        if 35 <= wind_speed < 45 and load_weight > 40000:
            return self.get_higher_risk(current_risk, "Severe")

        return current_risk

    def get_higher_risk(self, risk1, risk2):

        if self.RISK_LEVELS[risk1] >= self.RISK_LEVELS[risk2]:
            return risk1

        return risk2

    def calculate_checkpoint_risk(self, weather, load_weight):

        wind = weather["wind_mph"]

        rain = weather["rain_inches_per_hour"]

        snow = weather["snow_inches_per_hour"]

        # Calculate individual weather risks.
        wind_risk = self.get_risk_level(wind, "wind")

        rain_risk = self.get_risk_level(rain, "rain")

        snow_risk = self.get_risk_level(snow, "snow")

        # Find the highest weather risk.
        overall_risk = max(
            [wind_risk, rain_risk, snow_risk], key=lambda risk: self.RISK_LEVELS[risk]
        )

        # Apply truck load restrictions.
        final_risk = self.apply_load_rules(wind, load_weight, overall_risk)

        return {
            "wind_risk": wind_risk,
            "rain_risk": rain_risk,
            "snow_risk": snow_risk,
            "overall_risk": final_risk,
            "load_weight": load_weight,
            "no_travel": final_risk == "No Travel",
        }
