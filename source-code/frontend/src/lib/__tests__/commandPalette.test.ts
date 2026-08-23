import { describe, it, expect } from "vitest";
import { filterCommands, type PaletteCommand } from "../commandPalette";

const commands: PaletteCommand[] = [
  { id: "workspace", label: "Idź do: Workspace", keywords: "terminal konsola" },
  { id: "settings", label: "Idź do: Ustawienia", keywords: "settings motyw theme" },
  { id: "logout", label: "Wyloguj się", keywords: "logout exit" },
];

describe("filterCommands", () => {
  it("returns everything for an empty query", () => {
    expect(filterCommands(commands, "")).toHaveLength(3);
  });

  it("matches on label text case-insensitively", () => {
    expect(filterCommands(commands, "ustawienia")).toEqual([commands[1]]);
  });

  it("matches on keywords, not just the visible label", () => {
    expect(filterCommands(commands, "theme")).toEqual([commands[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterCommands(commands, "zzzzz")).toEqual([]);
  });

  it("trims whitespace from the query", () => {
    expect(filterCommands(commands, "  wyloguj  ")).toEqual([commands[2]]);
  });
});
