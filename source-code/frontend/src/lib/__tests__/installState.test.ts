import { describe, it, expect } from "vitest";
import { installButtonLabel, isActionDisabled } from "../installState";

describe("installButtonLabel", () => {
  it("offers install when not installed and idle", () => {
    expect(installButtonLabel(false, "idle")).toBe("Zainstaluj");
  });

  it("shows progress while installing", () => {
    expect(installButtonLabel(false, "installing")).toBe("Instaluję...");
  });

  it("offers remove when installed and idle", () => {
    expect(installButtonLabel(true, "idle")).toBe("Usuń");
  });

  it("shows progress while removing", () => {
    expect(installButtonLabel(true, "removing")).toBe("Usuwam...");
  });

  it("falls back to the installed label if 'installing' is somehow set on an installed package", () => {
    // Nie powinno się zdarzyć w normalnym flow (handleInstall działa
    // tylko na niezainstalowanych), ale funkcja i tak musi zwrócić coś
    // sensownego zamiast "Instaluję..." dla już zainstalowanego pakietu.
    expect(installButtonLabel(true, "installing")).toBe("Usuń");
  });
});

describe("isActionDisabled", () => {
  it("is not disabled when idle", () => {
    expect(isActionDisabled("idle")).toBe(false);
  });

  it("is disabled while installing or removing", () => {
    expect(isActionDisabled("installing")).toBe(true);
    expect(isActionDisabled("removing")).toBe(true);
  });
});
