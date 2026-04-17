import { Router, type IRouter } from "express";
import multer from "multer";
import { requireApiKey } from "../../middlewares/apiKeyAuth";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "image/heic", "image/heif",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: jpeg, png, gif, webp, heic.`));
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
