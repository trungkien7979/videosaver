import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Constants & Configuration ---

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TIKWM_API = "https://www.tikwm.com/api/";

// --- Types ---

interface VideoMetadata {
  platform: string;
  title: string;
  size: string;
  thumbnail: string;
  duration: string;
  quality: string;
  downloadUrl: string;
  needsExtraction: boolean;
}

// --- Utils ---

const resolveUrl = async (url: string): Promise<string> => {
  try {
    const res = await axios.get(url, {
      maxRedirects: 10,
      headers: { "User-Agent": UA },
      timeout: 8000,
      validateStatus: () => true,
    });
    return res.request?.res?.responseUrl || url;
  } catch {
    return url;
  }
};

const detectPlatform = (url: string): string => {
  const u = url.toLowerCase();
  if (u.includes("tiktok.com")) return "TikTok";
  if (u.includes("douyin.com") || u.includes("v.douyin")) return "Douyin";
  if (u.includes("xiaohongshu.com") || u.includes("xhslink.com"))
    return "Xiaohongshu";
  if (u.includes("instagram.com")) return "Instagram";
  if (
    u.includes("facebook.com") ||
    u.includes("fb.watch") ||
    u.includes("fb.com")
  )
    return "Facebook";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "YouTube";
  if (u.includes("twitter.com") || u.includes("x.com")) return "Twitter/X";
  if (u.includes("threads.net")) return "Threads";
  if (u.includes("reddit.com") || u.includes("redd.it")) return "Reddit";
  if (u.includes("pinterest.com") || u.includes("pin.it")) return "Pinterest";
  return "Social Media";
};

const fmtDuration = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return "Unknown";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const fmtSize = (bytes: number): string =>
  bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "Unknown";

// --- Extractor 1: yt-dlp (YouTube, Instagram, Facebook, Twitter, Threads, etc.) ---

async function tryYtDlp(
  url: string,
  platform: string,
): Promise<VideoMetadata | null> {
  try {
    console.log(`[yt-dlp] Trying for ${platform}...`);

    // Normalize YouTube Shorts URL to watch URL
    let targetUrl = url;
    if (platform === "YouTube" && url.includes("/shorts/")) {
      const videoId = url.split("/shorts/")[1]?.split("?")[0];
      if (videoId) targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
    }

    // Get JSON metadata (stderr goes to process.stderr naturally via child_process)
    const jsonResult = await execFileAsync(
      "yt-dlp",
      ["--dump-json", "--no-download", "--no-playlist", targetUrl],
      { timeout: 30000, maxBuffer: 20 * 1024 * 1024 },
    );

    // yt-dlp may output warnings to stderr then JSON to stdout
    const stdout = jsonResult.stdout.trim();
    if (!stdout) return null;

    // Find JSON line (last line that starts with {)
    const lines = stdout.split("\n");
    const jsonLine = lines.filter((l) => l.trim().startsWith("{")).pop();
    if (!jsonLine) return null;

    const info = JSON.parse(jsonLine);

    // For YouTube: get the direct stream URL of the best combined format
    let downloadUrl = "";
    if (platform === "YouTube") {
      const fmts: any[] = info.formats || [];

      // Combined (video+audio in single stream) — usually up to 720p
      const combined = fmts
        .filter(
          (f) =>
            f.ext === "mp4" &&
            f.vcodec &&
            f.vcodec !== "none" &&
            f.acodec &&
            f.acodec !== "none" &&
            f.url,
        )
        .sort((a, b) => (b.height || 0) - (a.height || 0));

      if (combined.length > 0) {
        downloadUrl = combined[0].url;
      } else {
        // Fall back to best video-only mp4
        const best = fmts
          .filter((f) => f.url && f.vcodec && f.vcodec !== "none")
          .sort((a, b) => (b.height || 0) - (a.height || 0));
        downloadUrl = best[0]?.url || info.url || "";
      }
    } else {
      // For other platforms: use best url from yt-dlp info
      const fmts: any[] = info.formats || [];
      const best = fmts
        .filter((f) => f.url && f.vcodec && f.vcodec !== "none")
        .sort(
          (a, b) =>
            (b.filesize || b.height || 0) - (a.filesize || a.height || 0),
        );
      downloadUrl = best[0]?.url || info.url || "";
    }

    if (!downloadUrl) return null;

    console.log(`[yt-dlp] ✅ Got URL for ${platform}`);

    return {
      platform,
      title: info.title || `${platform} Video`,
      size: info.filesize ? fmtSize(info.filesize) : "Unknown",
      thumbnail:
        info.thumbnail ||
        `https://picsum.photos/seed/${platform.toLowerCase()}/800/800`,
      duration: info.duration ? fmtDuration(info.duration) : "Unknown",
      quality: info.height ? `${info.height}p` : "Best Available",
      downloadUrl,
      needsExtraction: false,
    };
  } catch (e: any) {
    const errMsg =
      (e.stderr || e.message || "")
        .split("\n")
        .find((l: string) => l.includes("ERROR")) || e.message?.split("\n")[0];
    console.error(`[yt-dlp] Error for ${platform}:`, errMsg);
    return null;
  }
}

