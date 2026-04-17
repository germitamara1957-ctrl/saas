import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue([]) }),
  },
  modelCostsTable: {
    model: "model",
    inputPer1M: "input_per_1m",
    outputPer1M: "output_per_1m",
    perImage: "per_image",
    perSecond: "per_second",
    isActive: "is_active",
  },
}));

const { calculateChatCost, calculateImageCost, calculateVideoCost, MODEL_COSTS } =
  await import("../billing");

const MARKUP = 1.1;

describe("Billing precision — no double-markup", () => {
  it("applies markup exactly once to chat cost", () => {
    const model = "gemini-2.5-flash";
    const base = MODEL_COSTS[model]!;
    const inputTokens = 100_000;
    const outputTokens = 50_000;

    const rawInput = (base.inputPer1M * inputTokens) / 1_000_000;
    const rawOutput = (base.outputPer1M * outputTokens) / 1_000_000;
    const expectedOnce = (rawInput + rawOutput) * MARKUP;
    const expectedTwice = (rawInput + rawOutput) * MARKUP * MARKUP;

    const actual = calculateChatCost(model, inputTokens, outputTokens);
    expect(actual).toBeCloseTo(expectedOnce, 8);
    expect(actual).not.toBeCloseTo(expectedTwice, 5);
  });

  it("applies markup exactly once to image cost", () => {
    const model = "imagen-3.0-generate-002";
    const base = MODEL_COSTS[model]!;
    const count = 4;

    const expectedOnce = (base.perImage ?? 0.04) * count * MARKUP;
    const expectedTwice = (base.perImage ?? 0.04) * count * MARKUP * MARKUP;

    const actual = calculateImageCost(model, count);
    expect(actual).toBeCloseTo(expectedOnce, 8);
    expect(actual).not.toBeCloseTo(expectedTwice, 5);
  });

  it("applies markup exactly once to video cost", () => {
    const model = "veo-2.0-generate-001";
    const base = MODEL_COSTS[model]!;
    const seconds = 30;

    const expectedOnce = (base.perSecond ?? 0.30) * seconds * MARKUP;
    const expectedTwice = (base.perSecond ?? 0.30) * seconds * MARKUP * MARKUP;

    const actual = calculateVideoCost(model, seconds);
    expect(actual).toBeCloseTo(expectedOnce, 8);
    expect(actual).not.toBeCloseTo(expectedTwice, 5);
  });
});

describe("Billing precision — very small token counts", () => {
  it("returns a positive cost for 1 input token + 1 output token", () => {
    const model = "gemini-2.5-flash";
    const cost = calculateChatCost(model, 1, 1);
    expect(cost).toBeGreaterThan(0);
  });

  it("returns 0 cost for 0 tokens on any model", () => {
    for (const model of Object.keys(MODEL_COSTS)) {
      const c = MODEL_COSTS[model]!;
      if (c.perImage == null && c.perSecond == null) {
        expect(calculateChatCost(model, 0, 0)).toBe(0);
      }
    }
  });

  it("cost of 1 token is proportional to cost of 1M tokens", () => {
    const model = "gemini-2.5-pro";
    const costPerMillion = calculateChatCost(model, 1_000_000, 0);
    const costPerOne = calculateChatCost(model, 1, 0);
    expect(costPerOne).toBeCloseTo(costPerMillion / 1_000_000, 12);
  });
});

describe("Billing precision — unknown model fallbacks", () => {
  it("chat cost for unknown model uses default pricing (not free)", () => {
    const cost = calculateChatCost("completely-unknown-model", 1_000_000, 1_000_000);
    expect(cost).toBeGreaterThan(0);
    const expected = (1.25 + 5.0) * MARKUP;
    expect(cost).toBeCloseTo(expected, 4);
  });

  it("image cost for unknown model uses $0.04 default with markup", () => {
    const cost = calculateImageCost("imaginary-image-model-xyz", 1);
    expect(cost).toBeCloseTo(0.04 * MARKUP, 6);
  });

  it("video cost for unknown model uses $0.50 default with markup", () => {
    const cost = calculateVideoCost("imaginary-video-model-xyz", 1);
    expect(cost).toBeCloseTo(0.50 * MARKUP, 6);
  });
});

describe("Billing precision — asymmetric input/output pricing", () => {
  it("gemini-2.5-pro charges different rates for input vs output", () => {
    const model = "gemini-2.5-pro";
    const base = MODEL_COSTS[model]!;
    const tokens = 1_000_000;

    const inputOnlyCost = calculateChatCost(model, tokens, 0);
    const outputOnlyCost = calculateChatCost(model, 0, tokens);

    if (base.inputPer1M !== base.outputPer1M) {
      expect(inputOnlyCost).not.toBeCloseTo(outputOnlyCost, 4);
    } else {
      expect(inputOnlyCost).toBeCloseTo(outputOnlyCost, 4);
    }

    const expected =
      (base.inputPer1M * (tokens / 1_000_000) + base.outputPer1M * (tokens / 1_000_000)) * MARKUP;
    expect(calculateChatCost(model, tokens, tokens)).toBeCloseTo(expected, 8);
  });

  it("pure input cost + pure output cost equals combined cost", () => {
    const model = "grok-4.20";
    const inputTokens = 300_000;
    const outputTokens = 700_000;

    const combined = calculateChatCost(model, inputTokens, outputTokens);
    const inputOnly = calculateChatCost(model, inputTokens, 0);
    const outputOnly = calculateChatCost(model, 0, outputTokens);

    expect(combined).toBeCloseTo(inputOnly + outputOnly, 8);
  });
});

describe("Billing precision — large scale consistency", () => {
  it("10 images cost exactly 10x one image for imagen", () => {
    const model = "imagen-3.0-generate-002";
    const cost1 = calculateImageCost(model, 1);
    const cost10 = calculateImageCost(model, 10);
    expect(cost10).toBeCloseTo(cost1 * 10, 8);
  });

  it("60 seconds of video costs exactly 60x one second for veo", () => {
    const model = "veo-2.0-generate-001";
    const cost1 = calculateVideoCost(model, 1);
    const cost60 = calculateVideoCost(model, 60);
    expect(cost60).toBeCloseTo(cost1 * 60, 8);
  });

  it("markup is always >= 1.0x (no discounted cost)", () => {
    for (const model of Object.keys(MODEL_COSTS)) {
      const base = MODEL_COSTS[model]!;
      if (base.perImage != null) {
        const cost = calculateImageCost(model, 1);
        expect(cost).toBeGreaterThanOrEqual(base.perImage);
      } else if (base.perSecond != null) {
        const cost = calculateVideoCost(model, 1);
        expect(cost).toBeGreaterThanOrEqual(base.perSecond);
      }
    }
  });
});
