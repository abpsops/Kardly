// Kardly native bridge for Android (bundled into www/native.js with esbuild).
// Exposes window.KardlyNative, which the shared page (src/kardly.html) uses when present.
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { Camera } from "@capacitor/camera";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { AppLauncher } from "@capacitor/app-launcher";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Preferences } from "@capacitor/preferences";
import { App } from "@capacitor/app";
import Anthropic from "@anthropic-ai/sdk";
import { DocumentScanner } from "@capacitor-mlkit/document-scanner";
import { TextRecognition, Script } from "@capacitor-mlkit/text-recognition";
import { parseCard } from "./parse.js";

const KEY_PREF = "anthropic_api_key";
const CLAUDE_MODEL = "claude-opus-5-5";

function readerMode() {
  try { return (JSON.parse(localStorage.getItem("kardly.prefs") || "{}").reader) || "device"; } catch { return "device"; }
}
const isCancel = e => /cancel/i.test(String((e && (e.message || e.code)) || e));

/* ---------- camera ---------- */
async function pickPhoto(source) {
  let r;
  try {
    if (source === "camera") {
      r = await Camera.takePhoto({ quality: 92, correctOrientation: true, saveToGallery: false, editable: "no" });
    } else {
      const rs = await Camera.chooseFromGallery({ allowMultipleSelection: false });
      r = rs && rs.results && rs.results[0];
    }
  } catch (e) {
    if (isCancel(e)) throw { cancelled: true };
    throw new Error(source === "camera" ? "Couldn't open the camera. Allow camera access for Kardly in Android settings." : "Couldn't open your gallery.");
  }
  if (!r) throw { cancelled: true };
  const src = r.webPath || (r.uri ? Capacitor.convertFileSrc(r.uri) : null);
  if (!src) throw new Error("The photo couldn't be read.");
  const resp = await fetch(src);
  return await resp.blob();
}

/* ---------- Google ML Kit document scanner: live edge detection, auto-capture, perspective crop ---------- */
async function scanCard({ pages = 2 } = {}) {
  let available = false;
  try { ({ available } = await DocumentScanner.isGoogleDocumentScannerModuleAvailable()); }
  catch { return { unavailable: true }; }
  if (!available) {
    DocumentScanner.installGoogleDocumentScannerModule().catch(() => {});
    return { unavailable: true, installing: true };
  }
  let res;
  try {
    res = await DocumentScanner.scanDocument({ galleryImportAllowed: true, pageLimit: pages, resultFormats: "JPEG", scannerMode: "FULL" });
  } catch (e) {
    if (isCancel(e)) return { cancelled: true };
    return { unavailable: true, error: String((e && e.message) || e) };
  }
  const uris = (res && res.scannedImages) || [];
  if (!uris.length) return { cancelled: true };
  const blobs = [];
  for (const u of uris) { const r = await fetch(Capacitor.convertFileSrc(u)); blobs.push(await r.blob()); }
  return { blobs };
}

/* ---------- files: write to cache, then open the Android share sheet ---------- */
function blobToBase64(blob) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
}
async function saveFile(filename, data, mime) {
  const path = "exports/" + filename.replace(/[^\w.\-]+/g, "_");
  const opts = { path, directory: Directory.Cache, recursive: true };
  if (typeof data === "string") Object.assign(opts, { data, encoding: Encoding.UTF8 });
  else Object.assign(opts, { data: await blobToBase64(data instanceof Blob ? data : new Blob([data], { type: mime })) });
  const { uri } = await Filesystem.writeFile(opts);
  try { await Share.share({ title: filename, files: [uri], dialogTitle: "Save or send " + filename }); }
  catch (e) { if (isCancel(e)) throw { cancelled: true }; throw e; }
}

/* ---------- links: hand tel:, mailto:, https: and WhatsApp to the right app ---------- */
async function openUrl(url) {
  try { await AppLauncher.openUrl({ url }); } catch (e) { console.warn("openUrl", e); }
}

function haptic(kind) {
  if (kind === "success") return Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  return Haptics.impact({ style: kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {});
}

/* ---------- settings ---------- */
async function getKey() { const { value } = await Preferences.get({ key: KEY_PREF }); return value || ""; }
async function setKey(v) { if (v) await Preferences.set({ key: KEY_PREF, value: v }); else await Preferences.remove({ key: KEY_PREF }); }
function setDark(dark) { SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {}); }

/* ---------- Android back button closes the open sheet first ---------- */
let backCb = null;
App.addListener("backButton", () => { if (backCb && backCb()) return; App.minimizeApp().catch(() => App.exitApp()); });