// --- Extractor 2: TikWM (TikTok / Douyin - no watermark) ---

async function tryTikWM(
  url: string,
  platform: string,
): Promise<VideoMetadata | null> {
  try {
    console.log(`[TikWM] Trying for ${platform}...`);
    const response = await axios.post(TIKWM_API, new URLSearchParams({ url }), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 12000,
    });

    const data = response.data?.data;
    if (data && (data.play || data.wmplay)) {
      console.log(`[TikWM] ✅ Success`);
      return {
        platform,
        title: data.title || `${platform} Video`,
        size: fmtSize(data.size || 0),
        thumbnail:
          data.cover ||
          `https://picsum.photos/seed/${platform.toLowerCase()}/800/800`,
        duration: data.duration ? fmtDuration(data.duration) : "00:00",
        quality: "HD No Watermark",
        downloadUrl: data.play || data.wmplay,
        needsExtraction: false,
      };
    }
  } catch (e: any) {
    console.error("[TikWM] Error:", e.message);
  }
  return null;
}

// --- Extractor 3: VxTwitter / FxTwitter ---

async function tryTwitterAPI(url: string): Promise<VideoMetadata | null> {
  // Try VxTwitter first
  try {
    console.log("[VxTwitter] Trying...");
    const apiUrl = url
      .replace("https://twitter.com/", "https://api.vxtwitter.com/")
      .replace("https://x.com/", "https://api.vxtwitter.com/");

    const res = await axios.get(apiUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
      },
      timeout: 10000,
    });

    const data = res.data;
    const media = data?.media_extended || [];
    const video = media.find(
      (m: any) => m.type === "video" && m.url && m.url.includes("http"),
    );

    if (video?.url) {
      console.log("[VxTwitter] ✅ Success");
      return {
        platform: "Twitter/X",
        title: (data.text || data.tweetText || "Twitter/X Video").substring(
          0,
          80,
        ),
        size: "Unknown",
        thumbnail:
          video.thumbnail_url ||
          media.find((m: any) => m.thumbnail_url)?.thumbnail_url ||
          "https://picsum.photos/seed/twitter/800/800",
        duration: video.duration_millis
          ? fmtDuration(Math.round(video.duration_millis / 1000))
          : "Unknown",
        quality: "Best Available",
        downloadUrl: video.url,
        needsExtraction: false,
      };
    }
  } catch (e: any) {
    console.warn("[VxTwitter] Failed:", e.message);
  }

  // Try FxTwitter
  try {
    console.log("[FxTwitter] Trying...");
    const fxApiUrl = url
      .replace("https://twitter.com/", "https://api.fxtwitter.com/")
      .replace("https://x.com/", "https://api.fxtwitter.com/");

    const res = await axios.get(fxApiUrl, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      timeout: 10000,
    });

    const tweet = res.data?.tweet;
    const videos = tweet?.media?.videos;
    const video = Array.isArray(videos) ? videos[0] : null;

    if (video?.url) {
      console.log("[FxTwitter] ✅ Success");
      return {
        platform: "Twitter/X",
        title: (tweet.text || "Twitter/X Video").substring(0, 80),
        size: "Unknown",
        thumbnail:
          video.thumbnail_url ||
          tweet.author?.avatar_url ||
          "https://picsum.photos/seed/twitter/800/800",
        duration: video.duration
          ? fmtDuration(Math.round(video.duration))
          : "Unknown",
        quality: "Best Available",
        downloadUrl: video.url,
        needsExtraction: false,
      };
    }
  } catch (e: any) {
    console.warn("[FxTwitter] Failed:", e.message);
  }

  return null;
}

// --- Extractor 4: Reddit JSON API ---

