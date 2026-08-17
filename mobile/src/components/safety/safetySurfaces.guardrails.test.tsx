/**
 * The ADR-0017 §6 gate, run against the safety surfaces (SCRUM-TBD-43).
 *
 * ── WHY THIS FILE CONTAINS NO CONVERSION ────────────────────────────────────────────────
 * The Phase 3 plan expected `WbgtCard`, `HeatGuidance` and `LightningBanner` to be converted
 * to progressive-disclosure cards. Reading them, they must not be — and the reason is written
 * into the components themselves:
 *
 *   `LightningBanner` is the loudest thing on the screen by design, and its own header note
 *   says a banner that quietly vanished "would be read as permission by a worker who simply
 *   looked away for a minute". A collapsible stop-work warning is that failure with a control
 *   attached.
 *
 *   `WbgtCard`'s `stopWorkOverride` line is, with `features.heatGuidanceCard` off, the ONLY
 *   place the app states FR-12a in words. SCRUM-260 already removed a 45% dim from this card
 *   because a dimmed card reads as "loading" as readily as "superseded". Putting the same
 *   sentence behind an expand is a stronger version of the bug that ticket fixed.
 *
 *   `HeatGuidance` keeps its suspended notice and its actions on screen together on purpose,
 *   so a worker can see what resumes once the all-clear comes. §7.1 and FR-12a both require
 *   the suspension to be visible, not discoverable.
 *
 * SCRUM-TBD-43's own acceptance criteria said no safety-critical text may move behind a
 * disclosure. Applied honestly to these three, there is nothing left that may move. The
 * conversion is therefore declined, and what the ticket actually buys is this: proof that the
 * surfaces survive the guardrail matrix — large text, high contrast, and the three scripts
 * with the tallest line boxes — which nothing previously checked.
 */
import {
  guardrailCases,
  renderUnderGuardrails,
  expectNoClipping,
  expectPillsBordered,
  LONG_RULE_CODE,
} from "@/testing/guardrails";
import type { LightningRisk, PolicyEvaluation, SiteConditions } from "@/types/domain";

let mockTheme = jest.requireActual("@/styles/theme").buildTheme(false, 1);
let mockLanguage = "en";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => mockTheme,
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useReduceMotionPreference: () => false,
  useSystemReduceMotion: () => false,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    /* The longest Burmese stop-work strings, so the gate tests the worst case rather than the
       English one. These are the surfaces where a clipped word is a safety failure. */
    t: (key: string, vars?: Record<string, unknown>) => {
      const longest: Record<string, string> = {
        "wbgt.stopWorkOverride": "အမိုးအကာရှာပါ။ အပူဆိုင်ရာစည်းမျဉ်းများကို ခေတ္တရပ်ထားသည်။",
        "guidance.suspended": "မိုးကြိုးကြောင့် အပူအစီအစဉ်ကို ခေတ္တရပ်ဆိုင်းထားသည်",
        "lightning.stopWorkTitle": "အလုပ်ရပ်ပါ — မိုးကြိုးအန္တရာယ်ရှိသည်",
        "lightning.stopWorkBody": "ချက်ချင်း အမိုးအကာအောက်သို့ ရွှေ့ပါ။",
      };
      if (longest[key]) return longest[key];
      return vars ? `${key}:${Object.values(vars).join(",")}` : key;
    },
    i18n: { language: mockLanguage },
  }),
}));

import WbgtCard from "./WbgtCard";
import HeatGuidance from "./HeatGuidance";
import LightningBanner from "./LightningBanner";

const CONDITIONS: SiteConditions = {
  siteId: "site-1",
  wbgt: 33.4,
  temperature: 34,
  humidity: 80,
  windSpeed: 3,
  rainfall: 0,
  observedAt: "2026-08-17T04:00:00Z",
  ingestedAt: "2026-08-17T04:01:00Z",
  source: "NEA",
  qualityStatus: "STALE",
  stationId: "S123",
};