/* ---------- reading the card ---------- */
function extractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}
async function readWithClaude(blobs, prompt, signal) {
  const apiKey = await getKey();
  if (!apiKey) throw { code: "nokey", userMessage: "Add your Anthropic API key in Settings to read cards with Claude." };
  // The key belongs to the phone's owner and is sent only to Anthropic.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const content = [];
  for (const b of blobs) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobToBase64(b) } });
  content.push({ type: "text", text: prompt });
  let resp;
  try {
    resp = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content }],
    }, { signal });
  } catch (e) {
    if (e && e.name === "AbortError") throw { code: "cancelled" };
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw { code: "auth", userMessage: "Your Anthropic API key was rejected. Check it in Settings." };
    if (e instanceof Anthropic.RateLimitError) throw { code: "rate_limited", userMessage: "Too many cards read in a short time. Wait a minute, then try again." };
    if (e instanceof Anthropic.APIConnectionError) throw { code: "offline" };
    if (e instanceof Anthropic.APIError) throw { code: "api", userMessage: `Claude couldn't read the card (error ${e.status}). Try again, or switch to on-phone reading in Settings.` };
    throw e;
  }
  if (resp.stop_reason === "refusal") throw { code: "refused", userMessage: "Claude declined to read this image. Type the details instead." };
  const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("");
  const out = extractJSON(text);
  if (!out) throw { code: "invalid_json", userMessage: "Claude's answer couldn't be read. Try again." };
  out._via = "with Claude";
  return out;
}

let workerP = null;
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src)); document.head.append(s); }); }
function getWorker(onStatus) {
  if (!workerP) {
    workerP = (async () => {
      await loadScript("vendor/tesseract/tesseract.min.js");
      const base = new URL("vendor/tesseract/", location.href).href;
      const w = await window.Tesseract.createWorker("eng", 1, {
        workerPath: base + "worker.min.js",
        corePath: base + "core",
        langPath: base + "lang",
        gzip: false,
        cacheMethod: "none",
        workerBlobURL: false,
        logger: m => { if (onStatus && m && m.status === "recognizing text") onStatus(`Reading the card… ${Math.round((m.progress || 0) * 100)}%`); }
      });
      return w;
    })().catch(e => { workerP = null; throw e; });
  }
  return workerP;
}
// Google ML Kit text recognition (on-device, fast, accurate on photos). Lines keep their size and position.
async function ocrMLKit(blobs) {
  const lines = [];
  for (let i = 0; i < blobs.length; i++) {
    const { uri } = await Filesystem.writeFile({ path: `ocr/side${i}-${Date.now()}.jpg`, data: await blobToBase64(blobs[i]), directory: Directory.Cache, recursive: true });
    const r = await TextRecognition.processImage({ path: uri, script: Script.Latin });
    (r.blocks || []).forEach((b, bi) => (b.lines || []).forEach(ln => {
      const bb = ln.boundingBox || {};
      lines.push({ text: ln.text || "", h: (bb.bottom - bb.top) || 0, y: bb.top || 0, x: bb.left || 0, block: i * 1000 + bi, side: i, conf: 100 });
    }));
  }
  return lines;
}
async function readOnDevice(blobs, onStatus) {
  try {
    if (onStatus) onStatus("Reading the card…");
    const lines = await ocrMLKit(blobs);
    if (lines.length) { const out = parseCard(lines, { region: deviceRegion() }); out._via = "on this phone"; return out; }
  } catch (e) { console.warn("ML Kit text recognition unavailable, using Tesseract", e); }
  return readWithTesseract(blobs, onStatus);
}
function deviceRegion() {
  try { const r = new Intl.Locale(navigator.language).maximize().region; return r || "AE"; } catch { return "AE"; }
}
async function readWithTesseract(blobs, onStatus) {
  if (onStatus) onStatus("Preparing on-phone reading…");
  const w = await getWorker(onStatus);
  const lines = [];
  for (const b of blobs) {
    const { data } = await w.recognize(b, {}, { blocks: true, text: true });
    for (const bl of data.blocks || []) for (const p of bl.paragraphs || []) for (const ln of p.lines || []) {
      lines.push({ text: ln.text || "", h: ln.bbox ? ln.bbox.y1 - ln.bbox.y0 : 0, conf: ln.confidence || 0 });
    }
  }
  const out = parseCard(lines, { region: deviceRegion() });
  out._via = "on this phone";
  return out;
}
async function readCard(blobs, { signal, prompt, onStatus } = {}) {
  if (readerMode() === "claude") {
    try { return await readWithClaude(blobs, prompt, signal); }
    catch (e) {
      if (e && e.code === "offline") { if (onStatus) onStatus("No connection. Reading on this phone instead…"); const out = await readOnDevice(blobs, onStatus); out._via = "on this phone (offline)"; return out; }
      throw e;
    }
  }
  return readOnDevice(blobs, onStatus);
}

window.KardlyNative = {
  isNative: Capacitor.isNativePlatform(),
  cvUrl: "vendor/opencv.js",
  pickPhoto, scanCard, saveFile, openUrl, haptic, getKey, setKey, setDark, readCard,
  onBack(cb) { backCb = cb; },
  appInfo() { return App.getInfo(); },
  ready() {}
};