async function tryRedditAPI(url: string): Promise<VideoMetadata | null> {
  try {
    console.log("[Reddit] Trying JSON API...");
    let targetUrl = url;

    // Resolve short links (redd.it)
    if (url.includes("redd.it") && !url.includes("reddit.com")) {
      targetUrl = await resolveUrl(url);
    }

    const jsonUrl = targetUrl.split("?")[0].replace(/\/$/, "") + ".json";

    const res = await axios.get(jsonUrl, {
      headers: {
        "User-Agent": "VideoSaver/2.0 (by /u/videosaverapp)",
        Accept: "application/json",
      },
      timeout: 12000,
    });

    if (!Array.isArray(res.data)) return null;
    const post = res.data[0]?.data?.children?.[0]?.data;
    if (!post) return null;

    // Reddit native video (v.redd.it)
    const rv =
      post.media?.reddit_video ||
      post.secure_media?.reddit_video ||
      post.crosspost_parent_list?.[0]?.media?.reddit_video;

    if (rv?.fallback_url) {
      const videoUrl = rv.fallback_url.replace(/&amp;/g, "&");
      console.log("[Reddit] ✅ Got video URL");
      return {
        platform: "Reddit",
        title: post.title || "Reddit Video",
        size: "Unknown",
        thumbnail: post.thumbnail?.startsWith("http")
          ? post.thumbnail
          : `https://picsum.photos/seed/reddit/800/800`,
        duration: rv.duration ? fmtDuration(rv.duration) : "Unknown",
        quality: rv.height ? `${rv.height}p` : "Best Available",
        downloadUrl: videoUrl,
        needsExtraction: false,
      };
    }

    // Embedded video from other source
    if (post.url_overridden_by_dest?.includes("v.redd.it")) {
      const resolved = await resolveUrl(
        post.url_overridden_by_dest + "/DASH_1080.mp4",
      );
      if (resolved !== post.url_overridden_by_dest + "/DASH_1080.mp4") {
        return {
          platform: "Reddit",
          title: post.title || "Reddit Video",
          size: "Unknown",
          thumbnail: "https://picsum.photos/seed/reddit/800/800",
          duration: "Unknown",
          quality: "1080p",
          downloadUrl: resolved,
          needsExtraction: false,
        };
      }
      // Try v.redd.it directly with known DASH path
      const dashUrl = `${post.url_overridden_by_dest}/CMAF_1080.mp4?source=fallback`;
      return {
        platform: "Reddit",
        title: post.title || "Reddit Video",
        size: "Unknown",
        thumbnail: "https://picsum.photos/seed/reddit/800/800",
        duration: "Unknown",
        quality: "1080p",
        downloadUrl: dashUrl,
        needsExtraction: false,
      };
    }
  } catch (e: any) {
    console.error("[Reddit] Error:", e.message);
  }
  return null;
}

// --- Extractor 5: Native Xiaohongshu Scraper ---

async function tryNativeXHS(url: string): Promise<VideoMetadata | null> {
  try {
    console.log("[XHS] Trying native scrape...");
    const resolvedUrl = url.includes("xhslink.com")
      ? await resolveUrl(url)
      : url;

    const res = await axios.get(resolvedUrl, {
      headers: {
        "User-Agent": UA,
        Referer: "https://www.xiaohongshu.com",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      timeout: 10000,
    });
    const html: string = res.data;

    const patterns = [
      // Pattern cho originVideoKey (key riêng, cần ghép domain)
      /originVideoKey["'\s:]+([^"'<>\s]+\.mp4[^"'<>\s]*)/i,
      // Pattern cho URL đầy đủ trong JSON (decode unicode escapes)
      /"url"\s*:\s*"(https?:\/\/[^"]+\.mp4[^"]*)"/i,
      // Pattern cho videoUrl
      /videoUrl[:\s"']+(\bhttps?:\/\/[^\s"'&]+)/i,
      // Pattern cho video object
      /"video"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i,
      // Fallback: bất kỳ URL nào từ xhscdn
      /(https?:\/\/[^"'\s]+xhscdn\.com[^"'\s]*\.mp4[^"'\s]*)/i,
      /(https?:\/\/[^"'\s]+sns-video[^"'\s]*\.mp4[^"'\s]*)/i,
    ];

    for (const pattern of patterns) {
      const m = html.match(pattern);
      if (m?.[1]) {
        // Decode unicode escapes (e.g. \u002F -> /) then clean backslashes
        let videoUrl = m[1];
        // Replace \uXXXX sequences
        videoUrl = videoUrl.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
          String.fromCharCode(parseInt(h, 16)),
        );
        // Replace escaped slashes and remaining backslashes
        videoUrl = videoUrl.split("\\/").join("/");
        videoUrl = videoUrl.split("\\").join("");
        // If it's a relative path/key, prepend XHS video CDN
        if (!videoUrl.startsWith("http")) {
          videoUrl = `https://sns-video-bd.xhscdn.com/${videoUrl}`;
        }
        console.log("[XHS] ✅ Got video URL via pattern");
        return {
          platform: "Xiaohongshu",
          title: "Xiaohongshu Video",
          size: "Unknown",
          thumbnail: "https://picsum.photos/seed/xhs/800/800",
          duration: "Unknown",
          quality: "Original",
          downloadUrl: videoUrl,
          needsExtraction: false,
        };
      }
    }
    console.warn("[XHS] No video URL found in HTML");
  } catch (e: any) {
    console.error("[XHS] Error:", e.message);
  }
  return null;
}