const POLICY: PolicyEvaluation = {
  policyVersion: "v2026.08.1",
  currentBand: "33_AND_ABOVE",
  forecastBand: "33_AND_ABOVE",
  mandatoryActions: [
    { code: "REST_15_MIN_HOURLY", appliesTo: [], ruleReference: LONG_RULE_CODE },
    { code: "HYDRATE_HOURLY", appliesTo: [], ruleReference: LONG_RULE_CODE },
  ],
  advisoryActions: [
    { code: "RESCHEDULE_HEAVY_WORK", appliesTo: [], ruleReference: LONG_RULE_CODE },
  ],
};

const STOP_WORK: LightningRisk = {
  siteId: "site-1",
  state: "STOP_WORK",
  nearestStrikeKm: 3,
  observedAt: "2026-08-17T04:00:00Z",
  validUntil: "2026-08-17T04:30:00Z",
};

const NOW = Date.parse("2026-08-17T04:10:00Z");

describe.each(guardrailCases())("guardrail gate — $label", ({ theme, language }) => {
  beforeEach(() => {
    mockTheme = theme;
    mockLanguage = language;
  });

  it("WbgtCard renders the FR-12a override without clipping it", async () => {
    const tree = await renderUnderGuardrails(<WbgtCard conditions={CONDITIONS} superseded />);
    expectNoClipping(tree);
    expectPillsBordered(tree);
  });

  it("WbgtCard keeps the override line ALWAYS VISIBLE, never behind a control", async () => {
    /*
     * The regression this exists to catch is a future well-meant refactor that tidies this
     * sentence behind a "Details" toggle. With the heat-guidance card off, this line is the
     * only place FR-12a is stated in words.
     */
    const tree = await renderUnderGuardrails(<WbgtCard conditions={CONDITIONS} superseded />);
    expect(tree.getByText("အမိုးအကာရှာပါ။ အပူဆိုင်ရာစည်းမျဉ်းများကို ခေတ္တရပ်ထားသည်။")).toBeTruthy();
    expect(tree.queryByLabelText("recommendations.showDetails")).toBeNull();
  });

  it("HeatGuidance renders a suspended plan without clipping", async () => {
    const tree = await renderUnderGuardrails(<HeatGuidance policy={POLICY} suspended />);
    expectNoClipping(tree);
  });

  it("HeatGuidance keeps the suspension notice AND the actions on screen together", async () => {
    // §7.1: the worker must be able to see both that the plan is suspended and what resumes.
    const tree = await renderUnderGuardrails(<HeatGuidance policy={POLICY} suspended />);
    expect(tree.getByText("မိုးကြိုးကြောင့် အပူအစီအစဉ်ကို ခေတ္တရပ်ဆိုင်းထားသည်")).toBeTruthy();
    /* The stub `t` echoes "key:defaultValue" when a defaultValue is supplied, which is how
       HeatGuidance resolves an action code. */
    expect(tree.getAllByText(/^actions\.REST_15_MIN_HOURLY/)).not.toHaveLength(0);
    expect(tree.queryByLabelText("recommendations.showDetails")).toBeNull();
  });

  it("HeatGuidance wraps a long rule reference rather than truncating it", async () => {
    // One per action, so all three are checked rather than just the first.
    const tree = await renderUnderGuardrails(<HeatGuidance policy={POLICY} suspended />);
    const references = tree.getAllByText(`guidance.rule:${LONG_RULE_CODE}`);
    expect(references).toHaveLength(3);
    for (const reference of references) {
      expect(reference.props.numberOfLines).toBeUndefined();
    }
  });

  it("LightningBanner renders a stop-work without clipping its instruction", async () => {
    const tree = await renderUnderGuardrails(
      <LightningBanner risk={STOP_WORK} locale="en" now={NOW} />,
    );
    expectNoClipping(tree);
  });

  it("LightningBanner stays an always-visible alert, never collapsible", async () => {
    // Its own header note: a banner that quietly vanished would be read as permission.
    const tree = await renderUnderGuardrails(
      <LightningBanner risk={STOP_WORK} locale="en" now={NOW} />,
    );
    expect(tree.getByText("အလုပ်ရပ်ပါ — မိုးကြိုးအန္တရာယ်ရှိသည်")).toBeTruthy();
    expect(tree.getByText("ချက်ချင်း အမိုးအကာအောက်သို့ ရွှေ့ပါ။")).toBeTruthy();
    expect(tree.queryByLabelText("recommendations.showDetails")).toBeNull();
  });
});
