// Downloading, loading and running the on-device model (llama.cpp via llama.rn).

import * as FS from 'expo-file-system/legacy';
import * as Network from 'expo-network';
import { initLlama, LlamaContext } from 'llama.rn';
import { Item } from '../types';
import { ANSWER_SCHEMA, buildUserMessage, parseAnswer, SYSTEM_PROMPT } from './prompt';

export const MODEL = {
  name: 'Llama 3.2 1B Instruct (Q4_K_M)',
  file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
  url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
  /** Approximate, for the UI and the free-space check. */
  bytes: 808 * 1024 * 1024,
};

const dir = `${FS.documentDirectory}models/`;
const modelPath = dir + MODEL.file;
const partialPath = modelPath + '.part';

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

export async function loadModel(): Promise<void> {
  if (context || status.state === 'loading') return;
  if (!(await isDownloaded())) {
    setStatus({ state: 'missing' });
    return;
  }
  setStatus({ state: 'loading' });
  try {
    context = await initLlama({ model: modelPath, n_ctx: 2048, n_gpu_layers: 0, use_mlock: false });
    setStatus({ state: 'ready' });
    // Warm up: process the fixed system prompt once so later notes are faster.
    context
      .completion({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'Note: hi' },
        ],
        n_predict: 1,
      })
      .catch(() => {});
  } catch (e) {
    context = null;
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
export async function understand(note: string, items: Item[], now: Date, viewDate: string, timeoutMs = 20000): Promise<unknown> {
  if (!context) return null;
  const ctx = context;
  const run = ctx.completion({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(note, items, now, viewDate) },
    ],
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
