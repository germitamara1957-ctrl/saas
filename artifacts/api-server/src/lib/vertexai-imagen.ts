import { type ImageResult } from "./vertexai-types";
import { resolveVertexModelId } from "./vertexai-types";
import { getActiveProvider, getAccessToken } from "./vertexai-provider";

/**
 * Imagen inpainting via the capability model.
 * Sends a base64 image + base64 mask + edit prompt and returns N edited images.
 *
 * Default model: imagen-3.0-capability-001 (only Imagen model that supports
 * referenceImages-based editing on Vertex AI).
 */
export async function editImageWithImagen(
  model: string,
  prompt: string,
  imageBase64: string,
  maskBase64: string,
  sampleCount = 1,
): Promise<ImageResult> {
  const provider = await getActiveProvider();
  const token = await getAccessToken(provider);

  const { projectId, location } = provider;
  // Force capability model — only one supported for inpainting on Vertex AI.
  const vertexModel = "imagen-3.0-capability-001";
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${vertexModel}:predict`;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{
        prompt,
        referenceImages: [
          {
            referenceType: "REFERENCE_TYPE_RAW",
            referenceId: 1,
            referenceImage: { bytesBase64Encoded: imageBase64 },
          },
          {
            referenceType: "REFERENCE_TYPE_MASK",
            referenceId: 2,
            referenceImage: { bytesBase64Encoded: maskBase64 },
            maskImageConfig: { maskMode: "MASK_MODE_USER_PROVIDED", dilation: 0.01 },
          },
        ],
      }],
      parameters: { sampleCount, editMode: "EDIT_MODE_INPAINT_INSERTION" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Imagen edit API error: ${response.status} ${err}`);
  }

  const data = (await response.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };

  return {
    images: (data.predictions ?? []).map((p) => ({
      base64: p.bytesBase64Encoded ?? "",
      mimeType: p.mimeType ?? "image/png",
    })),
  };
}

export async function generateImageWithImagen(
  model: string,
  prompt: string,
  sampleCount = 1,
): Promise<ImageResult> {
  const provider = await getActiveProvider();
  const token = await getAccessToken(provider);

  const { projectId, location } = provider;
  const vertexModel = resolveVertexModelId(model);
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${vertexModel}:predict`;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount } }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Imagen API error: ${response.status} ${err}`);
  }

  const data = (await response.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };

  return {
    images: (data.predictions ?? []).map((p) => ({
      base64: p.bytesBase64Encoded ?? "",
      mimeType: p.mimeType ?? "image/png",
    })),
  };
}
