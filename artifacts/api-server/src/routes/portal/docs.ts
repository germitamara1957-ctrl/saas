import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, systemSettingsTable } from "@workspace/db";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

interface DocsVideo {
  title: string;
  url: string;
}

/**
 * Defense-in-depth: even though admin write validation enforces http(s) URLs,
 * legacy rows or out-of-band DB edits could contain unsafe schemes
 * (e.g. `javascript:`, `data:`) which would render as clickable links on the
 * public docs page. Re-validate at read time so we never hand the client a URL
 * we wouldn't accept on write.
 */
function isSafeHttpUrl(s: string): boolean {
  try {
    const proto = new URL(s).protocol;
    return proto === "http:" || proto === "https:";
  } catch {
    return false;
  }
}

router.get("/portal/docs/videos", async (_req, res): Promise<void> => {
  try {
    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "docs_videos"))
      .limit(1);

    if (!row?.value) {
      res.json({ videos: [] });
      return;
    }

    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) {
      res.json({ videos: [] });
      return;
    }

    const videos: DocsVideo[] = parsed
      .filter(
        (v): v is DocsVideo =>
          typeof v === "object" &&
          v !== null &&
          typeof (v as DocsVideo).title === "string" &&
          typeof (v as DocsVideo).url === "string" &&
          isSafeHttpUrl((v as DocsVideo).url),
      )
      .slice(0, 50);

    res.json({ videos });
  } catch (err) {
    logger.warn({ err }, "Failed to load docs videos");
    res.json({ videos: [] });
  }
});

export default router;
