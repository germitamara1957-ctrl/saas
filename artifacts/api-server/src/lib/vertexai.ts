export type {
  TextPart,
  ImagePart,
  ContentPart,
  ChatMessage,
  ChatResult,
  ImageResult,
  VideoJobResult,
  VideoJobStatus,
  ModelProvider,
} from "./vertexai-types";

export {
  GEMINI_GLOBAL_LOCATION_MODELS,
  GEMINI_ALIASES,
  OPENAI_COMPAT_IDS,
  MISTRAL_RAW_PREDICT_IDS,
  detectModelProvider,
  resolveVertexModelId,
  normalizeToPlanModelId,
} from "./vertexai-types";

export { chatWithGemini, streamChatWithGemini } from "./vertexai-gemini";
export {
  chatWithOpenAICompat,
  streamChatWithOpenAICompat,
  chatWithMistralRawPredict,
  streamChatWithMistralRawPredict,
} from "./vertexai-compat";
export { generateImageWithImagen } from "./vertexai-imagen";
export { generateVideoWithVeo, getVideoJobStatus } from "./vertexai-veo";
