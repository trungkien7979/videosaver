/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import {
  Download,
  Link as LinkIcon,
  Copy,
  Play,
  CheckCircle2,
  ChevronDown,
  Twitter,
  Facebook,
  Instagram,
  RefreshCw,
  Menu,
  Zap,
  ShieldCheck,
  Video,
  Monitor,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// --- Types ---

interface VideoMetadata {
  platform: string;
  title: string;
  size: string;
  thumbnail: string;
  duration: string;
  quality: string;
  downloadUrl: string;
}

// --- Utils ---

const fmtDuration = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return "Unknown";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const fmtSize = (bytes: number): string =>
  bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "Unknown";

// --- Platform Detectors ---

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

// --- Extractors (Client-Side, CORS-friendly) ---

// TikWM: supports CORS, works for TikTok & Douyin
async function tryTikWM(
  url: string,
  platform: string,
): Promise<VideoMetadata | null> {
  try {
    console.log(`[TikWM] Trying for ${platform}...`);
    const formData = new URLSearchParams({ url });
    const response = await fetch("https://www.tikwm.com/api/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });
    const json = await response.json();
    const data = json?.data;
    if (data && (data.play || data.wmplay)) {
      console.log(`[TikWM] ✅ Success`);
      return {
        platform,
        title: data.title || `${platform} Video`,
        size: fmtSize(data.size || 0),
        thumbnail:
          data.cover ||
          `https://picsum.photos/seed/${platform.toLowerCase()}/800/800`,
        duration: data.duration ? fmtDuration(data.duration) : "Unknown",
        quality: "HD No Watermark",
        downloadUrl: data.play || data.wmplay,
      };
    }
  } catch (e: any) {
    console.error("[TikWM] Error:", e.message);
  }
  return null;
}

// VxTwitter / FxTwitter: public JSON APIs for Twitter/X
async function tryTwitterAPI(url: string): Promise<VideoMetadata | null> {
  // VxTwitter
  try {
    console.log("[VxTwitter] Trying...");
    const apiUrl = url
      .replace("https://twitter.com/", "https://api.vxtwitter.com/")
      .replace("https://x.com/", "https://api.vxtwitter.com/");
    const res = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
    });
    const data = await res.json();
    const media = data?.media_extended || [];
    const video = media.find((m: any) => m.type === "video" && m.url);
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
      };
    }
  } catch (e: any) {
    console.warn("[VxTwitter] Failed:", e.message);
  }

  // FxTwitter
  try {
    console.log("[FxTwitter] Trying...");
    const fxApiUrl = url
      .replace("https://twitter.com/", "https://api.fxtwitter.com/")
      .replace("https://x.com/", "https://api.fxtwitter.com/");
    const res = await fetch(fxApiUrl, {
      headers: { Accept: "application/json" },
    });
    const data = await res.json();
    const tweet = data?.tweet;
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
      };
    }
  } catch (e: any) {
    console.warn("[FxTwitter] Failed:", e.message);
  }

  return null;
}

// Reddit: public JSON API
async function tryRedditAPI(url: string): Promise<VideoMetadata | null> {
  try {
    console.log("[Reddit] Trying JSON API...");
    const jsonUrl = url.split("?")[0].replace(/\/$/, "") + ".json";
    const res = await fetch(jsonUrl, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    const post = data[0]?.data?.children?.[0]?.data;
    if (!post) return null;

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
          : "https://picsum.photos/seed/reddit/800/800",
        duration: rv.duration ? fmtDuration(rv.duration) : "Unknown",
        quality: rv.height ? `${rv.height}p` : "Best Available",
        downloadUrl: videoUrl,
      };
    }
  } catch (e: any) {
    console.error("[Reddit] Error:", e.message);
  }
  return null;
}

