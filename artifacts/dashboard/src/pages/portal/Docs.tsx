import { useGetPortalApiKeys } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Copy, CheckCircle2, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronUp,
} from "lucide-react";
import { useState, useEffect, Fragment } from "react";
import { useToast } from "@/hooks/use-toast";
import i18n from "@/i18n";

const GATEWAY_URL = window.location.origin;
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface DocsVideo {
  title: string;
  url: string;
}

/**
 * Extracts YouTube video ID from common URL formats:
 *   https://www.youtube.com/watch?v=ID
 *   https://youtu.be/ID
 *   https://www.youtube.com/embed/ID
 *   https://www.youtube.com/shorts/ID
 * Returns null for non-YouTube URLs (caller should fall back to a plain link).
 */
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(embed|shorts|v)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[2];
    }
    return null;
  } catch {
    return null;
  }
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="relative group">
      <pre className="p-4 rounded-lg bg-[#0d1117] text-[#c9d1d9] text-xs overflow-x-auto border border-border/50 leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity bg-[#21262d] hover:bg-[#30363d] text-[#8b949e]"
        onClick={copy}
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight">{children}</h2>;
}

interface ModelRow {
  id: string;
  alias?: string;
  type: "Text" | "Image" | "Video";
  pricing: string;
  description: string;
  useCases: string[];
  quality: number;
  sortPrice: number;
}

interface ModelSection {
  label: string;
  models: ModelRow[];
}

type SortMode = "default" | "quality" | "price-asc" | "price-desc";

