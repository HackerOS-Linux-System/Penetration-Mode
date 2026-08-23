import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { Onboarding } from "../Onboarding";

describe("Onboarding", () => {
  it("shows the first step's title on mount", () => {
    render(() => <Onboarding onFinish={vi.fn()} />);
    expect(screen.getByText("Witaj w Penetration Mode")).toBeInTheDocument();
  });

  it("calls onFinish when 'Pomiń' is clicked, without needing to step through", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    render(() => <Onboarding onFinish={onFinish} />);

    await user.click(screen.getByText("Pomiń"));

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("advances to the next step's title on 'Dalej'", async () => {
    const user = userEvent.setup();
    render(() => <Onboarding onFinish={vi.fn()} />);

    expect(screen.getByText("Witaj w Penetration Mode")).toBeInTheDocument();
    await user.click(screen.getByText("Dalej"));

    expect(screen.getByText("Terminal ma taby i drugą konsolę")).toBeInTheDocument();
    expect(screen.queryByText("Witaj w Penetration Mode")).toBeNull();
  });

  it("calls onFinish (not onClose) when reaching the last step and clicking through", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    render(() => <Onboarding onFinish={onFinish} />);

    // 5 kroków w STEPS — cztery kliknięcia "Dalej" prowadzą do ostatniego,
    // gdzie przycisk zmienia się na "Zaczynamy".
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByText(/Dalej|Zaczynamy/));
    }
    expect(screen.getByText("Zaczynamy")).toBeInTheDocument();
    await user.click(screen.getByText("Zaczynamy"));

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("closes via the X button too", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    const { container } = render(() => <Onboarding onFinish={onFinish} />);

    const closeButton = container.querySelector("button[title='Pomiń']");
    expect(closeButton).not.toBeNull();
    await user.click(closeButton!);

    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