// Cobalt API: free public API supporting many platforms (TikTok, Instagram, YouTube, etc.)
async function tryCobalt(
  url: string,
  platform: string,
): Promise<VideoMetadata | null> {
  // cobalt.tools public instance
  const COBALT_INSTANCES = [
    "https://cobalt.api.timelessnesses.me",
    "https://co.wuk.sh",
  ];

  for (const instance of COBALT_INSTANCES) {
    try {
      console.log(`[Cobalt] Trying ${instance} for ${platform}...`);
      const res = await fetch(`${instance}/api/json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          url,
          vQuality: "max",
          filenamePattern: "basic",
          isNoTTWatermark: true,
          isTTFullAudio: false,
          isAudioOnly: false,
        }),
      });

      if (!res.ok) continue;
      const data = await res.json();

      if (
        data.status === "stream" ||
        data.status === "redirect" ||
        data.status === "tunnel"
      ) {
        const downloadUrl = data.url;
        if (downloadUrl) {
          console.log(`[Cobalt] ✅ Success from ${instance}`);
          return {
            platform,
            title: `${platform} Video`,
            size: "Unknown",
            thumbnail: `https://picsum.photos/seed/${platform.toLowerCase()}/800/800`,
            duration: "Unknown",
            quality: "Best Available",
            downloadUrl,
          };
        }
      }

      if (
        data.status === "picker" &&
        Array.isArray(data.picker) &&
        data.picker.length > 0
      ) {
        const videoItem = data.picker.find(
          (p: any) => p.type === "video" || p.url?.includes("mp4"),
        );
        const item = videoItem || data.picker[0];
        if (item?.url) {
          console.log(`[Cobalt] ✅ Picker success from ${instance}`);
          return {
            platform,
            title: `${platform} Video`,
            size: "Unknown",
            thumbnail:
              item.thumb ||
              `https://picsum.photos/seed/${platform.toLowerCase()}/800/800`,
            duration: "Unknown",
            quality: "Best Available",
            downloadUrl: item.url,
          };
        }
      }
    } catch (e: any) {
      console.warn(`[Cobalt] ${instance} failed:`, e.message);
    }
  }
  return null;
}

// Savefrom: alternative for various platforms
async function trySaveFrom(
  url: string,
  platform: string,
): Promise<VideoMetadata | null> {
  try {
    console.log(`[SaveFrom] Trying for ${platform}...`);
    const apiUrl = `https://worker.sf-tools.com/savefrom.php?sf_url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.url && Array.isArray(data.url) && data.url.length > 0) {
      // Get highest quality
      const sorted = data.url.sort(
        (a: any, b: any) => (parseInt(b.id) || 0) - (parseInt(a.id) || 0),
      );
      const best = sorted[0];
      if (best?.url) {
        console.log(`[SaveFrom] ✅ Success`);
        return {
          platform,
          title: data.meta?.title || `${platform} Video`,
          size: "Unknown",
          thumbnail:
            data.meta?.thumb ||
            `https://picsum.photos/seed/${platform.toLowerCase()}/800/800`,
          duration: data.meta?.duration
            ? fmtDuration(parseInt(data.meta.duration))
            : "Unknown",
          quality: best.id || "Best Available",
          downloadUrl: best.url,
        };
      }
    }
  } catch (e: any) {
    console.warn("[SaveFrom] Failed:", e.message);
  }
  return null;
}

// --- Main Orchestrator (frontend-only) ---

