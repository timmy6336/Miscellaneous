// Downloading, loading and running the on-device model (llama.cpp via llama.rn).

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import * as Network from 'expo-network';
import { initLlama, LlamaContext } from 'llama.rn';
import { Item } from '../types';
import { ANSWER_SCHEMA, buildMessages, parseAnswer } from './prompt';

// Qwen2.5 1.5B scored best of the ~1B models in scripts/ai-eval.mts
// (Llama 3.2 1B and Gemma 3 1B were far behind).
export const MODEL = {
  name: 'Qwen2.5 1.5B Instruct (Q4_K_M)',
  file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  /** For the UI and the free-space check. */
  bytes: 1_092_088_838,
};

const dir = `${FS.documentDirectory}models/`;
const modelPath = dir + MODEL.file;
const partialPath = modelPath + '.part';
/** Set while loading; if it's still set on the next launch, loading crashed the app. */
const LOADING_FLAG = 'quick-scheduler/ai-loading';

export type AiStatus =
  | { state: 'missing' }
  | { state: 'downloading'; progress: number }
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; message: string };

type Listener = (s: AiStatus) => void;

let status: AiStatus = { state: 'missing' };
let context: LlamaContext | null = null;
let download: FS.DownloadResumable | null = null;
const listeners = new Set<Listener>();

function setStatus(s: AiStatus) {
  status = s;
  listeners.forEach((l) => l(s));
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  l(status);
  return () => listeners.delete(l);
}

export const getStatus = () => status;

export async function isDownloaded(): Promise<boolean> {
  const info = await FS.getInfoAsync(modelPath);
  return info.exists && (info.size ?? 0) > MODEL.bytes * 0.9;
}

export async function onWifi(): Promise<boolean> {
  try {
    const n = await Network.getNetworkStateAsync();
    return n.type === Network.NetworkStateType.WIFI || n.type === Network.NetworkStateType.ETHERNET;
  } catch {
    return false;
  }
}

/** Downloads the model to a temporary file, moves it into place, then loads it. */
export async function downloadModel(): Promise<void> {
  if (status.state === 'downloading' || status.state === 'loading' || status.state === 'ready') return;
  if (await isDownloaded()) return loadModel();
  try {
    const free = await FS.getFreeDiskStorageAsync();
    if (free < MODEL.bytes + 300 * 1024 * 1024) {
      setStatus({ state: 'error', message: `Not enough free space (needs about ${Math.ceil(MODEL.bytes / 1e9 * 10) / 10 + 0.3} GB).` });
      return;
    }
    await FS.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    setStatus({ state: 'downloading', progress: 0 });
    download = FS.createDownloadResumable(MODEL.url, partialPath, {}, (p) => {
      const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : MODEL.bytes;
      setStatus({ state: 'downloading', progress: Math.min(1, p.totalBytesWritten / total) });
    });
    const result = await download.downloadAsync();
    download = null;
    if (!result || result.status < 200 || result.status >= 300) throw new Error(`Download failed (HTTP ${result?.status ?? '?'})`);
    await FS.moveAsync({ from: partialPath, to: modelPath });
    await loadModel();
  } catch (e) {
    download = null;
    await FS.deleteAsync(partialPath, { idempotent: true }).catch(() => {});
    setStatus({ state: 'error', message: `Download failed: ${e instanceof Error ? e.message : String(e)}` });
  }
}

export async function cancelDownload(): Promise<void> {
  await download?.pauseAsync().catch(() => {});
  download = null;
  await FS.deleteAsync(partialPath, { idempotent: true }).catch(() => {});
  setStatus({ state: 'missing' });
}

/**
 * Loads the downloaded model. With `automatic`, it won't try again if the last
 * attempt crashed the app (e.g. the phone ran out of memory).
 */
export async function loadModel(automatic = false): Promise<void> {
  if (context || status.state === 'loading') return;
  if (!(await isDownloaded())) {
    setStatus({ state: 'missing' });
    return;
  }
  if (automatic && (await AsyncStorage.getItem(LOADING_FLAG))) {
    setStatus({ state: 'error', message: 'The model closed the app last time it loaded (the phone may be low on memory).' });
    return;
  }
  setStatus({ state: 'loading' });
  await AsyncStorage.setItem(LOADING_FLAG, '1').catch(() => {});
  try {
    context = await initLlama({ model: modelPath, n_ctx: 4096, n_gpu_layers: 0, use_mlock: false });
    await AsyncStorage.removeItem(LOADING_FLAG).catch(() => {});
    setStatus({ state: 'ready' });
    // Warm up: process the fixed instructions and examples once, so they're
    // cached and later notes only need the last few tokens processed.
    context.completion({ messages: buildMessages('hi', [], new Date()), n_predict: 1 }).catch(() => {});
  } catch (e) {
    context = null;
    await AsyncStorage.removeItem(LOADING_FLAG).catch(() => {});
    setStatus({ state: 'error', message: `Couldn't load the model: ${e instanceof Error ? e.message : String(e)}` });
  }
}

export async function deleteModel(): Promise<void> {
  await context?.release().catch(() => {});
  context = null;
  await FS.deleteAsync(modelPath, { idempotent: true }).catch(() => {});
  setStatus({ state: 'missing' });
}

/** Asks the model to read a note. Returns the raw parsed JSON, or null. */
export async function understand(note: string, items: Item[], now: Date, timeoutMs = 20000): Promise<unknown> {
  if (!context) return null;
  const ctx = context;
  const run = ctx.completion({
    messages: buildMessages(note, items, now),
    response_format: { type: 'json_schema', json_schema: { strict: true, schema: ANSWER_SCHEMA } },
    temperature: 0,
    n_predict: 200,
  });
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => {
      ctx.stopCompletion().catch(() => {});
      resolve(null);
    }, timeoutMs),
  );
  const result = await Promise.race([run, timeout]);
  return result ? parseAnswer(result.text) : null;
}
