
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import TripForm from "./TripForm";

describe("TripForm component", () => {
  it("renders all trip form fields", () => {
    render(
      <TripForm onSubmit={vi.fn()} loading={false} />
    );

    expect(screen.getByLabelText("Origin")).toBeInTheDocument();
    expect(screen.getByLabelText("Destination")).toBeInTheDocument();

    expect(
      screen.getByLabelText("Departure Date and Time")
    ).toBeInTheDocument();

    expect(
      screen.getByLabelText("Truck Load Weight (lbs)")
    ).toBeInTheDocument();

    expect(
      screen.getByLabelText("Weather Checkpoint Interval")
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", {
        name: "Find Safest Routes",
      })
    ).toBeInTheDocument();
  });

  it("marks required fields as required", () => {
    render(
      <TripForm onSubmit={vi.fn()} loading={false} />
    );

    expect(screen.getByLabelText("Origin")).toBeRequired();
    expect(screen.getByLabelText("Destination")).toBeRequired();

    expect(
      screen.getByLabelText("Departure Date and Time")
    ).toBeRequired();

    expect(
      screen.getByLabelText("Truck Load Weight (lbs)")
    ).toBeRequired();
  });

  it("does not submit when required values are empty", () => {
    const onSubmit = vi.fn();

    render(
      <TripForm onSubmit={onSubmit} loading={false} />
    );

    fireEvent.submit(
      screen.getByRole("button", {
        name: "Find Safest Routes",
      }).closest("form")!
    );

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits valid trip information", () => {
    const onSubmit = vi.fn();

    render(
      <TripForm onSubmit={onSubmit} loading={false} />
    );

    fireEvent.change(screen.getByLabelText("Origin"), {
      target: { value: "New York, NY" },
    });

    fireEvent.change(screen.getByLabelText("Destination"), {
      target: { value: "Boston, MA" },
    });

    fireEvent.change(
      screen.getByLabelText("Departure Date and Time"),
      {
        target: { value: "2026-01-01T10:00" },
      }
    );

    fireEvent.change(
      screen.getByLabelText("Truck Load Weight (lbs)"),
      {
        target: { value: "25000" },
      }
    );

    fireEvent.submit(
      screen.getByRole("button", {
        name: "Find Safest Routes",
      }).closest("form")!
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);

    const submittedData = onSubmit.mock.calls[0][0];

    expect(submittedData).toEqual({
      origin: "New York, NY",
      destination: "Boston, MA",
      departure_datetime: new Date(
        "2026-01-01T10:00"
      ).toISOString(),
      load_weight: 25000,
      checkpoint_interval: 25,
    });
  });

  it("trims whitespace from locations", () => {
    const onSubmit = vi.fn();

    render(
      <TripForm onSubmit={onSubmit} loading={false} />
    );

    fireEvent.change(screen.getByLabelText("Origin"), {
      target: { value: "  New York, NY  " },
    });

    fireEvent.change(screen.getByLabelText("Destination"), {
      target: { value: "  Boston, MA  " },
    });

    fireEvent.change(
      screen.getByLabelText("Departure Date and Time"),
      {
        target: { value: "2026-01-01T10:00" },
      }
    );

    fireEvent.change(
      screen.getByLabelText("Truck Load Weight (lbs)"),
      {
        target: { value: "30000" },
      }
    );

    fireEvent.submit(
      screen.getByRole("button", {
        name: "Find Safest Routes",
      }).closest("form")!
    );

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "New York, NY",
        destination: "Boston, MA",
        load_weight: 30000,
      })
    );
  });

  it("supports a 10-mile checkpoint interval", () => {
    const onSubmit = vi.fn();

    render(
      <TripForm onSubmit={onSubmit} loading={false} />
    );

    fireEvent.change(screen.getByLabelText("Origin"), {
      target: { value: "New York, NY" },
    });

    fireEvent.change(screen.getByLabelText("Destination"), {
      target: { value: "Boston, MA" },
    });

    fireEvent.change(
      screen.getByLabelText("Departure Date and Time"),
      {
        target: { value: "2026-01-01T10:00" },
      }
    );

    fireEvent.change(
      screen.getByLabelText("Truck Load Weight (lbs)"),
      {
        target: { value: "25000" },
      }
    );

    fireEvent.change(
      screen.getByLabelText("Weather Checkpoint Interval"),
      {
        target: { value: "10" },
      }
    );

    fireEvent.submit(
      screen.getByRole("button", {
        name: "Find Safest Routes",
      }).closest("form")!
    );

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint_interval: 10,
      })
    );
  });

  it("supports a 50-mile checkpoint interval", () => {
    const onSubmit = vi.fn();

    render(
      <TripForm onSubmit={onSubmit} loading={false} />
    );

    fireEvent.change(screen.getByLabelText("Origin"), {
      target: { value: "New York, NY" },
    });

    fireEvent.change(screen.getByLabelText("Destination"), {
      target: { value: "Boston, MA" },
    });

    fireEvent.change(
      screen.getByLabelText("Departure Date and Time"),
      {
        target: { value: "2026-01-01T10:00" },
      }
    );

    fireEvent.change(
      screen.getByLabelText("Truck Load Weight (lbs)"),
      {
        target: { value: "25000" },
      }
    );

    fireEvent.change(
      screen.getByLabelText("Weather Checkpoint Interval"),
      {
        target: { value: "50" },
      }
    );

    fireEvent.submit(
      screen.getByRole("button", {
        name: "Find Safest Routes",
      }).closest("form")!
    );

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint_interval: 50,
      })
    );
  });

  it("disables the submit button while loading", () => {
    render(
      <TripForm onSubmit={vi.fn()} loading={true} />
    );

    const button = screen.getByRole("button", {
      name: "Analyzing Routes...",
    });

    expect(button).toBeDisabled();
  });

  it("shows the normal button text when not loading", () => {
    render(
      <TripForm onSubmit={vi.fn()} loading={false} />
    );

    expect(
      screen.getByRole("button", {
        name: "Find Safest Routes",
      })
    ).toBeEnabled();
  });
});
