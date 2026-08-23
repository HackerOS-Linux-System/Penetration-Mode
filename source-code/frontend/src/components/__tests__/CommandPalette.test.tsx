import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "../CommandPalette";
import type { PaletteCommand } from "../../lib/commandPalette";

const commands: PaletteCommand[] = [
  { id: "view:workspace", label: "Idź do: Workspace", keywords: "terminal konsola" },
  { id: "view:settings", label: "Idź do: Ustawienia", keywords: "settings motyw theme" },
  { id: "action:logout", label: "Wyloguj się", keywords: "logout exit" },
];

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    render(() => <CommandPalette open={false} onClose={vi.fn()} commands={commands} onRun={vi.fn()} />);
    expect(screen.queryByPlaceholderText(/Wpisz komendę/)).toBeNull();
  });

  it("lists all commands when open with an empty query", () => {
    render(() => <CommandPalette open={true} onClose={vi.fn()} commands={commands} onRun={vi.fn()} />);
    expect(screen.getByText("Idź do: Workspace")).toBeInTheDocument();
    expect(screen.getByText("Idź do: Ustawienia")).toBeInTheDocument();
    expect(screen.getByText("Wyloguj się")).toBeInTheDocument();
  });

  it("filters commands as the operator types", async () => {
    const user = userEvent.setup();
    render(() => <CommandPalette open={true} onClose={vi.fn()} commands={commands} onRun={vi.fn()} />);

    const input = screen.getByPlaceholderText(/Wpisz komendę/);
    await user.type(input, "wyloguj");

    expect(screen.getByText("Wyloguj się")).toBeInTheDocument();
    expect(screen.queryByText("Idź do: Workspace")).toBeNull();
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    render(() => <CommandPalette open={true} onClose={vi.fn()} commands={commands} onRun={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/Wpisz komendę/), "zzzzznicniepasuje");

    expect(screen.getByText("Brak pasujących poleceń.")).toBeInTheDocument();
  });

  it("runs the clicked command and then closes", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const onClose = vi.fn();
    render(() => <CommandPalette open={true} onClose={onClose} commands={commands} onRun={onRun} />);

    await user.click(screen.getByText("Wyloguj się"));

    expect(onRun).toHaveBeenCalledWith("action:logout");
    expect(onClose).toHaveBeenCalled();
  });

  it("runs the selected command on Enter", () => {
    const onRun = vi.fn();
    const onClose = vi.fn();
    render(() => <CommandPalette open={true} onClose={onClose} commands={commands} onRun={onRun} />);

    const input = screen.getByPlaceholderText(/Wpisz komendę/);
    fireEvent.keyDown(input, { key: "Enter" });

    // Bez ruchu strzałkami zaznaczone jest pierwsze polecenie z listy.
    expect(onRun).toHaveBeenCalledWith("view:workspace");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape without running anything", () => {
    const onRun = vi.fn();
    const onClose = vi.fn();
    render(() => <CommandPalette open={true} onClose={onClose} commands={commands} onRun={onRun} />);

    fireEvent.keyDown(screen.getByPlaceholderText(/Wpisz komendę/), { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
  });
});