async function fetchVideoMetadataClient(
  rawUrl: string,
): Promise<VideoMetadata> {
  const url = rawUrl.trim();
  const platform = detectPlatform(url);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[Client] 🚀 Processing: ${platform} | ${url.substring(0, 60)}`);
  console.log(`${"=".repeat(60)}`);

  let metadata: VideoMetadata | null = null;

  if (platform === "TikTok" || platform === "Douyin") {
    metadata = await tryTikWM(url, platform);
    if (!metadata) metadata = await tryCobalt(url, platform);
  } else if (platform === "Twitter/X" || platform === "Threads") {
    metadata = await tryTwitterAPI(url);
    if (!metadata) metadata = await tryCobalt(url, platform);
  } else if (platform === "Reddit") {
    metadata = await tryRedditAPI(url);
    if (!metadata) metadata = await tryCobalt(url, platform);
  } else if (
    platform === "Instagram" ||
    platform === "Facebook" ||
    platform === "YouTube"
  ) {
    metadata = await tryCobalt(url, platform);
  } else if (platform === "Xiaohongshu") {
    metadata = await tryCobalt(url, platform);
    if (!metadata) metadata = await tryTikWM(url, platform); // sometimes works
  } else {
    metadata = await tryCobalt(url, platform);
  }

  if (!metadata) {
    throw new Error(
      `Không tìm được link tải cho video ${platform} này. Hãy kiểm tra:\n` +
        `• Video có ở chế độ công khai không?\n` +
        `• Link có đúng không?\n` +
        `• Thử lại sau vài giây (API có thể bị giới hạn tạm thời)`,
    );
  }

  console.log(
    `[Client] ✅ ${platform} → ${metadata.downloadUrl.substring(0, 70)}...`,
  );
  return metadata;
}

// --- Download Handler ---

async function triggerDownload(
  downloadUrl: string,
  filename: string,
): Promise<void> {
  const safeFilename = filename || "video.mp4";

  try {
    // Try fetch + blob download (works for same-origin or CORS-enabled URLs)
    const res = await fetch(downloadUrl, { mode: "cors" });
    if (res.ok) {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = safeFilename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }, 1000);
      return;
    }
  } catch {
    // CORS blocked — fall through to direct link
  }

  // Fallback: open in new tab (browser will download or play)
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = safeFilename;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 1000);
}

// --- Components ---

const Header = ({ onGetStarted }: { onGetStarted: () => void }) => (
  <header className="sticky top-0 z-50 flex items-center justify-between border-b border-slate-200 bg-white/80 backdrop-blur-md px-6 py-4 lg:px-20">
    <div
      className="flex items-center gap-3 cursor-pointer"
      onClick={() => window.location.reload()}
    >
      <div className="size-8 text-primary flex items-center justify-center rounded-lg bg-primary/10">
        <Download className="size-5" />
      </div>
      <h2 className="text-slate-900 text-xl font-bold leading-tight tracking-tight">
        VideoSaver
      </h2>
    </div>
    <div className="hidden md:flex flex-1 justify-end gap-8 items-center">
      <nav className="flex items-center gap-8">
        <a
          href="#how-it-works"
          className="text-slate-600 hover:text-primary text-sm font-medium transition-colors"
        >
          How to Use
        </a>
        <a
          href="#features"
          className="text-slate-600 hover:text-primary text-sm font-medium transition-colors"
        >
          Features
        </a>
        <a
          href="#faq"
          className="text-slate-600 hover:text-primary text-sm font-medium transition-colors"
        >
          FAQ
        </a>
      </nav>
      <button
        onClick={onGetStarted}
        className="flex cursor-pointer items-center justify-center rounded-lg h-10 px-6 bg-primary hover:bg-secondary text-white text-sm font-bold transition-all shadow-md hover:shadow-lg"
      >
        Get Started
      </button>
    </div>
    <div className="md:hidden">
      <button className="text-slate-900">
        <Menu className="size-6" />
      </button>
    </div>
  </header>
);

const Footer = () => (
  <footer className="bg-white border-t border-slate-200 pt-16 pb-8">
    <div className="max-w-7xl mx-auto px-6 lg:px-20">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
        <div className="col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <Download className="size-5 text-primary" />
            <h3 className="font-bold text-lg text-slate-900">VideoSaver</h3>
          </div>
          <p className="text-sm text-slate-500">
            The best online tool to download videos without watermark. Fast,
            simple, and secure.
          </p>
        </div>
        <div>
          <h4 className="font-bold text-slate-900 mb-4">Product</h4>
          <ul className="space-y-2 text-sm text-slate-500">
            <li>
              <a href="#" className="hover:text-primary transition-colors">
                Features
              </a>
            </li>
            <li>
              <a href="#" className="hover:text-primary transition-colors">
                Supported Sites
              </a>
            </li>
            <li>
              <a href="#" className="hover:text-primary transition-colors">
                Pricing
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="font-bold text-slate-900 mb-4">Company</h4>
          <ul className="space-y-2 text-sm text-slate-500">
            <li>
              <a href="#" className="hover:text-primary transition-colors">
                About Us
              </a>
            </li>
            <li>
              <a href="#" className="hover:text-primary transition-colors">
                Contact
              </a>
            </li>
            <li>
              <a href="#" className="hover:text-primary transition-colors">
                Privacy Policy
              </a>
            </li>
            <li>
              <a href="#" className="hover:text-primary transition-colors">
                Terms of Service
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="font-bold text-slate-900 mb-4">Connect</h4>
          <div className="flex gap-4">
            <a
              href="#"
              className="text-slate-400 hover:text-primary transition-colors"
            >
              <Twitter className="size-5" />
            </a>
            <a
              href="#"
              className="text-slate-400 hover:text-primary transition-colors"
            >
              <Facebook className="size-5" />
            </a>
            <a
              href="#"
              className="text-slate-400 hover:text-primary transition-colors"
            >
              <Instagram className="size-5" />
            </a>
          </div>
        </div>
      </div>
      <div className="border-t border-slate-100 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-sm text-slate-400">
          © 2024 VideoSaver Inc. All rights reserved.
        </p>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500"></div>
          <span className="text-xs text-slate-500">Systems Operational</span>
        </div>
      </div>
    </div>
  </footer>
);

const FAQItem = ({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-6 text-left text-lg font-medium text-slate-900"
      >
        {question}
        <ChevronDown
          className={`size-5 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-6 pb-6 text-slate-600"
          >
            {answer}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Main Screens ---

const LandingScreen = ({
  onDownload,
  isLoading,
  loadingStatus,
  error,
}: {
  onDownload: (url: string) => void;
  isLoading: boolean;
  loadingStatus: string;
  error: string | null;
}) => {
  const [url, setUrl] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim() && !isLoading) onDownload(url);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center"
    >
      {/* Hero Section */}
      <section className="w-full max-w-7xl px-6 py-12 md:px-10 md:py-20">
        <div className="relative overflow-hidden rounded-3xl bg-slate-900 text-white shadow-2xl">
          <div
            className="absolute inset-0 z-0 opacity-20"
            style={{
              backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
          <div className="absolute inset-0 z-0 bg-gradient-to-br from-slate-900 via-primary/10 to-slate-900" />
          <div className="relative z-10 flex flex-col items-center justify-center px-6 py-16 text-center md:px-10 md:py-24">
            <h1 className="max-w-4xl text-4xl font-black leading-tight tracking-tight md:text-6xl text-white">
              Download Videos{" "}
              <span className="gradient-text">Without Watermark</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-slate-300 md:text-xl">
              Save high-quality content from your favorite social platforms
              instantly. Fast, free, and secure video downloading.
            </p>
            <form onSubmit={handleSubmit} className="mt-10 w-full max-w-2xl">
              <div className="relative flex w-full flex-col md:flex-row gap-2 md:gap-0 items-stretch rounded-2xl shadow-2xl overflow-hidden bg-white p-1">
                <div className="flex flex-1 items-center bg-transparent">
                  <div className="flex h-full items-center justify-center px-4 text-slate-400">
                    <LinkIcon className="size-5" />
                  </div>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="w-full flex-1 border-none bg-transparent px-2 py-4 text-slate-900 placeholder:text-slate-400 focus:ring-0 text-lg"
                    placeholder="Paste video URL here (TikTok, Instagram, Twitter...)..."
                    type="url"
                    required
                    disabled={isLoading}
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex items-center justify-center rounded-xl bg-primary hover:bg-secondary px-8 py-4 text-lg font-bold text-white transition-all shadow-lg disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="size-5 mr-2 animate-spin" />
                      <span className="text-sm">{loadingStatus}</span>
                    </>
                  ) : (
                    <>
                      <span className="mr-2">Download</span>
                      <Download className="size-5" />
                    </>
                  )}
                </button>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="mt-4 flex items-start justify-center gap-2 text-red-400 bg-red-400/10 py-3 px-4 rounded-lg border border-red-400/20"
                  >
                    <AlertCircle className="size-4 mt-0.5 flex-shrink-0" />
                    <span className="text-sm font-medium whitespace-pre-line text-left">
                      {error}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              <p className="mt-4 text-xs text-slate-400">
                By using our service you agree to our{" "}
                <a href="#" className="underline hover:text-white">
                  Terms of Service
                </a>
                .
              </p>
            </form>
          </div>
        </div>
      </section>

      {/* Supported Platforms */}
      <section className="w-full max-w-7xl px-6 pb-20">
        <div className="text-center mb-10">
          <p className="text-sm font-bold uppercase tracking-widest text-slate-500">
            Supported Platforms
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-8 md:gap-16 opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
          {[
            { label: "TikTok", abbr: "TT", bg: "bg-black" },
            {
              label: "Instagram",
              abbr: "IG",
              bg: "bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600",
            },
            { label: "Facebook", abbr: "FB", bg: "bg-blue-600" },
            { label: "YouTube Shorts", abbr: "YT", bg: "bg-red-600" },
            { label: "Twitter/X", abbr: "TW", bg: "bg-sky-500" },
            { label: "Xiaohongshu", abbr: "XH", bg: "bg-red-500" },
            { label: "Threads", abbr: "TH", bg: "bg-black" },
            { label: "Reddit", abbr: "RD", bg: "bg-orange-600" },
          ].map(({ label, abbr, bg }) => (
            <div
              key={label}
              className="flex items-center gap-3 group cursor-default"
            >
              <div
                className={`size-10 rounded-full ${bg} text-white flex items-center justify-center font-bold text-xs group-hover:scale-110 transition-transform`}
              >
                {abbr}
              </div>
              <span className="font-bold text-slate-700">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="w-full bg-white py-24">
        <div className="max-w-7xl mx-auto px-6 lg:px-20 flex flex-col md:flex-row gap-16 items-center">
          <div className="flex-1 space-y-8">
            <h2 className="text-4xl font-bold text-slate-900 leading-tight">
              How It Works
            </h2>
            <p className="text-lg text-slate-600">
              Getting your favorite videos offline has never been easier. Just
              follow these three simple steps.
            </p>
            <div className="space-y-6">
              {[
                {
                  icon: <Copy className="size-6" />,
                  title: "1. Copy Link",
                  desc: "Find the video you want to save on social media and copy its share link.",
                },
                {
                  icon: <LinkIcon className="size-6" />,
                  title: "2. Paste URL",
                  desc: "Go back to VideoSaver, paste the link into the input box at the top.",
                },
                {
                  icon: <Download className="size-6" />,
                  title: "3. Download",
                  desc: "Click the Download button and choose your preferred format to save.",
                },
              ].map((step, i) => (
                <div
                  key={i}
                  className="flex gap-5 p-5 rounded-2xl border border-slate-100 bg-slate-50 hover:bg-white hover:shadow-xl transition-all duration-300"
                >
                  <div className="flex-shrink-0 size-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                    {step.icon}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">
                      {step.title}
                    </h3>
                    <p className="text-slate-500 mt-1">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex-1 w-full max-w-md">
            <div className="relative aspect-[3/4] w-full bg-slate-100 rounded-[3rem] overflow-hidden shadow-2xl border-8 border-slate-200">
              <img
                src="https://picsum.photos/seed/phone-ui/800/1200"
                alt="Phone UI"
                className="absolute inset-0 w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex flex-col justify-end p-10">
                <div className="flex items-center gap-4 text-white mb-4">
                  <div className="size-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center">
                    <Play className="size-5 fill-white" />
                  </div>
                  <div className="h-2 w-32 bg-white/40 rounded-full" />
                </div>
                <div className="h-2 w-full bg-white/20 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: "70%" }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="h-full bg-primary"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="w-full max-w-7xl px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-slate-900">
            Why Use VideoSaver?
          </h2>
          <p className="mt-4 text-slate-600 max-w-2xl mx-auto text-lg">
            We offer the best tools to help you save content effortlessly while
            maintaining top quality.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              icon: <ShieldCheck className="size-8" />,
              title: "No Watermark",
              desc: "Get clean videos without any logos or usernames overlaying the content. Perfect for reposting or editing.",
              color: "blue",
            },
            {
              icon: <Video className="size-8" />,
              title: "Original Quality",
              desc: "We download the highest resolution available. Enjoy crisp HD videos just as they were uploaded.",
              color: "indigo",
            },
            {
              icon: <Zap className="size-8" />,
              title: "Free & Fast",
              desc: "No registration needed, no hidden fees, and lightning-fast download speeds for everyone.",
              color: "emerald",
            },
          ].map((feature, i) => (
            <div
              key={i}
              className="group p-10 rounded-3xl bg-white border border-slate-100 shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all duration-300"
            >
              <div
                className={`size-16 rounded-2xl bg-${feature.color}-50 text-${feature.color}-600 flex items-center justify-center mb-8 group-hover:bg-${feature.color}-600 group-hover:text-white transition-all duration-300`}
              >
                {feature.icon}
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">
                {feature.title}
              </h3>
              <p className="text-slate-600 leading-relaxed text-lg">
                {feature.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="w-full bg-slate-50 py-24">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-slate-900">
              Frequently Asked Questions
            </h2>
          </div>
          <div className="space-y-4">
            <FAQItem
              question="Is it free to use VideoSaver?"
              answer="Yes, VideoSaver is 100% free to use. We do not charge for any downloads, and there are no limits on how many videos you can save."
            />
            <FAQItem
              question="Does it work on mobile devices?"
              answer="Absolutely! Our website is fully responsive and works perfectly on iPhone, Android, tablets, and desktop computers without needing to install any app."
            />
            <FAQItem
              question="Where are videos saved?"
              answer="Videos are usually saved in the 'Downloads' folder on your device or browser default download location."
            />
            <FAQItem
              question="Tại sao video không tải được?"
              answer="Một số video có thể ở chế độ riêng tư hoặc nền tảng chặn. Hãy kiểm tra video có ở chế độ công khai không và thử lại. Nếu nút Download không hoạt động, hãy nhấn chuột phải vào video → Save As."
            />
          </div>
        </div>
      </section>
    </motion.div>
  );
};

const SuccessScreen = ({
  metadata,
  onReset,
  onDownload,
  downloadError,
}: {
  metadata: VideoMetadata;
  onReset: () => void;
  onDownload: (url: string, filename: string) => Promise<void>;
  downloadError: string | null;
}) => {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadClick = async (quality: string) => {
    const safeTitle = metadata.title
      .replace(/[^\w\s\-().]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 60);
    const filename = `${metadata.platform}_${safeTitle || "video"}_${quality}.mp4`;
    setIsDownloading(true);
    await onDownload(metadata.downloadUrl, filename);
    setIsDownloading(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center w-full max-w-5xl px-6 py-12 mx-auto"
    >
      <div className="flex flex-col gap-4 items-center text-center mb-12">
        <div className="inline-flex items-center justify-center size-20 rounded-full bg-green-100 text-green-600 mb-2">
          <CheckCircle2 className="size-10" />
        </div>
        <h1 className="text-4xl font-black text-slate-900 tracking-tight">
          Video Processed Successfully
        </h1>
        <p className="text-slate-500 text-xl max-w-lg">
          Your video is ready for download. Select your preferred format below
          to save it without watermarks.
        </p>
      </div>

      <div className="w-full flex flex-col lg:flex-row overflow-hidden rounded-3xl shadow-2xl border border-slate-200 bg-white">
        {/* Thumbnail */}
        <div className="relative lg:w-5/12 min-h-[400px] bg-slate-100 group">
          <img
            src={metadata.thumbnail}
            alt="Video Thumbnail"
            className="absolute inset-0 w-full h-full object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                `https://picsum.photos/seed/${metadata.platform}/800/800`;
            }}
          />
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center group-hover:bg-black/30 transition-all">
            <div className="size-20 bg-white/90 rounded-full flex items-center justify-center shadow-xl backdrop-blur-sm">
              <Play className="size-10 text-primary ml-1 fill-primary" />
            </div>
          </div>
          <div className="absolute bottom-6 left-6 right-6 flex justify-between items-end">
            <span className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-lg text-white text-sm font-bold">
              {metadata.duration}
            </span>
            <span className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-lg text-white text-sm font-bold flex items-center gap-2">
              <Monitor className="size-4" /> {metadata.quality}
            </span>
          </div>
        </div>

        {/* Details */}
        <div className="flex-1 p-10 flex flex-col justify-center">
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-800 uppercase tracking-wider">
                {metadata.platform}
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-500 text-sm font-medium">
                {metadata.size}
              </span>
            </div>
            <h3 className="text-3xl font-bold text-slate-900 mb-3 leading-tight line-clamp-2">
              {metadata.title}
            </h3>
            <p className="text-slate-500 flex items-center gap-2 text-sm">
              <RefreshCw className="size-4 animate-spin-slow" /> Processed in
              1.2s
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {downloadError && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                <AlertCircle className="size-5 flex-shrink-0 mt-0.5" />
                <div>
                  <span>{downloadError}</span>
                  <p className="mt-2 text-xs">
                    💡 Thử nhấn chuột phải vào nút Download và chọn "Save link
                    as..." hoặc mở video trong tab mới.
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={() => handleDownloadClick("HD")}
              disabled={isDownloading}
              className="group flex w-full items-center justify-between rounded-2xl bg-primary hover:bg-secondary text-white px-8 py-5 shadow-lg transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-white/20 rounded-xl">
                  <Download className="size-6" />
                </div>
                <div className="text-left">
                  <span className="block text-lg font-bold">
                    Download HD (No Watermark)
                  </span>
                  <span className="text-sm text-blue-100 opacity-80">
                    MP4 • Best Quality
                  </span>
                </div>
              </div>
              {isDownloading && <Loader2 className="size-5 animate-spin" />}
            </button>

            {/* Direct link fallback */}
            <a
              href={metadata.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="group flex w-full items-center justify-between rounded-2xl bg-secondary hover:bg-indigo-700 text-white px-8 py-5 shadow-lg transition-all active:scale-[0.98]"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-white/20 rounded-xl">
                  <Zap className="size-6" />
                </div>
                <div className="text-left">
                  <span className="block text-lg font-bold">
                    Open Direct Link
                  </span>
                  <span className="text-sm text-indigo-100 opacity-80">
                    Mở trực tiếp → chuột phải → Save As
                  </span>
                </div>
              </div>
            </a>

            <button
              onClick={onReset}
              disabled={isDownloading}
              className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-slate-200 bg-transparent px-8 py-4 text-slate-600 hover:bg-slate-50 transition-all font-bold text-base disabled:opacity-70"
            >
              <RefreshCw className="size-5" />
              <span>Download Another Video</span>
            </button>
          </div>
        </div>
      </div>

      <div className="w-full mt-12 bg-slate-100 rounded-2xl p-10 flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-300 min-h-[160px]">
        <p className="text-slate-400 font-bold text-lg">Advertisement Space</p>
        <p className="text-slate-300 text-sm mt-1">
          Support us by viewing this space
        </p>
      </div>
    </motion.div>
  );
};

// --- Main App ---

export default function App() {
  const [screen, setScreen] = useState<"landing" | "success">("landing");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("Đang phân tích link...");
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);

  const platformMessages: Record<string, string> = {
    TikTok: "Đang trích xuất video TikTok (No Watermark)...",
    Douyin: "Đang trích xuất video Douyin...",
    YouTube: "Đang phân tích video YouTube...",
    Instagram: "Đang lấy video Instagram...",
    Facebook: "Đang lấy video Facebook...",
    "Twitter/X": "Đang trích xuất video Twitter/X...",
    Threads: "Đang trích xuất video Threads...",
    Reddit: "Đang lấy video Reddit...",
    Xiaohongshu: "Đang phân tích video Xiaohongshu...",
  };

  const handleDownload = async (url: string) => {
    setIsLoading(true);
    setError(null);

    const platform = detectPlatform(url);
    setLoadingStatus(platformMessages[platform] || "Đang phân tích link...");

    try {
      const result = await fetchVideoMetadataClient(url);
      setMetadata(result);
      setScreen("success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      setError(
        err.message || "An unexpected error occurred. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleTriggerDownload = async (
    downloadUrl: string,
    filename: string,
  ) => {
    try {
      await triggerDownload(downloadUrl, filename);
    } catch (err: any) {
      setError(
        `Lỗi khi tải xuống: ${err.message}. Hãy thử nút "Open Direct Link" để mở video trực tiếp.`,
      );
    }
  };

  const handleReset = () => {
    setScreen("landing");
    setMetadata(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header onGetStarted={handleReset} />
      <main className="flex-1">
        {screen === "landing" ? (
          <LandingScreen
            onDownload={handleDownload}
            isLoading={isLoading}
            loadingStatus={loadingStatus}
            error={error}
          />
        ) : (
          metadata && (
            <SuccessScreen
              metadata={metadata}
              onReset={handleReset}
              onDownload={handleTriggerDownload}
              downloadError={error}
            />
          )
        )}
      </main>
      <Footer />
    </div>
  );
}
