
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

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
      screen.getByRole("group", { name: "Weather Checkpoint Interval" })
    ).toBeInTheDocument();

    expect(screen.getByLabelText("Truck Load Weight (lbs)")).toHaveValue(25000);

    expect(screen.getByRole("radio", { name: "25 mi" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "10 mi" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "50 mi" })).not.toBeChecked();

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

    fireEvent.click(screen.getByRole("radio", { name: "10 mi" }));

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

    fireEvent.click(screen.getByRole("radio", { name: "50 mi" }));

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

  it("locks every field while loading", () => {
    render(
      <TripForm onSubmit={vi.fn()} loading={true} />
    );

    [
      "Origin",
      "Destination",
      "Departure Date and Time",
      "Truck Load Weight (lbs)",
    ].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeDisabled();
    });

    expect(screen.getByRole("radio", { name: "25 mi" })).toBeDisabled();
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

describe("location autocomplete", () => {
  const fetchMock = vi.fn();

  const suggestions = {
    features: [
      { id: "1", place_name: "Chicago, Illinois", center: [-87.6, 41.8] },
      { id: "2", place_name: "Chicago Heights, Illinois", center: [-87.6, 41.5] },
    ],
  };

  beforeEach(() => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "test-token");
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => suggestions,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function typeOrigin(value: string) {
    const input = screen.getByLabelText("Origin");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });

    return input;
  }

  it("asks for more characters until there are three", () => {
    render(<TripForm onSubmit={vi.fn()} loading={false} />);

    expect(screen.queryByText(/at least 3 characters/)).not.toBeInTheDocument();

    typeOrigin("Ch");

    expect(screen.getByText(/at least 3 characters/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    typeOrigin("Chi");

    expect(screen.queryByText(/at least 3 characters/)).not.toBeInTheDocument();
  });

  it("searches once after typing pauses and shows the results", async () => {
    render(<TripForm onSubmit={vi.fn()} loading={false} />);

    typeOrigin("Chi");
    typeOrigin("Chic");

    expect(
      await screen.findByRole("button", { name: "Chicago, Illinois" })
    ).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain("Chic.json");
  });

  it("fills the field when a suggestion is clicked", async () => {
    render(<TripForm onSubmit={vi.fn()} loading={false} />);

    const input = typeOrigin("Chic");

    fireEvent.click(
      await screen.findByRole("button", { name: "Chicago, Illinois" })
    );

    expect(input).toHaveValue("Chicago, Illinois");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports choosing a suggestion with the keyboard", async () => {
    render(<TripForm onSubmit={vi.fn()} loading={false} />);

    const input = typeOrigin("Chic");

    await screen.findByRole("listbox");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input).toHaveValue("Chicago, Illinois");
  });

  it("closes the suggestions with Escape", async () => {
    render(<TripForm onSubmit={vi.fn()} loading={false} />);

    const input = typeOrigin("Chic");

    await screen.findByRole("listbox");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not reopen the suggestions after leaving the field", async () => {
    render(<TripForm onSubmit={vi.fn()} loading={false} />);

    const input = typeOrigin("Chic");

    fireEvent.blur(input);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps the form usable when the search fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    fetchMock.mockResolvedValue({ ok: false });

    render(<TripForm onSubmit={vi.fn()} loading={false} />);

    const input = typeOrigin("Chic");

    await waitFor(() => expect(consoleError).toHaveBeenCalled());

    expect(input).toHaveValue("Chic");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    consoleError.mockRestore();
  });
});
