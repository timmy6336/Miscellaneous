import AsyncStorage from '@react-native-async-storage/async-storage';
import { addDays } from './dates';
import { DEFAULT_SETTINGS, Item, Routine, Settings } from './types';

const ITEMS_KEY = 'quick-scheduler/items/v1';
const SETTINGS_KEY = 'quick-scheduler/settings/v1';
const ROUTINES_KEY = 'quick-scheduler/routines/v1';

export async function loadItems(today: string): Promise<Item[]> {
  try {
    const raw = await AsyncStorage.getItem(ITEMS_KEY);
    const items: Item[] = raw ? JSON.parse(raw) : [];
    // Keep finished items (and past repeats) for a month so history doesn't grow forever.
    const cutoff = addDays(today, -30);
    return items.filter((i) => !((i.done || i.routineId) && i.date < cutoff));
  } catch {
    return [];
  }
}

export function saveItems(items: Item[]): Promise<void> {
  return AsyncStorage.setItem(ITEMS_KEY, JSON.stringify(items)).catch(() => {});
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): Promise<void> {
  return AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s)).catch(() => {});
}

export async function loadRoutines(): Promise<Routine[]> {
  try {
    const raw = await AsyncStorage.getItem(ROUTINES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRoutines(r: Routine[]): Promise<void> {
  return AsyncStorage.setItem(ROUTINES_KEY, JSON.stringify(r)).catch(() => {});
}
