import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@solidjs/testing-library";

// @solidjs/testing-library (w przeciwieństwie do niektórych innych
// bindingów testing-library) NIE sprząta DOM-u automatycznie między
// testami — bez tego kolejne `render()` w tym samym pliku testowym
// nakładają się na siebie (każdy `render` dokleja się do tego samego
// `document.body`), co objawia się myloną "Found multiple elements"
// zamiast realnego błędu w komponencie.
afterEach(() => {
  cleanup();
});