// --- Orchestrator ---

async function fetchVideoMetadata(rawUrl: string): Promise<VideoMetadata> {
  const url = rawUrl.trim();
  const platform = detectPlatform(url);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[Server] 🚀 Processing: ${platform} | ${url.substring(0, 60)}`);
  console.log(`${"=".repeat(60)}`);

  let metadata: VideoMetadata | null = null;

  if (platform === "TikTok" || platform === "Douyin") {
    // TikWM có watermark-free, ưu tiên số 1
    metadata = await tryTikWM(url, platform);
    // Fallback: yt-dlp (sẽ có watermark với Douyin)
    if (!metadata) metadata = await tryYtDlp(url, platform);
  } else if (platform === "Twitter/X" || platform === "Threads") {
    // VxTwitter/FxTwitter trước (nhanh)
    metadata = await tryTwitterAPI(url);
    // Fallback: yt-dlp
    if (!metadata) metadata = await tryYtDlp(url, platform);
  } else if (platform === "Reddit") {
    // Reddit JSON API trước (direct, nhanh)
    metadata = await tryRedditAPI(url);
    // Fallback: yt-dlp
    if (!metadata) metadata = await tryYtDlp(url, platform);
  } else if (platform === "YouTube") {
    // yt-dlp là best choice cho YouTube
    metadata = await tryYtDlp(url, platform);
  } else if (platform === "Instagram" || platform === "Facebook") {
    // yt-dlp hỗ trợ Instagram public posts và Facebook
    metadata = await tryYtDlp(url, platform);
  } else if (platform === "Xiaohongshu") {
    // yt-dlp xử lý XHS tốt hơn (hỗ trợ nhiều định dạng và bypass tốt hơn)
    metadata = await tryYtDlp(url, platform);
    // Fallback: native scraper nếu yt-dlp thất bại
    if (!metadata) metadata = await tryNativeXHS(url);
  } else {
    // Các platform khác: thử yt-dlp
    metadata = await tryYtDlp(url, platform);
  }

  if (!metadata) {
    console.warn(
      `[Server] ⚠️  All extractors failed for ${platform}, flagging for AI extraction`,
    );
    return {
      platform,
      title: `${platform} Video`,
      size: "Processing...",
      thumbnail: `https://picsum.photos/seed/${platform.toLowerCase()}/800/800`,
      duration: "Unknown",
      quality: "Best Available",
      downloadUrl: "",
      needsExtraction: true,
    };
  }

  console.log(
    `[Server] ✅ ${platform} → ${metadata.downloadUrl.substring(0, 70)}...`,
  );
  return metadata;
}

// --- Server Setup ---

