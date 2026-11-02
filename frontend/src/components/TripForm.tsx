// frontend/src/components/TripForm.tsx

import {
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type { TripRequest } from "../types";

interface TripFormProps {
  onSubmit: (data: TripRequest) => void;
  loading: boolean;
}

interface MapboxFeature {
  id: string;
  place_name: string;
  center: [number, number];
}

interface MapboxResponse {
  features: MapboxFeature[];
}

interface LocationAutocompleteProps {
  label: string;
  name: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

const CHECKPOINT_INTERVALS = ["10", "25", "50"];

// A typical cargo load for a semi-truck, not its total weight (legally up to 80,000 lb).
const DEFAULT_LOAD_WEIGHT_LBS = "25000";

function getCurrentLocalDateTime(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - offset * 60 * 1000);

  return localDate.toISOString().slice(0, 16);
}

function LocationAutocomplete({
  label,
  name,
  value,
  placeholder,
  disabled,
  onChange,
}: LocationAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<MapboxFeature[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

useEffect(() => {
  const token = import.meta.env.VITE_MAPBOX_TOKEN;

  if (
    !token ||
    value.trim().length < 3 ||
    hasSelection
  ) {
    return;
  }

    const controller = new AbortController();

    const timeoutId = window.setTimeout(async () => {
      try {
        const encodedQuery = encodeURIComponent(value.trim());

        const url =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
          `${encodedQuery}.json` +
          `?access_token=${encodeURIComponent(token)}` +
          `&autocomplete=true` +
          `&limit=5` +
          `&language=en` +
          `&types=country,region,postcode,district,place,locality,neighborhood,address,poi`;

        const response = await fetch(url, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Location search failed.");
        }

        const data: MapboxResponse = await response.json();

        setSuggestions(data.features || []);
        setSelectedIndex(-1);
      } catch (error) {
        if (
          error instanceof Error &&
          error.name !== "AbortError"
        ) {
          console.error("Mapbox autocomplete error:", error);
          setSuggestions([]);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [value, hasSelection]);

  const handleInputChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    onChange(event.target.value);
    setHasSelection(false);
    setIsOpen(true);
    setSelectedIndex(-1);
  };

  const selectSuggestion = (suggestion: MapboxFeature) => {
    onChange(suggestion.place_name);
    setHasSelection(true);
    setSuggestions([]);
    setIsOpen(false);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement>
  ) => {
    if (!isOpen || suggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();

      setSelectedIndex((previous) =>
        previous < suggestions.length - 1
          ? previous + 1
          : 0
      );
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();

      setSelectedIndex((previous) =>
        previous > 0
          ? previous - 1
          : suggestions.length - 1
      );
    }

    if (event.key === "Enter" && selectedIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[selectedIndex]);
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  };

  const canShowSuggestions =
  Boolean(import.meta.env.VITE_MAPBOX_TOKEN) &&
  value.trim().length >= 3 &&
  !hasSelection;

  return (
    <div>
      <label htmlFor={name}>{label}</label>

      <div className="location-input">
        <input
          id={name}
          name={name}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          required
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen && suggestions.length > 0}
          aria-controls={`${name}-suggestions`}
          aria-activedescendant={
            selectedIndex >= 0
              ? `${name}-suggestion-${selectedIndex}`
              : undefined
          }
        />

        {isOpen && canShowSuggestions && suggestions.length > 0 && (
          <ul
            id={`${name}-suggestions`}
            className="location-suggestions"
            role="listbox"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.id}
                role="option"
                aria-selected={selectedIndex === index}
              >
                <button
                  id={`${name}-suggestion-${index}`}
                  type="button"
                  tabIndex={-1}
                  aria-selected={selectedIndex === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(suggestion)}
                >
                  {suggestion.place_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isOpen && value.length > 0 && value.trim().length < 3 && (
        <p className="location-hint">
          Type at least 3 characters to see location suggestions.
        </p>
      )}
    </div>
  );
}

function TripForm({ onSubmit, loading }: TripFormProps) {
  const [formData, setFormData] = useState({
    origin: "",
    destination: "",
    departure_datetime: getCurrentLocalDateTime(),
    load_weight: DEFAULT_LOAD_WEIGHT_LBS,
    checkpoint_interval: "25",
  });

  const handleChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const { name, value } = event.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !formData.origin.trim() ||
      !formData.destination.trim() ||
      !formData.departure_datetime ||
      !formData.load_weight
    ) {
      return;
    }

    const departureDate = new Date(
      formData.departure_datetime
    );

    if (Number.isNaN(departureDate.getTime())) {
      return;
    }

    const tripData: TripRequest = {
      origin: formData.origin.trim(),
      destination: formData.destination.trim(),
      departure_datetime: departureDate.toISOString(),
      load_weight: Number(formData.load_weight),
      checkpoint_interval: Number(
        formData.checkpoint_interval
      ) as 10 | 25 | 50,
    };

    onSubmit(tripData);
  };
  

  return (
    <form className="trip-form" onSubmit={handleSubmit}>
      <h2>Plan Your Journey</h2>

      <LocationAutocomplete
        label="Origin"
        name="origin"
        value={formData.origin}
        placeholder="Search starting location"
        disabled={loading}
        onChange={(value) =>
          setFormData((previous) => ({
            ...previous,
            origin: value,
          }))
        }
      />

      <LocationAutocomplete
        label="Destination"
        name="destination"
        value={formData.destination}
        placeholder="Search destination"
        disabled={loading}
        onChange={(value) =>
          setFormData((previous) => ({
            ...previous,
            destination: value,
          }))
        }
      />

      <div>
        <label htmlFor="departure_datetime">
          Departure Date and Time
        </label>

        <input
          id="departure_datetime"
          type="datetime-local"
          name="departure_datetime"
          value={formData.departure_datetime}
          onChange={handleChange}
          disabled={loading}
          required
        />
      </div>

      <div>
        <label htmlFor="load_weight">
          Truck Load Weight (lbs)
        </label>

        <input
          id="load_weight"
          type="number"
          name="load_weight"
          min="1"
          step="any"
          value={formData.load_weight}
          onChange={handleChange}
          disabled={loading}
          required
        />
      </div>

      <div>
        <fieldset className="interval-selector" disabled={loading}>
          <legend>Weather Checkpoint Interval</legend>

          <div className="interval-options">
            {CHECKPOINT_INTERVALS.map((interval) => (
              <label className="interval-option" key={interval}>
                <input
                  type="radio"
                  name="checkpoint_interval"
                  value={interval}
                  checked={formData.checkpoint_interval === interval}
                  onChange={handleChange}
                />
                <span>{interval} mi</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <button type="submit" disabled={loading} aria-busy={loading}>
        {loading && <span className="spinner" aria-hidden="true" />}
        {loading ? "Analyzing Routes..." : "Find Safest Routes"}
      </button>
    </form>
  );
}

export default TripForm;