import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as calendar from './src/calendar';
import { ItemSheet, SettingsSheet } from './src/components/Sheets';
import { Timeline } from './src/components/Timeline';
import { addDays, dateKey, dayLabel, longDate, minutesOf } from './src/dates';
import { parseCommand } from './src/parser';
import {
  applyCommand,
  bringToToday,
  Ctx,
  datesOfInterest,
  leftovers,
  moveItem,
  pushLater,
  removeItem,
  Result,
  setDone,
} from './src/scheduler';
import { loadItems, loadSettings, saveItems, saveSettings } from './src/storage';
import { useTheme } from './src/theme';
import { BusyEvent, DEFAULT_SETTINGS, Item, Settings } from './src/types';

type Toast = { message: string; tone: Result['tone']; undo: Item[] | null };
type CalStatus = 'unknown' | 'granted' | 'denied' | 'blocked';

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const t = useTheme();
  const [ready, setReady] = useState(false);
  const [items, setItemsState] = useState<Item[]>([]);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [now, setNow] = useState(() => new Date());
  const today = dateKey(now);
  const [viewDate, setViewDate] = useState(today);
  const [busy, setBusy] = useState<Record<string, BusyEvent[]>>({});
  const [calStatus, setCalStatus] = useState<CalStatus>('unknown');
  const [calendars, setCalendars] = useState<calendar.CalendarChoice[]>([]);
  const [text, setText] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Refs mirror state for async work (calendar sync) that outlives a render.
  const itemsRef = useRef(items);
  const settingsRef = useRef(settings);
  const syncedRef = useRef<Item[]>([]); // what the phone calendar currently reflects
  const syncQueue = useRef(Promise.resolve());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  const setItems = useCallback((next: Item[]) => {
    itemsRef.current = next;
    setItemsState(next);
    saveItems(next);
  }, []);

  /** Pushes the current items to the phone calendar, one sync at a time. */
  const syncToCalendar = useCallback(() => {
    syncQueue.current = syncQueue.current.then(async () => {
      const s = settingsRef.current;
      if (!s.calendarSync || !s.calendarId) {
        syncedRef.current = itemsRef.current;
        return;
      }
      try {
        const current = itemsRef.current;
        const ids = await calendar.syncCalendar(syncedRef.current, current, s);
        const withIds = (list: Item[]) => list.map((i) => (ids.has(i.id) ? { ...i, eventId: ids.get(i.id) } : i));
        syncedRef.current = withIds(current);
        if (ids.size) setItems(withIds(itemsRef.current));
      } catch (e) {
        console.warn('Calendar sync failed', e);
      }
    });
  }, [setItems]);

  const refreshBusy = useCallback(async (dates: string[]) => {
    if (!settingsRef.current.calendarSync || !(await calendar.hasPermission().catch(() => false))) return;
    try {
      const own = new Set(itemsRef.current.map((i) => i.eventId).filter((x): x is string => !!x));
      const loaded = await calendar.loadBusy(dates, own);
      setBusy((b) => ({ ...b, ...loaded }));
      return loaded;
    } catch (e) {
      console.warn('Could not read calendar', e);
    }
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettingsState(next);
      saveSettings(next);
      if ('calendarId' in patch || 'calendarSync' in patch) syncToCalendar();
    },
    [syncToCalendar],
  );

  /** Asks for calendar access and picks a calendar the first time. */
  const connectCalendar = useCallback(async () => {
    try {
      const status = await calendar.requestPermission();
      setCalStatus(status);
      if (status === 'blocked') {
        Linking.openSettings();
        return;
      }
      if (status !== 'granted') return;
      setCalendars(await calendar.writableCalendars());
      if (!settingsRef.current.calendarId) updateSettings({ calendarId: await calendar.pickDefaultCalendar() });
      syncToCalendar();
    } catch (e) {
      console.warn('Calendar setup failed', e);
    }
  }, [syncToCalendar, updateSettings]);

  // Load saved data, then hook up the calendar.
  useEffect(() => {
    (async () => {
      const [loadedItems, loadedSettings] = await Promise.all([loadItems(dateKey(new Date())), loadSettings()]);
      itemsRef.current = loadedItems;
      syncedRef.current = loadedItems;
      settingsRef.current = loadedSettings;
      setItemsState(loadedItems);
      setSettingsState(loadedSettings);
      setReady(true);
      if (loadedSettings.calendarSync) await connectCalendar();
    })();
  }, [connectCalendar]);

  // Keep the clock fresh: every 30s and whenever the app comes back to the foreground.
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      const d = new Date();
      setNow(d);
      calendar
        .hasPermission()
        .then((ok) => ok && setCalStatus('granted'))
        .catch(() => {});
    });
    return () => {
      clearInterval(tick);
      sub.remove();
    };
  }, []);

  // When the day rolls over while the app is open, follow it.
  const lastToday = useRef(today);
  useEffect(() => {
    if (lastToday.current !== today) {
      if (viewDate === lastToday.current) setViewDate(today);
      lastToday.current = today;
    }
  }, [today, viewDate]);

  const ctx = useCallback(
    (b: Record<string, BusyEvent[]> = busy): Ctx => ({ now: new Date(), settings: settingsRef.current, busy: b, viewDate }),
    [busy, viewDate],
  );

  // Reload calendar events whenever the relevant days change.
  const interestKey = datesOfInterest(items, { now, settings, busy: {}, viewDate }).join(',');
  useEffect(() => {
    if (ready && calStatus === 'granted') refreshBusy(interestKey.split(','));
  }, [ready, calStatus, interestKey, refreshBusy]);

  const showToast = useCallback((toastValue: Toast) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(toastValue);
    toastTimer.current = setTimeout(() => setToast(null), 7000);
  }, []);

  const commit = useCallback(
    (result: Result, before: Item[]) => {
      if (result.message) showToast({ message: result.message, tone: result.tone, undo: result.items === before ? null : before });
      if (result.items === before) return;
      setItems(result.items);
      syncToCalendar();
    },
    [setItems, showToast, syncToCalendar],
  );

  const submit = useCallback(async () => {
    const input = text.trim();
    if (!input) return;
    const cmd = parseCommand(input, new Date(), viewDate);
    if (cmd.kind === 'none') {
      showToast({ message: 'Add a few words about what you want to do.', tone: 'error', undo: null });
      return;
    }
    // Make sure we know what's already in the calendar on the target day.
    let b = busy;
    const target = 'date' in cmd ? cmd.date : null;
    if (target && !(target in b) && calStatus === 'granted') {
      const loaded = await refreshBusy([target]);
      if (loaded) b = { ...b, ...loaded };
    }
    const before = itemsRef.current;
    commit(applyCommand(cmd, before, ctx(b)), before);
    setText('');
  }, [text, viewDate, busy, calStatus, refreshBusy, commit, ctx, showToast]);

  const undo = useCallback(() => {
    if (!toast?.undo) return;
    // Items whose calendar event is already gone will get a fresh one on sync.
    const live = new Set(itemsRef.current.map((i) => i.eventId).filter(Boolean));
    setItems(toast.undo.map((i) => (i.eventId && !live.has(i.eventId) ? { ...i, eventId: null } : i)));
    syncToCalendar();
    showToast({ message: 'Undone.', tone: 'ok', undo: null });
  }, [toast, setItems, syncToCalendar, showToast]);

  const act = (fn: (items: Item[], c: Ctx) => Result) => {
    const before = itemsRef.current;
    commit(fn(before, ctx()), before);
    setSelected(null);
  };

  const preview = useMemo(() => {
    if (!text.trim()) return null;
    const cmd = parseCommand(text, now, viewDate);
    if (cmd.kind === 'none') return null;
    return applyCommand(cmd, items, { now, settings, busy, viewDate }).preview ?? null;
  }, [text, now, viewDate, items, settings, busy]);

  const dayItems = items.filter((i) => i.date === viewDate);
  const oldOnes = viewDate === today ? leftovers(items, ctx()) : [];
  const nowMin = viewDate === today ? minutesOf(now) : null;
  const pending = dayItems.filter((i) => !i.done).length;

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: t.bg }]} edges={['top', 'left', 'right']}>
      <StatusBar style="auto" />

      {/* Header: day switcher + settings */}
      <View style={styles.header}>
        <Pressable onPress={() => setViewDate(addDays(viewDate, -1))} hitSlop={10} accessibilityLabel="Previous day">
          <Ionicons name="chevron-back" size={24} color={t.muted} />
        </Pressable>
        <Pressable style={styles.headerTitle} onPress={() => setViewDate(today)} accessibilityLabel="Go to today">
          <Text style={[styles.h1, { color: t.text }]}>{dayLabel(viewDate, today)}</Text>
          <Text style={[styles.h2, { color: t.muted }]}>
            {longDate(viewDate)}
            {pending ? ` · ${pending} to do` : ''}
          </Text>
        </Pressable>
        <Pressable onPress={() => setViewDate(addDays(viewDate, 1))} hitSlop={10} accessibilityLabel="Next day">
          <Ionicons name="chevron-forward" size={24} color={t.muted} />
        </Pressable>
        <Pressable onPress={() => setShowSettings(true)} hitSlop={10} style={{ marginLeft: 12 }} accessibilityLabel="Settings">
          <Ionicons name="settings-outline" size={22} color={t.muted} />
        </Pressable>
      </View>

      {/* The text box */}
      <View style={styles.inputWrap}>
        <View style={[styles.inputBox, { backgroundColor: t.card, borderColor: t.border }]}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            placeholder="What do you want to do?"
            placeholderTextColor={t.faint}
            style={[styles.input, { color: t.text }]}
            returnKeyType="send"
            submitBehavior="submit"
            autoFocus
            autoCapitalize="sentences"
            accessibilityLabel="What do you want to do?"
          />
          <Pressable
            onPress={submit}
            disabled={!text.trim()}
            style={[styles.send, { backgroundColor: text.trim() ? t.accent : t.border }]}
            accessibilityLabel="Add"
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        </View>
        {preview ? (
          <Text style={[styles.preview, { color: t.muted }]} numberOfLines={2}>
            ↳ {preview}
          </Text>
        ) : toast ? (
          <View style={[styles.toast, { backgroundColor: toast.tone === 'warn' ? t.warnBg : t.card, borderColor: t.border }]}>
            <Text style={[styles.toastText, { color: toast.tone === 'error' ? t.error : toast.tone === 'warn' ? t.warn : t.text }]}>
              {toast.message}
            </Text>
            {toast.undo && (
              <Pressable onPress={undo} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.undo, { color: t.accent }]}>Undo</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {settings.calendarSync && calStatus !== 'granted' && calStatus !== 'unknown' && (
          <Banner
            t={t}
            icon="calendar-outline"
            text="Connect your calendar to get reminders and to plan around your events."
            action={calStatus === 'blocked' ? 'Open settings' : 'Connect'}
            onPress={connectCalendar}
          />
        )}
        {oldOnes.length > 0 && (
          <Banner
            t={t}
            icon="time-outline"
            text={`${oldOnes.length} unfinished from earlier ${oldOnes.length === 1 ? 'day' : 'days'}.`}
            action="Bring to today"
            onPress={() => act((it, c) => bringToToday(it, c))}
          />
        )}

        {dayItems.length === 0 && !(busy[viewDate]?.length) ? (
          <View style={styles.empty}>
            <Ionicons name="sparkles-outline" size={28} color={t.faint} />
            <Text style={[styles.emptyTitle, { color: t.text }]}>Nothing planned {viewDate === today ? 'yet' : 'for this day'}</Text>
            <Text style={[styles.emptyText, { color: t.muted }]}>
              Type anything above — “groceries”, “call mom at 5”, “gym tomorrow evening”. No time? It goes in the next free slot.
            </Text>
          </View>
        ) : (
          <Timeline
            theme={t}
            items={dayItems}
            busy={busy[viewDate] ?? []}
            nowMin={nowMin}
            isPast={viewDate < today}
            onPress={setSelected}
            onToggle={(i) => act((it, c) => setDone(it, i.id, !i.done, c))}
          />
        )}
      </ScrollView>

      <ItemSheet
        t={t}
        item={selected}
        today={today}
        onClose={() => setSelected(null)}
        onToggle={(i) => act((it, c) => setDone(it, i.id, !i.done, c))}
        onLater={(i) => act((it, c) => pushLater(it, i.id, c))}
        onToday={(i) => act((it, c) => moveItem(it, i.id, { date: today, start: null, fixed: false, earliest: null }, c))}
        onTomorrow={(i) =>
          act((it, c) =>
            moveItem(it, i.id, i.fixed ? { date: addDays(today, 1) } : { date: addDays(today, 1), start: null, earliest: null }, c),
          )
        }
        onDelete={(i) => act((it, c) => removeItem(it, i.id, c))}
      />
      <SettingsSheet
        t={t}
        visible={showSettings}
        settings={settings}
        calendarStatus={calStatus}
        calendars={calendars}
        onClose={() => setShowSettings(false)}
        onChange={updateSettings}
        onConnect={connectCalendar}
        onCreateOwnCalendar={async () => {
          try {
            const id = await calendar.createOwnCalendar();
            setCalendars(await calendar.writableCalendars());
            updateSettings({ calendarId: id });
          } catch (e) {
            showToast({ message: `Couldn't create the calendar: ${String(e)}`, tone: 'error', undo: null });
          }
        }}
      />
    </SafeAreaView>
  );
}

function Banner({
  t,
  icon,
  text,
  action,
  onPress,
}: {
  t: ReturnType<typeof useTheme>;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View style={[styles.banner, { backgroundColor: t.accentSoft }]}>
      <Ionicons name={icon} size={20} color={t.accent} />
      <Text style={[styles.bannerText, { color: t.text }]}>{text}</Text>
      <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
        <Text style={[styles.bannerAction, { color: t.accent }]}>{action}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { flex: 1, alignItems: 'center' },
  h1: { fontSize: 22, fontWeight: '700' },
  h2: { fontSize: 13, marginTop: 2 },
  inputWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 6,
    minHeight: 54,
  },
  input: { flex: 1, fontSize: 17, paddingVertical: 12 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  preview: { fontSize: 13, marginTop: 8, marginHorizontal: 6 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toastText: { flex: 1, fontSize: 14 },
  undo: { fontWeight: '700', fontSize: 14 },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, marginBottom: 12 },
  bannerText: { flex: 1, fontSize: 14 },
  bannerAction: { fontWeight: '700', fontSize: 14 },
  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