async function startServer() {
  const app = express();
  app.use(express.json());

  // API: Fetch Video Info
  app.post("/api/fetch-video", async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const metadata = await fetchVideoMetadata(url);
      res.json({ success: true, metadata });
    } catch (err: any) {
      console.error("[Server] Fatal error:", err.message);
      res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

  // API: Proxy stream (bypass CORS + force download)
  app.get("/api/proxy", async (req, res) => {
    const { url, filename } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).send("URL is required");
    }

    const safeFilename =
      typeof filename === "string" && filename
        ? filename.replace(/[^a-zA-Z0-9._\-() ]/g, "_")
        : "video.mp4";

    try {
      let origin = "https://www.google.com";
      let referer = "https://www.google.com";
      try {
        const parsed = new URL(url);
        origin = parsed.origin;
        // YouTube needs specific referer
        if (parsed.hostname.includes("googlevideo.com")) {
          referer = "https://www.youtube.com";
          origin = "https://www.youtube.com";
        } else if (
          parsed.hostname.includes("tiktok") ||
          parsed.hostname.includes("tiktokcdn")
        ) {
          referer = "https://www.tiktok.com";
        } else if (
          parsed.hostname.includes("reddit") ||
          parsed.hostname.includes("redd.it")
        ) {
          referer = "https://www.reddit.com";
        } else if (parsed.hostname.includes("twimg.com")) {
          referer = "https://twitter.com";
        } else if (
          parsed.hostname.includes("xhscdn") ||
          parsed.hostname.includes("xiaohongshu") ||
          parsed.hostname.includes("sns-video")
        ) {
          referer = "https://www.xiaohongshu.com";
          origin = "https://www.xiaohongshu.com";
        }
      } catch {}

      // Forward range header if browser sends it (for resumable downloads)
      const rangeHeader = req.headers.range;

      const response = await axios({
        method: "get",
        url,
        responseType: "stream",
        headers: {
          "User-Agent": UA,
          Referer: referer,
          Origin: origin,
          Accept: "*/*",
          "Accept-Encoding": "identity", // prevent compressed response
          ...(rangeHeader ? { Range: rangeHeader } : {}),
        },
        timeout: 90000,
        maxRedirects: 10,
      });

      const contentType =
        (response.headers["content-type"] as string) || "video/mp4";

      // Check if upstream actually returned a valid video (not 403/404/HTML error page)
      const upstreamStatus = response.status;
      if (upstreamStatus === 403 || upstreamStatus === 401) {
        console.error(
          `[Proxy] CDN rejected with ${upstreamStatus}: ${url.substring(0, 80)}`,
        );
        return res
          .status(403)
          .send(
            `CDN rejected the request (${upstreamStatus}). The video URL may have expired or require authentication. Please re-fetch the video link.`,
          );
      }
      if (upstreamStatus === 404) {
        console.error(`[Proxy] CDN returned 404: ${url.substring(0, 80)}`);
        return res
          .status(404)
          .send("Video not found on CDN. The link may have expired.");
      }
      if (upstreamStatus >= 400) {
        console.error(
          `[Proxy] CDN error ${upstreamStatus}: ${url.substring(0, 80)}`,
        );
        return res.status(502).send(`Upstream CDN error: ${upstreamStatus}`);
      }

      // If content-type is HTML, the CDN returned an error page
      if (contentType.includes("text/html")) {
        console.error(
          `[Proxy] CDN returned HTML instead of video (likely auth error): ${url.substring(0, 80)}`,
        );
        return res
          .status(403)
          .send(
            "CDN returned an HTML page instead of video content. The URL may require login or has expired.",
          );
      }

      const isVideo =
        contentType.includes("video") || contentType.includes("octet-stream");
      const status = rangeHeader && response.status === 206 ? 206 : 200;

      const outHeaders: Record<string, string> = {
        "Content-Type": isVideo ? contentType : "video/mp4",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        "Access-Control-Allow-Origin": "*",
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      };

      if (response.headers["content-length"])
        outHeaders["Content-Length"] = response.headers[
          "content-length"
        ] as string;
      if (response.headers["content-range"])
        outHeaders["Content-Range"] = response.headers[
          "content-range"
        ] as string;

      console.log(
        `[Proxy] Streaming: ${safeFilename} | ${contentType} | upstream=${upstreamStatus} | client_status=${status}`,
      );

      res.writeHead(status, outHeaders);
      response.data.pipe(res);

      response.data.on("error", (err: Error) => {
        console.error("[Proxy] Stream error:", err.message);
        if (!res.headersSent) res.status(500).end();
      });

      req.on("close", () => {
        response.data.destroy();
      });
    } catch (error: any) {
      console.error("[Proxy] Error:", error.message);
      if (!res.headersSent)
        res.status(500).send(`Failed to proxy video: ${error.message}`);
    }
  });

  // Vite / Static logic
  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.get("*", async (req, res, next) => {
      try {
        let template = await fs.readFile(
          path.resolve(__dirname, "index.html"),
          "utf-8",
        );
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (req, res) =>
      res.sendFile(path.resolve(__dirname, "dist", "index.html")),
    );
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`\n🚀 VideoSaver Server ready → http://localhost:${PORT}`);
    console.log(`📦 Mode: ${IS_PROD ? "Production" : "Development"}`);
    console.log(
      `🔧 Engines: yt-dlp, TikWM, VxTwitter, FxTwitter, Reddit JSON\n`,
    );
  });
}

startServer().catch((err) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});
