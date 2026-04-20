import { Router, type IRouter } from "express";
import multer from "multer";
import { requireApiKey } from "../../middlewares/apiKeyAuth";

const router: IRouter = Router();

// 30MB upper limit. Gemini accepts up to ~20MB inline per part comfortably;
// going slightly above gives headroom for base64 expansion in client code.
const MAX_FILE_SIZE = 30 * 1024 * 1024;

// MIME types Gemini natively understands as inlineData parts.
// Images, audio (for multimodal chat, not transcription), video, and documents.
const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
  // Documents
  "application/pdf",
  "text/plain",
  "text/html",
  "text/css",
  "text/csv",
  "text/markdown", "text/md", "text/x-markdown",
  "text/xml", "application/xml",
  "application/json",
  "application/rtf", "text/rtf",
  "text/javascript", "application/javascript", "application/x-javascript",
  "text/x-typescript", "application/x-typescript",
  "text/x-python", "application/x-python",
  // Audio (for multimodal chat input)
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg",
  "audio/webm", "audio/aac", "audio/flac", "audio/mp4", "audio/x-m4a",
  // Video (for multimodal chat input)
  "video/mp4", "video/mpeg", "video/mov", "video/quicktime",
  "video/avi", "video/x-flv", "video/mpg", "video/webm", "video/wmv", "video/3gpp",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error(
        `Unsupported file type: ${file.mimetype}. ` +
        `Allowed: images (jpeg/png/gif/webp/heic), documents (pdf/text/markdown/csv/json/xml/rtf/code), audio, and video.`,
      ));
    }
  },
});

router.post(
  "/v1/files",
  requireApiKey,
  upload.single("file"),
  (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded. Send a multipart/form-data request with field 'file'." });
      return;
    }

    const base64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;

    res.json({
      object: "file",
      mimeType,
      base64,
      sizeBytes: req.file.size,
      usage: "Pass mimeType and base64 in a message content part: { type: 'image', mimeType, base64 }",
    });
  },
);

export default router;
