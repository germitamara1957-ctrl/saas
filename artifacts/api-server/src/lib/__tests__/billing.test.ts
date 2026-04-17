import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB module so billing.ts can be imported without a real DB connection
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue([]),
    }),
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

// Import after mocking
const { calculateChatCost, calculateImageCost, calculateVideoCost, MODEL_COSTS } = await import("../billing");

const MARKUP = 1.1;

describe("calculateChatCost", () => {
  it("returns 0 for unknown model with 0 tokens", () => {
    const cost = calculateChatCost("unknown-model-xyz", 0, 0);
    expect(cost).toBe(0);
  });

  it("calculates gemini-2.5-flash correctly", () => {
    const inputTokens = 1_000_000;
    const outputTokens = 1_000_000;
    const base = MODEL_COSTS["gemini-2.5-flash"]!;
    const expected = (base.inputPer1M * 1 + base.outputPer1M * 1) * MARKUP;
    const actual = calculateChatCost("gemini-2.5-flash", inputTokens, outputTokens);
    expect(actual).toBeCloseTo(expected, 6);
  });

  it("applies 1.1x markup over base cost", () => {
    const model = "gemini-2.5-pro";
    const base = MODEL_COSTS[model]!;
    const inputTokens = 500_000;
    const outputTokens = 200_000;
    const baseInputCost = (base.inputPer1M * inputTokens) / 1_000_000;
    const baseOutputCost = (base.outputPer1M * outputTokens) / 1_000_000;
    const expected = (baseInputCost + baseOutputCost) * MARKUP;
    expect(calculateChatCost(model, inputTokens, outputTokens)).toBeCloseTo(expected, 8);
  });

  it("scales linearly with token count", () => {
    const cost1 = calculateChatCost("gemini-2.5-flash", 100_000, 50_000);
    const cost2 = calculateChatCost("gemini-2.5-flash", 200_000, 100_000);
    expect(cost2).toBeCloseTo(cost1 * 2, 6);
  });

  it("handles grok model pricing", () => {
    const base = MODEL_COSTS["grok-4.20"]!;
    const cost = calculateChatCost("grok-4.20", 1_000_000, 1_000_000);
    const expected = (base.inputPer1M + base.outputPer1M) * MARKUP;
    expect(cost).toBeCloseTo(expected, 6);
  });
});

describe("calculateImageCost", () => {
  it("calculates imagen cost per image with markup", () => {
    const base = MODEL_COSTS["imagen-3.0-generate-002"]!;
    const count = 3;
    const expected = (base.perImage ?? 0.04) * count * MARKUP;
    const actual = calculateImageCost("imagen-3.0-generate-002", count);
    expect(actual).toBeCloseTo(expected, 6);
  });

  it("uses default perImage price for unknown image model", () => {
    const count = 2;
    const expected = 0.04 * count * MARKUP;
    const actual = calculateImageCost("unknown-image-model", count);
    expect(actual).toBeCloseTo(expected, 6);
  });

  it("returns 0 for 0 images", () => {
    expect(calculateImageCost("imagen-3.0-generate-002", 0)).toBe(0);
  });

  it("scales linearly with image count", () => {
    const cost1 = calculateImageCost("imagen-3.0-generate-002", 1);
    const cost5 = calculateImageCost("imagen-3.0-generate-002", 5);
    expect(cost5).toBeCloseTo(cost1 * 5, 6);
  });
});

describe("calculateVideoCost", () => {
  it("calculates veo cost per second with markup", () => {
    const base = MODEL_COSTS["veo-2.0-generate-001"]!;
    const seconds = 10;
    const expected = (base.perSecond ?? 0.30) * seconds * MARKUP;
    const actual = calculateVideoCost("veo-2.0-generate-001", seconds);
    expect(actual).toBeCloseTo(expected, 6);
  });

  it("uses default perSecond price for unknown video model", () => {
    const seconds = 5;
    const expected = 0.50 * seconds * MARKUP;
    const actual = calculateVideoCost("unknown-video-model", seconds);
    expect(actual).toBeCloseTo(expected, 6);
  });

  it("returns 0 for 0 seconds", () => {
    expect(calculateVideoCost("veo-2.0-generate-001", 0)).toBe(0);
  });

  it("scales linearly with duration", () => {
    const cost5 = calculateVideoCost("veo-2.0-generate-001", 5);
    const cost10 = calculateVideoCost("veo-2.0-generate-001", 10);
    expect(cost10).toBeCloseTo(cost5 * 2, 6);
  });
});

describe("MODEL_COSTS coverage", () => {
  it("has at least 23 models defined", () => {
    expect(Object.keys(MODEL_COSTS).length).toBeGreaterThanOrEqual(23);
  });

  it("all chat models have non-negative per-token prices", () => {
    for (const [model, costs] of Object.entries(MODEL_COSTS)) {
      if (costs.perImage == null && costs.perSecond == null) {
        expect(costs.inputPer1M, `${model}.inputPer1M`).toBeGreaterThanOrEqual(0);
        expect(costs.outputPer1M, `${model}.outputPer1M`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("all image models have perImage defined", () => {
    const imageModels = Object.entries(MODEL_COSTS).filter(([m]) => m.includes("imagen"));
    expect(imageModels.length).toBeGreaterThan(0);
    for (const [model, costs] of imageModels) {
      expect(costs.perImage, `${model}.perImage`).toBeGreaterThan(0);
    }
  });

  it("all video models have perSecond defined", () => {
    const videoModels = Object.entries(MODEL_COSTS).filter(([m]) => m.includes("veo"));
    expect(videoModels.length).toBeGreaterThan(0);
    for (const [model, costs] of videoModels) {
      expect(costs.perSecond, `${model}.perSecond`).toBeGreaterThan(0);
    }
  });
});