function ModelIdCell({ id, alias }: { id: string; alias?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const copy = () => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Model ID copied", description: id });
  };

  return (
    <div className="flex items-start gap-1.5">
      <div className="min-w-0">
        <span className="font-mono text-xs">{id}</span>
        {alias && (
          <span className="ml-2 text-[10px] text-muted-foreground font-mono bg-muted px-1 py-0 rounded">
            alias: {alias}
          </span>
        )}
      </div>
      <button
        onClick={copy}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
        title="Copy model ID"
      >
        {copied
          ? <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

const MODEL_SECTIONS: ModelSection[] = [
  {
    label: "Google — Gemini 2.5",
    models: [
      {
        id: "gemini-2.5-pro",
        type: "Text",
        pricing: "$1.25 / $10.00 per 1M tokens (in/out)",
        description: "Google's most capable Gemini 2.5 model. Excels at complex reasoning, long-context documents, coding, and multimodal tasks.",
        useCases: ["Complex reasoning", "Code generation", "Long documents", "Multimodal"],
        quality: 6,
        sortPrice: 1.25,
      },
      {
        id: "gemini-2.5-flash",
        type: "Text",
        pricing: "$0.30 / $2.50 per 1M tokens (in/out)",
        description: "Fast and highly capable Gemini 2.5 model. Best balance of speed, quality, and cost for everyday production workloads.",
        useCases: ["Chat", "Summarization", "Q&A", "Translation"],
        quality: 15,
        sortPrice: 0.30,
      },
      {
        id: "gemini-2.5-flash-lite",
        type: "Text",
        pricing: "$0.10 / $0.40 per 1M tokens (in/out)",
        description: "Lightest and fastest Gemini 2.5 model. Ideal for simple, high-volume tasks where speed and cost matter most.",
        useCases: ["Classification", "Simple Q&A", "High-volume tasks"],
        quality: 17,
        sortPrice: 0.10,
      },
    ],
  },
  {
    label: "Google — Gemini 3.1",
    models: [
      {
        id: "gemini-3.1-pro-preview",
        type: "Text",
        pricing: "$2.00 / $12.00 per 1M tokens (in/out)",
        description: "Google's latest and most powerful model. State-of-the-art reasoning, vision understanding, and code generation capabilities.",
        useCases: ["Research", "Complex reasoning", "Vision", "Advanced coding"],
        quality: 1,
        sortPrice: 2.00,
      },
      {
        id: "gemini-3.1-flash-lite-preview",
        type: "Text",
        pricing: "$0.25 / $1.50 per 1M tokens (in/out)",
        description: "Ultra-fast lightweight Gemini 3.1 model. Best for real-time applications requiring Gemini 3.1 generation quality at low latency.",
        useCases: ["Real-time apps", "Chatbots", "Simple tasks"],
        quality: 11,
        sortPrice: 0.25,
      },
      {
        id: "gemini-3.1-flash-image-preview",
        type: "Text",
        pricing: "$0.50 / $3.00 per 1M tokens (in/out)",
        description: "Gemini 3.1 Flash with native image generation support. Create images and text in the same model call.",
        useCases: ["Creative content", "Image + text generation", "Visual storytelling"],
        quality: 10,
        sortPrice: 0.50,
      },
    ],
  },
  {
    label: "Google — Gemini 3",
    models: [
      {
        id: "gemini-3.0-pro-image-preview",
        type: "Text",
        pricing: "$2.00 / $12.00 per 1M tokens (in/out)",
        description: "Gemini 3 Pro with native multimodal image output. Powerful model for combining high-quality text and visual reasoning.",
        useCases: ["Visual content creation", "Multimodal reasoning", "Creative AI"],
        quality: 3,
        sortPrice: 2.00,
      },
      {
        id: "gemini-3.0-flash-preview",
        type: "Text",
        pricing: "$0.50 / $3.00 per 1M tokens (in/out)",
        description: "Fast Gemini 3 model designed for production. Offers Gemini 3 generation quality at significantly lower cost.",
        useCases: ["Production chatbots", "Real-time apps", "Batch processing"],
        quality: 13,
        sortPrice: 0.50,
      },
    ],
  },
  {
    label: "Google — Imagen",
    models: [
      {
        id: "imagen-4.0-generate-001",
        alias: "imagen-4",
        type: "Image",
        pricing: "$0.04 per image",
        description: "Imagen 4 — Google's latest photorealistic image generation model. Stunning detail, accurate text rendering, and prompt adherence.",
        useCases: ["Marketing", "Product images", "Creative content"],
        quality: 2,
        sortPrice: 0.04,
      },
      {
        id: "imagen-4.0-ultra-generate-001",
        alias: "imagen-4-ultra",
        type: "Image",
        pricing: "$0.06 per image",
        description: "Imagen 4 Ultra — highest quality image generation available. Premium tier for professional and commercial media production.",
        useCases: ["Professional media", "Premium advertising", "High-fidelity art"],
        quality: 1,
        sortPrice: 0.06,
      },
      {
        id: "imagen-3.0-generate-002",
        alias: "imagen-3",
        type: "Image",
        pricing: "$0.04 per image",
        description: "Imagen 3 — reliable high-quality image generation. Great balance of quality and cost for standard creative workflows.",
        useCases: ["Blog images", "Social media", "Product visuals"],
        quality: 3,
        sortPrice: 0.04,
      },
      {
        id: "imagen-3.0-fast-generate-001",
        alias: "imagen-3-fast",
        type: "Image",
        pricing: "$0.02 per image",
        description: "Imagen 3 Fast — quick image generation at the lowest cost. Perfect for high-volume generation and rapid prototyping.",
        useCases: ["Prototyping", "High-volume generation", "Drafts"],
        quality: 4,
        sortPrice: 0.02,
      },
    ],
  },
  {
    label: "Google — Veo",
    models: [
      {
        id: "veo-3.1-generate-001",
        alias: "veo-3.1",
        type: "Video",
        pricing: "$0.40 per second",
        description: "Veo 3.1 — Google's best-in-class video generation model with native audio. Cinematic quality short videos from text prompts.",
        useCases: ["Marketing videos", "Social media", "Product demos"],
        quality: 1,
        sortPrice: 0.40,
      },
      {
        id: "veo-3.1-fast-generate-001",
        alias: "veo-3.1-fast",
        type: "Video",
        pricing: "$0.12 per second",
        description: "Veo 3.1 Fast — faster video generation at a lower cost. Great for previews, drafts, and iterative workflows.",
        useCases: ["Video drafts", "Storyboards", "Rapid iteration"],
        quality: 3,
        sortPrice: 0.12,
      },
      {
        id: "veo-3.0-generate-001",
        alias: "veo-3",
        type: "Video",
        pricing: "$0.40 per second",
        description: "Veo 3 — high-quality video generation with excellent motion coherence and scene understanding.",
        useCases: ["Video content", "Creative storytelling", "Animation"],
        quality: 2,
        sortPrice: 0.40,
      },
      {
        id: "veo-2.0-generate-001",
        alias: "veo-2",
        type: "Video",
        pricing: "$0.50 per second",
        description: "Veo 2 — previous generation Veo model. Still capable for standard video generation tasks.",
        useCases: ["Basic video generation", "Legacy workflows"],
        quality: 4,
        sortPrice: 0.50,
      },
    ],
  },
  {
    label: "xAI — Grok",
    models: [
      {
        id: "grok-4.20",
        type: "Text",
        pricing: "$0.20 / $0.50 per 1M tokens (in/out)",
        description: "xAI's flagship model with deep reasoning, real-time knowledge, and strong performance on hard benchmarks.",
        useCases: ["Research", "Deep analysis", "Complex tasks", "Real-time data"],
        quality: 2,
        sortPrice: 0.20,
      },
      {
        id: "grok-4.1-thinking",
        type: "Text",
        pricing: "$0.20 / $0.50 per 1M tokens (in/out)",
        description: "xAI's step-by-step reasoning model. Excels at math, logic, and multi-step problem solving with transparent thinking.",
        useCases: ["Math", "Logic", "Problem solving", "Scientific reasoning"],
        quality: 4,
        sortPrice: 0.20,
      },
    ],
  },
  {
    label: "DeepSeek",
    models: [
      {
        id: "deepseek-v3.2",
        type: "Text",
        pricing: "$0.56 / $1.68 per 1M tokens (in/out)",
        description: "DeepSeek's latest model with exceptional coding and technical capabilities. One of the strongest open-weight class models available.",
        useCases: ["Code generation", "Technical analysis", "Data science"],
        quality: 8,
        sortPrice: 0.56,
      },
    ],
  },
  {
    label: "Google — Gemma MaaS",
    models: [
      {
        id: "gemma-4-26b",
        type: "Text",
        pricing: "$0.20 / $0.80 per 1M tokens (in/out)",
        description: "Google's open Gemma 4 model served via Vertex AI MaaS. Efficient and capable for general-purpose tasks.",
        useCases: ["General purpose", "Research", "Text processing"],
        quality: 14,
        sortPrice: 0.20,
      },
    ],
  },
  {
    label: "Kimi (Moonshot AI)",
    models: [
      {
        id: "kimi-k2",
        type: "Text",
        pricing: "$0.60 / $2.50 per 1M tokens (in/out)",
        description: "Moonshot AI's agentic reasoning model. Excellent for complex multi-step tasks and autonomous agent workflows.",
        useCases: ["AI agents", "Complex reasoning", "Multi-step tasks"],
        quality: 7,
        sortPrice: 0.60,
      },
    ],
  },
  {
    label: "MiniMax",
    models: [
      {
        id: "minimax-m2",
        type: "Text",
        pricing: "$0.30 / $1.20 per 1M tokens (in/out)",
        description: "MiniMax M2 — strong multilingual model with broad knowledge and creative capabilities.",
        useCases: ["Multilingual", "Creative writing", "General tasks"],
        quality: 12,
        sortPrice: 0.30,
      },
    ],
  },
  {
    label: "Zhipu AI — GLM-5",
    models: [
      {
        id: "glm-5",
        type: "Text",
        pricing: "$0.10 / $0.40 per 1M tokens (in/out)",
        description: "Zhipu AI's GLM-5 with exceptional Chinese language support and competitive multilingual performance.",
        useCases: ["Chinese language", "Multilingual", "General reasoning"],
        quality: 9,
        sortPrice: 0.10,
      },
    ],
  },
  {
    label: "Mistral AI",
    models: [
      {
        id: "mistral-small",
        type: "Text",
        pricing: "$0.20 / $0.60 per 1M tokens (in/out)",
        description: "Mistral Small 3.1 — a fast, efficient European AI model with strong instruction following and multilingual support.",
        useCases: ["Chat", "Summarization", "Code", "European data residency"],
        quality: 16,
        sortPrice: 0.20,
      },
    ],
  },
];

const ALL_MODELS: ModelRow[] = MODEL_SECTIONS.flatMap((s) => s.models);

function sortModels(models: ModelRow[], mode: SortMode): ModelRow[] {
  if (mode === "default") return models;
  return [...models].sort((a, b) => {
    if (mode === "quality") return a.quality - b.quality;
    if (mode === "price-asc") return a.sortPrice - b.sortPrice;
    if (mode === "price-desc") return b.sortPrice - a.sortPrice;
    return 0;
  });
}

function QualityStars({ quality, total }: { quality: number; total: number }) {
  const pct = Math.max(0, Math.min(1, 1 - (quality - 1) / (total - 1)));
  const filled = Math.round(pct * 5);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i <= filled ? "bg-primary" : "bg-muted"}`}
        />
      ))}
    </div>
  );
}

function ModelTableRow({ m, maxQuality, showDescription }: {
  m: ModelRow;
  maxQuality: number;
  showDescription: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr className="border-t border-border/20 hover:bg-muted/10">
        <td className="px-4 py-2.5">
          <ModelIdCell id={m.id} alias={m.alias} />
        </td>
        <td className="px-4 py-2.5">
          <Badge variant="outline" className={
            m.type === "Text"  ? "text-blue-500 border-blue-500/30 bg-blue-500/5" :
            m.type === "Image" ? "text-purple-500 border-purple-500/30 bg-purple-500/5" :
                                 "text-amber-500 border-amber-500/30 bg-amber-500/5"
          }>{m.type}</Badge>
        </td>
        <td className="px-4 py-2.5">
          <QualityStars quality={m.quality} total={maxQuality} />
        </td>
        <td className="px-4 py-2.5 text-muted-foreground text-xs">{m.pricing}</td>
        <td className="px-4 py-2.5">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title={expanded ? "Hide details" : "Show details"}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border/10 bg-muted/20">
          <td colSpan={5} className="px-4 py-3">
            <p className="text-xs text-foreground/80 mb-2">{m.description}</p>
            <div className="flex flex-wrap gap-1">
              {m.useCases.map((uc) => (
                <span
                  key={uc}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                >
                  {uc}
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function PortalDocs() {
  const { data: apiKeys } = useGetPortalApiKeys();
  const apiKey = apiKeys?.[0]?.fullKey ?? "YOUR_API_KEY";
  const base = GATEWAY_URL;
  const isAr = i18n.language === "ar";

  const [sortMode, setSortMode] = useState<SortMode>("default");

  const [videos, setVideos] = useState<DocsVideo[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/portal/docs/videos`, { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<{ videos: DocsVideo[] }>) : { videos: [] }))
      .then((data) => {
        if (!cancelled) setVideos(Array.isArray(data.videos) ? data.videos : []);
      })
      .catch(() => {
        // Non-critical: tutorials section is optional. Silently hide on error.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const maxQuality = Math.max(...ALL_MODELS.map((m) => m.quality));

  const sortedModels = sortModels(ALL_MODELS, sortMode);
  const isGrouped = sortMode === "default";

  // ── Chat ────────────────────────────────────────────────────────────────────
  const chatCurl = `curl -X POST "${base}/api/v1/chat" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-3.1-pro-preview",
    "messages": [
      {"role": "user", "content": "Hello! How are you?"}
    ],
    "temperature": 0.7,
    "maxOutputTokens": 1024
  }'`;

  const chatPython = `import requests

response = requests.post(
    "${base}/api/v1/chat",
    headers={"Authorization": "Bearer ${apiKey}"},
    json={
        "model": "gemini-3.1-pro-preview",
        "messages": [
            {"role": "user", "content": "Hello! How are you?"}
        ],
        "temperature": 0.7,
        "maxOutputTokens": 1024
    }
)

data = response.json()
print(data["content"])         # the assistant reply
print(data["inputTokens"])     # tokens used
print(data["costUsd"])         # cost charged`;

  const chatJs = `const response = await fetch("${base}/api/v1/chat", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${apiKey}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "gemini-3.1-pro-preview",
    messages: [{ role: "user", content: "Hello! How are you?" }],
    temperature: 0.7,
    maxOutputTokens: 1024
  })
});

const data = await response.json();
console.log(data.content);      // the assistant reply
console.log(data.inputTokens);  // tokens used
console.log(data.costUsd);      // cost charged`;

  const chatResponse = `{
  "id": "req_abc123",
  "model": "gemini-3.1-pro-preview",
  "content": "Hello! I'm doing well, thank you for asking.",
  "inputTokens": 10,
  "outputTokens": 12,
  "totalTokens": 22,
  "costUsd": 0.0000148
}`;

  // ── Generate (Image) ────────────────────────────────────────────────────────
  const genCurl = `curl -X POST "${base}/api/v1/generate" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "imagen-4",
    "prompt": "A sunset over the ocean, photorealistic",
    "sampleCount": 1
  }'`;

  const genPython = `import requests, base64

response = requests.post(
    "${base}/api/v1/generate",
    headers={"Authorization": "Bearer ${apiKey}"},
    json={
        "model": "imagen-4",
        "prompt": "A sunset over the ocean, photorealistic",
        "sampleCount": 1
    }
)

data = response.json()

# Display or save the first image
img_b64 = data["images"][0]["base64"]
img_bytes = base64.b64decode(img_b64)

with open("output.png", "wb") as f:
    f.write(img_bytes)

print("Cost USD:", data["costUsd"])`;

  const genJs = `const response = await fetch("${base}/api/v1/generate", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${apiKey}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "imagen-4",
    prompt: "A sunset over the ocean, photorealistic",
    sampleCount: 1
  })
});

const data = await response.json();

// Display the image in the browser
const img = document.createElement("img");
img.src = \`data:\${data.images[0].mimeType};base64,\${data.images[0].base64}\`;
document.body.appendChild(img);

console.log("Cost:", data.costUsd);`;

  const genResponse = `{
  "id": "req_xyz789",
  "model": "imagen-4",
  "images": [
    {
      "base64": "<base64-encoded PNG data>",
      "mimeType": "image/png"
    }
  ],
  "costUsd": 0.052
}`;

  // ── Video ───────────────────────────────────────────────────────────────────
  const videoCurl = `# ── Option A: Synchronous mode (recommended for n8n / Zapier / scripts) ──
# One call, waits up to 4 min. The response includes:
#   • videoUrl    — Google's signed Cloud Storage URL (expires in ~1 h)
#   • downloadUrl — A clickable .mp4 link on YOUR gateway (auth-required, never expires)
# Most users want downloadUrl — paste it into n8n's "HTTP Request → Download File" node.
curl -X POST "${base}/api/v1/video?wait=true" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "veo-3.1-fast-generate-001",
    "prompt": "A time-lapse of clouds moving over mountains",
    "durationSeconds": 8
  }'

# Example response:
# {
#   "jobId": "req_vid123",
#   "status": "completed",
#   "videoUrl":    "https://storage.googleapis.com/...",   ← signed Google URL (1 h)
#   "downloadUrl": "${base}/api/v1/video/req_vid123/download",  ← stable .mp4 link
#   "model": "veo-3.1-fast-generate-001",
#   "costUsd": 0.66
# }

# ── Option B: Async mode — start now, poll later ──
# Step 1 — Start the job (returns immediately with a jobId)
curl -X POST "${base}/api/v1/video" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "veo-3.1-fast-generate-001",
    "prompt": "A time-lapse of clouds moving over mountains",
    "durationSeconds": 8
  }'

# Step 2 — Poll status every 5–10 s until completed or failed
curl "${base}/api/v1/video/{jobId}/status" \\
  -H "Authorization: Bearer ${apiKey}"

# Step 3 — Download the finished video as a real .mp4 file
curl -L -o video.mp4 "${base}/api/v1/video/{jobId}/download" \\
  -H "Authorization: Bearer ${apiKey}"`;

  const videoPython = `import requests, time

# ── Option A: Synchronous mode ─────────────────────────────────────────
# One call returns the finished videoUrl (up to ~4 min wait).
sync = requests.post(
    "${base}/api/v1/video?wait=true",
    headers={"Authorization": "Bearer ${apiKey}"},
    json={
        "model": "veo-3.1-fast-generate-001",
        "prompt": "A time-lapse of clouds over mountains",
        "durationSeconds": 8
    },
    timeout=300,
).json()
print("Video URL:", sync.get("videoUrl"))

# ── Option B: Async mode — start now, poll later ──────────────────────
start = requests.post(
    "${base}/api/v1/video",
    headers={"Authorization": "Bearer ${apiKey}"},
    json={
        "model": "veo-3.1-fast-generate-001",
        "prompt": "A time-lapse of clouds over mountains",
        "durationSeconds": 8
    },
).json()
job_id = start["jobId"]

while True:
    s = requests.get(
        f"${base}/api/v1/video/{job_id}/status",
        headers={"Authorization": "Bearer ${apiKey}"},
    ).json()

    if s["status"] == "completed":
        print("Video URL:", s["videoUrl"])
        break
    if s["status"] == "failed":
        print("Error:", s["errorMessage"])
        break

    time.sleep(5)

# ── Download as a real .mp4 file (works with any of the URI shapes) ───
dl = requests.get(
    f"${base}/api/v1/video/{job_id}/download",
    headers={"Authorization": "Bearer ${apiKey}"},
    stream=True,
)
with open("video.mp4", "wb") as f:
    for chunk in dl.iter_content(8192):
        f.write(chunk)`;

  const videoJs = `// ── Option A: Synchronous mode ─────────────────────────────────────
// One call waits up to 4 minutes and returns the finished video.
const sync = await fetch("${base}/api/v1/video?wait=true", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${apiKey}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "veo-3.1-fast-generate-001",
    prompt: "A time-lapse of clouds over mountains",
    durationSeconds: 8
  })
}).then(r => r.json());
console.log("Video URL:", sync.videoUrl);

// ── Option B: Async mode — start now, poll later ───────────────────
const start = await fetch("${base}/api/v1/video", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${apiKey}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "veo-3.1-fast-generate-001",
    prompt: "A time-lapse of clouds over mountains",
    durationSeconds: 8
  })
});
const { jobId } = await start.json();

async function pollVideo(jobId) {
  const res = await fetch(\`${base}/api/v1/video/\${jobId}/status\`, {
    headers: { "Authorization": "Bearer ${apiKey}" }
  });
  const s = await res.json();
  if (s.status === "completed") return s.videoUrl;
  if (s.status === "failed") throw new Error(s.errorMessage);
  await new Promise(r => setTimeout(r, 5000));
  return pollVideo(jobId);
}

const videoUrl = await pollVideo(jobId);
console.log("Video ready:", videoUrl);

// ── Download the finished video as a real MP4 blob ────────────────
const mp4 = await fetch(\`${base}/api/v1/video/\${jobId}/download\`, {
  headers: { "Authorization": "Bearer ${apiKey}" }
}).then(r => r.blob());
console.log("MP4 size (bytes):", mp4.size);`;

  const videoStartResponse = `{
  "jobId": "req_vid123",
  "status": "pending",
  "videoUrl": null,
  "errorMessage": null,
  "model": "veo-3.1-fast-generate-001",
  "costUsd": 2.0,
  "statusUrl": "/api/v1/video/req_vid123/status",
  "pollIntervalSeconds": 10,
  "estimatedSeconds": 60
}`;

  const videoPollResponse = `{
  "jobId": "req_vid123",
  "status": "completed",
  "videoUrl": "https://storage.googleapis.com/...",
  "downloadUrl": "${base}/api/v1/video/req_vid123/download",
  "errorMessage": null,
  "model": "veo-3.1-fast-generate-001",
  "costUsd": 0.66
}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API Documentation</h1>
        <p className="text-muted-foreground mt-1">Complete reference for all gateway endpoints with code examples.</p>
      </div>

      {/* Video Tutorials — admin-managed; rendered at the TOP for maximum visibility. Only renders when at least one video is configured */}
      {videos.length > 0 && (
        <Card data-testid="card-video-tutorials" className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">{isAr ? "شروحات بالفيديو" : "Video Tutorials"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              {videos.map((v, i) => {
                const ytId = extractYouTubeId(v.url);
                return (
                  <div key={i} className="space-y-2" data-testid={`video-tutorial-${i}`}>
                    <h3 className="text-sm font-semibold leading-tight" data-testid={`video-title-${i}`}>{v.title}</h3>
                    {ytId ? (
                      <div className="aspect-video w-full overflow-hidden rounded-md border bg-muted">
                        <iframe
                          src={`https://www.youtube.com/embed/${ytId}`}
                          title={v.title}
                          loading="lazy"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          referrerPolicy="strict-origin-when-cross-origin"
                          className="h-full w-full border-0"
                          data-testid={`video-iframe-${i}`}
                        />
                      </div>
                    ) : (
                      <a
                        href={v.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary underline break-all"
                        data-testid={`video-link-${i}`}
                      >
                        {v.url}
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Base URL */}
      <Card>
        <CardHeader><CardTitle className="text-base">Base URL</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <CodeBlock code={base} />
          <div className="text-sm text-muted-foreground space-y-1">
            <p>All requests require: <code className="text-xs bg-muted px-1 py-0.5 rounded">Authorization: Bearer YOUR_API_KEY</code></p>
            <p>All responses are JSON. Errors return: <code className="text-xs bg-muted px-1 py-0.5 rounded">{"{ \"error\": \"...\" }"}</code></p>
          </div>
        </CardContent>
      </Card>

      {/* Models Reference */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionTitle>Available Models</SectionTitle>

          {/* Sort Controls */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1 hidden sm:inline">Sort:</span>
            <Button
              variant={sortMode === "default" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setSortMode("default")}
            >
              <ArrowUpDown className="h-3 w-3" />
              Default
            </Button>
            <Button
              variant={sortMode === "quality" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setSortMode("quality")}
            >
              <ArrowUp className="h-3 w-3" />
              Best first
            </Button>
            <Button
              variant={sortMode === "price-asc" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setSortMode("price-asc")}
            >
              <ArrowUp className="h-3 w-3" />
              Cheapest
            </Button>
            <Button
              variant={sortMode === "price-desc" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setSortMode("price-desc")}
            >
              <ArrowDown className="h-3 w-3" />
              Priciest
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Model ID</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Quality</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Pricing (with markup)</th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {isGrouped ? (
                  MODEL_SECTIONS.map((section) => (
                    <Fragment key={section.label}>
                      <tr className="bg-muted/40 border-t border-border/50">
                        <td colSpan={5} className="px-4 py-1.5 text-xs font-semibold text-muted-foreground tracking-wide uppercase">
                          {section.label}
                        </td>
                      </tr>
                      {section.models.map((m) => (
                        <ModelTableRow key={m.id} m={m} maxQuality={maxQuality} showDescription={true} />
                      ))}
                    </Fragment>
                  ))
                ) : (
                  sortedModels.map((m) => (
                    <ModelTableRow key={m.id} m={m} maxQuality={maxQuality} showDescription={true} />
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">
          Click the <ChevronDown className="inline h-3 w-3" /> arrow on any row to see model description and use cases.
          Model availability depends on your plan. Check the <strong>Plans</strong> page for details.
        </p>
      </div>

      {/* Chat Endpoint */}
      <div className="space-y-3">
        <SectionTitle>Text Generation</SectionTitle>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="bg-primary/10 text-primary font-mono">POST</Badge>
              <code className="text-base font-mono font-semibold">/api/v1/chat</code>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Chat completions using Gemini, Grok, Mistral, DeepSeek, and 40+ partner models. Supports multi-turn conversations and streaming.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Request Parameters</p>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-border/30">
                    {[
                      ["model", "string", "Required", "Model ID (e.g. gemini-3.1-pro-preview)"],
                      ["messages", "array", "Required", "Array of {role, content} objects"],
                      ["temperature", "number", "Optional", "0–2, default 1.0"],
                      ["maxOutputTokens", "number", "Optional", "Max tokens to generate"],
                      ["stream", "boolean", "Optional", "Stream response as SSE"],
                    ].map(([name, type, req, desc]) => (
                      <tr key={name}>
                        <td className="py-1.5 pr-2 font-mono text-primary">{name}</td>
                        <td className="py-1.5 pr-2 text-muted-foreground">{type}</td>
                        <td className="py-1.5 pr-2 text-muted-foreground">{req}</td>
                        <td className="py-1.5 text-muted-foreground">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Response</p>
                <CodeBlock code={chatResponse} />
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Examples</p>
              <Tabs defaultValue="curl">
                <TabsList className="mb-3">
                  <TabsTrigger value="curl">cURL</TabsTrigger>
                  <TabsTrigger value="python">Python</TabsTrigger>
                  <TabsTrigger value="javascript">JavaScript</TabsTrigger>
                </TabsList>
                <TabsContent value="curl" className="m-0"><CodeBlock code={chatCurl} /></TabsContent>
                <TabsContent value="python" className="m-0"><CodeBlock code={chatPython} /></TabsContent>
                <TabsContent value="javascript" className="m-0"><CodeBlock code={chatJs} /></TabsContent>
              </Tabs>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Generate Endpoint */}
      <div className="space-y-3">
        <SectionTitle>Image Generation</SectionTitle>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="bg-primary/10 text-primary font-mono">POST</Badge>
              <code className="text-base font-mono font-semibold">/api/v1/generate</code>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Generate images using Imagen models. Returns base64-encoded PNG images.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Request Parameters</p>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-border/30">
                    {[
                      ["model", "string", "Required", "Imagen model ID"],
                      ["prompt", "string", "Required", "Image description"],
                      ["sampleCount", "number", "Optional", "Number of images, default 1"],
                      ["n", "number", "Optional", "Alias for sampleCount"],
                    ].map(([name, type, req, desc]) => (
                      <tr key={name}>
                        <td className="py-1.5 pr-2 font-mono text-primary">{name}</td>
                        <td className="py-1.5 pr-2 text-muted-foreground">{type}</td>
                        <td className="py-1.5 pr-2 text-muted-foreground">{req}</td>
                        <td className="py-1.5 text-muted-foreground">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground mt-3">
                  To display the image:<br />
                  <code className="bg-muted px-1 py-0.5 rounded">data:image/png;base64,{"{images[0].base64}"}</code>
                </p>
                <p className="text-xs text-muted-foreground mt-2 p-2 border rounded bg-muted/30">
                  💡 <strong>Tip:</strong> Numeric fields (<code>sampleCount</code>, <code>n</code>) accept either numbers (<code>1</code>) or numeric strings (<code>"1"</code>) — useful for n8n / Zapier / form-data clients.
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Response</p>
                <CodeBlock code={genResponse} />
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Examples</p>
              <Tabs defaultValue="curl">
                <TabsList className="mb-3">
                  <TabsTrigger value="curl">cURL</TabsTrigger>
                  <TabsTrigger value="python">Python</TabsTrigger>
                  <TabsTrigger value="javascript">JavaScript</TabsTrigger>
                </TabsList>
                <TabsContent value="curl" className="m-0"><CodeBlock code={genCurl} /></TabsContent>
                <TabsContent value="python" className="m-0"><CodeBlock code={genPython} /></TabsContent>
                <TabsContent value="javascript" className="m-0"><CodeBlock code={genJs} /></TabsContent>
              </Tabs>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Video Endpoint */}
      <div className="space-y-3">
        <SectionTitle>Video Generation</SectionTitle>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="bg-primary/10 text-primary font-mono">POST</Badge>
              <code className="text-base font-mono font-semibold">/api/v1/video</code>
              <Badge variant="secondary" className="text-xs">Async</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Generate videos using Veo models. Video generation is asynchronous — start a job then poll for completion.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Step 1 — POST /api/v1/video</p>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-border/30">
                      {[
                        ["model", "string", "Required", "Veo model ID. We recommend veo-3.1-fast-generate-001 for testing — it's the cheapest. Use veo-3.1-generate-001 or veo-2.0-generate-001 for production."],
                        ["prompt", "string", "Required", "Video description"],
                        ["durationSeconds", "number", "Optional", "Veo 3.x accepts only 4, 6, or 8 seconds (default 8). Veo 2 accepts 5–8. Sending an unsupported value will fail the job."],
                      ].map(([name, type, req, desc]) => (
                        <tr key={name}>
                          <td className="py-1.5 pr-2 font-mono text-primary">{name}</td>
                          <td className="py-1.5 pr-2 text-muted-foreground">{type}</td>
                          <td className="py-1.5 pr-2 text-muted-foreground">{req}</td>
                          <td className="py-1.5 text-muted-foreground">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Step 2 — GET /api/v1/video/:jobId/status</p>
                  <p className="text-xs text-muted-foreground">Poll this endpoint every 5–10 seconds until <code className="bg-muted px-1 rounded">status</code> is <code className="bg-muted px-1 rounded">completed</code> or <code className="bg-muted px-1 rounded">failed</code>. Tip: add <code className="bg-muted px-1 rounded">?wait=true</code> to Step&nbsp;1 to skip polling — the server waits up to 4 minutes and returns the finished video in one call. Duplicate requests within 10 minutes are deduplicated (no double billing).</p>
                  <p className="text-xs text-muted-foreground mt-2">Step 3 — <code className="bg-muted px-1 rounded">GET /api/v1/video/:jobId/download</code> streams the finished clip back as a real <code className="bg-muted px-1 rounded">video/mp4</code> file with <code className="bg-muted px-1 rounded">Content-Disposition: attachment</code> — ready to save from a browser, n8n, or Zapier.</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Start response</p>
                  <CodeBlock code={videoStartResponse} />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Poll response (done)</p>
                  <CodeBlock code={videoPollResponse} />
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Examples</p>
              <Tabs defaultValue="curl">
                <TabsList className="mb-3">
                  <TabsTrigger value="curl">cURL</TabsTrigger>
                  <TabsTrigger value="python">Python</TabsTrigger>
                  <TabsTrigger value="javascript">JavaScript</TabsTrigger>
                </TabsList>
                <TabsContent value="curl" className="m-0"><CodeBlock code={videoCurl} /></TabsContent>
                <TabsContent value="python" className="m-0"><CodeBlock code={videoPython} /></TabsContent>
                <TabsContent value="javascript" className="m-0"><CodeBlock code={videoJs} /></TabsContent>
              </Tabs>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Image Edits / Inpainting */}
      <div className="space-y-3">
        <SectionTitle>{isAr ? "تعديل الصور (Inpainting)" : "Image Edits (Inpainting)"}</SectionTitle>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="bg-primary/10 text-primary font-mono">POST</Badge>
              <code className="text-base font-mono font-semibold">/api/v1/images/edits</code>
              <Badge variant="secondary" className="text-xs">multipart/form-data</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {isAr
                ? "تعديل الصور باستخدام قناع (mask) وموجه نصي. متوافق مع OpenAI. يستخدم Imagen 3 capability خلف الكواليس."
                : "Edit images with a mask and a text prompt. OpenAI-compatible. Powered by Imagen 3 capability under the hood."}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border/30">
                {[
                  ["image", "file", "Required", isAr ? "ملف الصورة الأصلية (PNG/JPEG)" : "Original image file (PNG/JPEG)"],
                  ["mask", "file", "Required", isAr ? "قناع PNG: المناطق الشفافة سيتم تعديلها" : "PNG mask: transparent regions will be edited"],
                  ["prompt", "string", "Required", isAr ? "وصف التعديل المطلوب" : "Description of the edit"],
                  ["model", "string", "Optional", isAr ? "افتراضي: dall-e-2 → imagen-3.0-capability-001" : "Default: dall-e-2 → imagen-3.0-capability-001"],
                  ["n", "number", "Optional", isAr ? "عدد الصور (1-4)" : "Number of images (1-4)"],
                ].map(([name, type, req, desc]) => (
                  <tr key={name}>
                    <td className="py-1.5 pr-2 font-mono text-primary">{name}</td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{type}</td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{req}</td>
                    <td className="py-1.5 text-muted-foreground">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <CodeBlock code={`curl -X POST https://YOUR_DOMAIN/api/v1/images/edits \\
  -H "Authorization: Bearer $API_KEY" \\
  -F image=@photo.png \\
  -F mask=@mask.png \\
  -F prompt="Replace the sky with a sunset"`} />
          </CardContent>
        </Card>
      </div>

      {/* Audio TTS / STT */}
      <div className="space-y-3">
        <SectionTitle>{isAr ? "الصوت (TTS / STT)" : "Audio (TTS / STT)"}</SectionTitle>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="bg-primary/10 text-primary font-mono">POST</Badge>
              <code className="text-base font-mono font-semibold">/api/v1/audio/speech</code>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {isAr
                ? "تحويل النص إلى كلام. متوافق مع OpenAI. يدعم MP3, WAV, OGG. الأسعار حسب عدد الأحرف."
                : "Text-to-speech. OpenAI-compatible. Supports MP3, WAV, OGG. Priced per character."}
            </p>
          </CardHeader>
          <CardContent>
            <CodeBlock code={`curl -X POST https://YOUR_DOMAIN/api/v1/audio/speech \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"tts-1","input":"Hello world","voice":"alloy","response_format":"mp3"}' \\
  --output speech.mp3`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="bg-primary/10 text-primary font-mono">POST</Badge>
              <code className="text-base font-mono font-semibold">/api/v1/audio/transcriptions</code>
              <Badge variant="secondary" className="text-xs">multipart/form-data</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {isAr
                ? "تحويل الكلام إلى نص. متوافق مع OpenAI Whisper. الأسعار حسب الثانية."
                : "Speech-to-text. OpenAI Whisper-compatible. Priced per second."}
            </p>
          </CardHeader>
          <CardContent>
            <CodeBlock code={`curl -X POST https://YOUR_DOMAIN/api/v1/audio/transcriptions \\
  -H "Authorization: Bearer $API_KEY" \\
  -F file=@audio.mp3 \\
  -F model=whisper-1`} />
          </CardContent>
        </Card>
      </div>

      {/* Organizations note */}
      <div className="space-y-3">
        <SectionTitle>{isAr ? "الفرق والمؤسسات" : "Teams & Organizations"}</SectionTitle>
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground space-y-2">
            <p>
              {isAr
                ? "يمكنك إنشاء مؤسسات لمشاركة العمل مع زملائك. كل مؤسسة لديها أعضاء بأدوار (مالك، مسؤول، مطور، مشاهد). الأدوار: المالك يتحكم بالكل؛ المسؤول يدير الأعضاء والدعوات؛ المطور يستخدم API؛ المشاهد للقراءة فقط."
                : "Create organizations to share work with teammates. Each org has members with roles (owner, admin, developer, viewer). Roles: owner has full control; admin manages members and invites; developer uses APIs; viewer is read-only."}
            </p>
            <p>
              {isAr
                ? "ملاحظة: في هذه المرحلة، أرصدة المؤسسات ومفاتيح API الخاصة بالمؤسسة هي أساس جاهز — واجهة المستخدم لإنشاء مفاتيح مرتبطة بالمؤسسة وحدود الإنفاق على مستوى المؤسسة ستضاف لاحقاً."
                : "Note: at this stage, org credit pools and org-owned API keys are foundation-ready — UI to create org-linked keys and org-level spend limits is coming soon."}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Compatibility & Aliases */}
      <div className="space-y-3">
        <SectionTitle>Compatibility &amp; Aliases</SectionTitle>
        <Card>
          <CardHeader>
            <p className="text-sm text-muted-foreground">
              Some clients (n8n, Zapier, OpenAI SDKs) ship with OpenAI-native model names. We accept
              those and route them to the closest Google Vertex AI equivalent. Every response returns
              an <code className="bg-muted px-1 rounded">X-Backend-Model</code> header so you always
              know which real model handled your request.
            </p>
            <p className="text-sm text-muted-foreground mt-2" dir="rtl" lang="ar">
              بعض الواجهات (مثل n8n وZapier) تستخدم أسماء نماذج OpenAI الأصلية. نحن نقبلها ونوجّهها
              تلقائيًا إلى أحدث نماذج Google Vertex AI المكافئة. كل استجابة تُرجع رأس{" "}
              <code className="bg-muted px-1 rounded">X-Backend-Model</code> للشفافية.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Video models (Sora ↔ Veo)
              </p>
              <table className="w-full text-xs border border-border/40 rounded">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="py-2 px-3 text-left font-medium">Alias (request)</th>
                    <th className="py-2 px-3 text-left font-medium">Actual backend model</th>
                    <th className="py-2 px-3 text-left font-medium">Max duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {[
                    ["sora-2", "veo-3.1-fast-generate-001", "8s"],
                    ["sora-2-pro", "veo-3.1-generate-001", "8s"],
                  ].map(([alias, real, max]) => (
                    <tr key={alias}>
                      <td className="py-1.5 px-3 font-mono text-primary">{alias}</td>
                      <td className="py-1.5 px-3 font-mono text-muted-foreground">{real}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">{max}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Image models (DALL-E ↔ Imagen) */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Image models (DALL-E / GPT Image ↔ Imagen)
              </p>
              <table className="w-full text-xs border border-border/40 rounded">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="py-2 px-3 text-left font-medium">Alias (request)</th>
                    <th className="py-2 px-3 text-left font-medium">Actual backend model</th>
                    <th className="py-2 px-3 text-left font-medium">Price / image</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {[
                    ["dall-e-2", "imagen-3.0-fast-generate-001", "$0.02"],
                    ["dall-e-3", "imagen-4.0-generate-001", "$0.04"],
                    ["gpt-image-1", "imagen-4.0-ultra-generate-001", "$0.06"],
                  ].map(([alias, real, price]) => (
                    <tr key={alias}>
                      <td className="py-1.5 px-3 font-mono text-primary">{alias}</td>
                      <td className="py-1.5 px-3 font-mono text-muted-foreground">{real}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">{price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-2">
                Mapping is preserved by quality tier: worst → worst, best → best. Aliases bill at the
                exact same base price as the real backend model (no extra alias premium). The standard
                gateway markup applies uniformly to every model.
              </p>
              <p className="text-xs text-muted-foreground mt-1" dir="rtl" lang="ar">
                الربط محفوظ حسب طبقة الجودة: الأسوأ → الأسوأ، الأفضل → الأفضل. الأسماء البديلة تُحاسَب
                بنفس السعر الأساسي للنموذج الفعلي تماماً (دون أي علاوة على الاسم البديل). هامش البوّابة
                القياسي يُطبَّق بالتساوي على جميع النماذج.
              </p>
            </div>

            <div className="text-xs text-muted-foreground space-y-2">
              <p>
                <span className="font-medium">Video endpoints:</span>{" "}
                <code className="bg-muted px-1 rounded">POST /v1/videos</code>,{" "}
                <code className="bg-muted px-1 rounded">GET /v1/videos/:id</code>,{" "}
                <code className="bg-muted px-1 rounded">GET /v1/videos/:id/content</code>{" "}
                — OpenAI Sora-compatible (works with the n8n OpenAI Video node out of the box).
              </p>
              <p>
                <span className="font-medium">Image endpoints:</span>{" "}
                <code className="bg-muted px-1 rounded">POST /v1/images/generations</code>{" "}
                — OpenAI-compatible (works with the n8n OpenAI Image node out of the box). Returns{" "}
                <code className="bg-muted px-1 rounded">{`{ created, data: [{ b64_json }] }`}</code>.
                The legacy <code className="bg-muted px-1 rounded">POST /v1/generate</code> also accepts
                these aliases for backward compatibility.
              </p>
              <p>
                <span className="font-medium">Important limits:</span>{" "}
                Veo 3.1 supports only 4, 6, or 8 seconds. Unsupported values return a clear error
                message naming both the alias and the real backend (e.g. &quot;sora-2 (powered by
                veo-3.1-fast-generate-001) supports up to 8 seconds&quot;).
              </p>
              <p>
                <span className="font-medium">Independent rate limits:</span>{" "}
                Each endpoint group (chat, video, embeddings, generate, responses) has its own RPM
                bucket, so heavy chat traffic does not starve your video budget.
              </p>
              <p dir="rtl" lang="ar">
                <span className="font-medium">حدود معدّل مستقلّة:</span>{" "}
                كل مجموعة (chat, video, embeddings, generate, responses) لها سلّتها الخاصة، فلا
                يستهلك الدردشة المزدحمة حصّة الفيديو. النماذج البديلة (sora-2 → veo-3.1-fast، sora-2-pro
                → veo-3.1) تُرجع رأس <code className="bg-muted px-1 rounded">X-Backend-Model</code>{" "}
                لمعرفة النموذج الفعلي خلف الكواليس.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
