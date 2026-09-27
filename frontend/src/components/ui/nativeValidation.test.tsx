import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../language";
import { setSessionUserCache } from "../../utils/workspaces";
import UiInput from "./UiInput";
import UiSelect from "./UiSelect";
import UiTextarea from "./UiTextarea";

function renderControls(language: "en" | "fr" | "de" | "zh") {
  setSessionUserCache({ ui_language: language });
  return render(
    <LanguageProvider>
      <UiInput label="Email" type="email" required defaultValue="invalid" />
      <UiSelect label="Region" required defaultValue="">
        <option value="">Choose</option>
        <option value="eu">Europe</option>
      </UiSelect>
      <UiTextarea label="Description" required />
    </LanguageProvider>,
  );
}

describe("localized native validation", () => {
  afterEach(() => {
    setSessionUserCache(null);
    window.localStorage.clear();
  });

  it("replaces browser-owned messages with the account language", () => {
    renderControls("en");

    const email = screen.getByLabelText("Email") as HTMLInputElement;
    const region = screen.getByLabelText("Region") as HTMLSelectElement;
    const description = screen.getByLabelText("Description") as HTMLTextAreaElement;
    fireEvent.invalid(email);
    fireEvent.invalid(region);
    fireEvent.invalid(description);

    expect(email.validationMessage).toBe("Enter a valid email address.");
    expect(region.validationMessage).toBe("Complete this field.");
    expect(description.validationMessage).toBe("Complete this field.");
  });

  it("uses translated messages and clears them while the user edits", () => {
    renderControls("fr");
    const email = screen.getByLabelText("Email") as HTMLInputElement;

    fireEvent.invalid(email);
    expect(email.validationMessage).toBe("Saisissez une adresse e-mail valide.");

    fireEvent.input(email, { target: { value: "valid@example.test" } });
    expect(email.validationMessage).toBe("");
  });
});
