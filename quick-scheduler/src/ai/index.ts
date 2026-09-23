// Loads the on-device model module lazily, so the app still runs where the
// native llama.rn module isn't available (e.g. the web preview).
import { Platform } from 'react-native';

type ModelModule = typeof import('./model');
let mod: ModelModule | null | undefined;

export function ai(): ModelModule | null {
  if (mod === undefined) {
    try {
      mod = Platform.OS === 'web' ? null : (require('./model') as ModelModule);
    } catch {
      mod = null;
    }
  }
  return mod;
}

export type { AiStatus } from './model';
