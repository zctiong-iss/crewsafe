jest.mock("./constants", () => ({ IS_WEB: true }));

import { stripTrailingSlashes } from "@/helpers/stripTrailingSlashes";

describe("config API base URL normalization", () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl;
    jest.resetModules();
  });

  it("removes a long run of trailing slashes without changing the base URL", () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = `https://api.example.test${"/".repeat(10_000)}`;
    let apiBaseUrl = "";

    jest.isolateModules(() => {
      const { config } = require("./config") as typeof import("./config");
      apiBaseUrl = config.apiBaseUrl;
    });

    expect(apiBaseUrl).toBe("https://api.example.test");
  });

  it.each([
    ["empty input", "", ""],
    ["internal slashes", "https://api.example.test/v1//workers", "https://api.example.test/v1//workers"],
    ["one trailing slash", "https://api.example.test/", "https://api.example.test"],
    ["a long trailing slash suffix", `https://api.example.test${"/".repeat(10_000)}`, "https://api.example.test"],
  ])("strips %s without changing the rest of the URL", (_case, input, expected) => {
    expect(stripTrailingSlashes(input)).toBe(expected);
  });
});
