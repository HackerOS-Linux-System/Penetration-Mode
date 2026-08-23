import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { ToastStack } from "../ToastStack";
import { toasts, pushToast, dismissToast } from "../../lib/toast";

// `lib/toast.ts` jest globalnym store'em modułowym (singleton) — trzeba
// go ręcznie czyścić między testami, inaczej toast z jednego testu
// "przecieka" do następnego.
afterEach(() => {
  for (const t of toasts()) dismissToast(t.id);
});

describe("ToastStack", () => {
  it("renders nothing when there are no toasts", () => {
    render(() => <ToastStack />);
    expect(screen.queryByText(/./)).toBeNull();
  });

  it("renders a pushed toast's title and message", () => {
    pushToast("danger", "Zagrożenie wysokiego ryzyka", "CVE-2026-1234");
    render(() => <ToastStack />);
    expect(screen.getByText("Zagrożenie wysokiego ryzyka")).toBeInTheDocument();
    expect(screen.getByText("CVE-2026-1234")).toBeInTheDocument();
  });

  it("dismisses a toast when its close button is clicked", async () => {
    const user = userEvent.setup();
    pushToast("info", "Testowy toast");
    render(() => <ToastStack />);

    expect(screen.getByText("Testowy toast")).toBeInTheDocument();

    const closeButton = screen.getByText("Testowy toast").closest("div.pointer-events-auto")!.querySelector("button")!;
    await user.click(closeButton);

    expect(screen.queryByText("Testowy toast")).toBeNull();
  });

  it("renders multiple simultaneous toasts", () => {
    pushToast("success", "Zapisano ustawienia");
    pushToast("warning", "Sesja wygasa za 5 min");
    render(() => <ToastStack />);

    expect(screen.getByText("Zapisano ustawienia")).toBeInTheDocument();
    expect(screen.getByText("Sesja wygasa za 5 min")).toBeInTheDocument();
  });
});
