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
import { ai, AiStatus } from './src/ai';
import { answerToCommand, rulesNeedHelp } from './src/ai/prompt';
import * as calendar from './src/calendar';
import { ItemSheet, SettingsSheet } from './src/components/Sheets';
import { Timeline } from './src/components/Timeline';
import { addDays, dateKey, dayLabel, longDate, minutesOf } from './src/dates';
import { parseCommand } from './src/parser';
import {
  applyCommand,
  bringToToday,
  changeSettings,
  Ctx,
  datesOfInterest,
  leftovers,
  materialize,
  moveItem,
  pushLater,
  reflow,
  removeItem,
  Result,
  setDone,
  stopRoutine,
} from './src/scheduler';
import { loadItems, loadRoutines, loadSettings, saveItems, saveRoutines, saveSettings } from './src/storage';
import { useTheme } from './src/theme';
import { BusyEvent, DEFAULT_SETTINGS, Item, Routine, Settings } from './src/types';

/** Everything Undo needs to put back. */
type Snapshot = { items: Item[]; routines: Routine[]; settings: Settings };
type Toast = { message: string; tone: Result['tone']; undo: Snapshot | null };
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
  const [routines, setRoutinesState] = useState<Routine[]>([]);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [now, setNow] = useState(() => new Date());
  const today = dateKey(now);
  const [viewDate, setViewDate] = useState(today);
  const [busy, setBusy] = useState<Record<string, BusyEvent[]>>({});
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [calStatus, setCalStatus] = useState<CalStatus>('unknown');
  const [calendars, setCalendars] = useState<calendar.CalendarChoice[]>([]);
  const [text, setText] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ state: 'missing' });
  const [thinking, setThinking] = useState(false);
  /** First launch off Wi-Fi: ask before the big download. */
  const [askAiDownload, setAskAiDownload] = useState(false);

  // Refs mirror state for async work (calendar sync) that outlives a render.
  const itemsRef = useRef(items);
  const routinesRef = useRef(routines);
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

  const setRoutines = useCallback((next: Routine[]) => {
    routinesRef.current = next;
    setRoutinesState(next);
    saveRoutines(next);
  }, []);

  const snapshot = (): Snapshot => ({ items: itemsRef.current, routines: routinesRef.current, settings: settingsRef.current });

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
      // Re-place auto-placed items now that we know what's in the calendar.
      const today = dateKey(new Date());
      let next = itemsRef.current;
      const c: Ctx = { now: new Date(), settings: settingsRef.current, busy: loaded, viewDate: today };
      for (const d of Object.keys(loaded)) if (d >= today) next = reflow(next, d, c);
      if (next !== itemsRef.current && next.some((i, k) => i !== itemsRef.current[k])) {
        setItems(next);
        syncToCalendar();
      }
      return loaded;
    } catch (e) {
      console.warn('Could not read calendar', e);
    }
  }, [setItems, syncToCalendar]);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      const prev = settingsRef.current;
      const next = { ...prev, ...patch };
      settingsRef.current = next;
      setSettingsState(next);
      saveSettings(next);
      // New wake-up/bedtime: re-place auto-placed items to fit.
      if (next.dayStart !== prev.dayStart || next.dayEnd !== prev.dayEnd) {
        setItems(changeSettings(patch, itemsRef.current, { now: new Date(), settings: prev, busy: busyRef.current, viewDate: dateKey(new Date()) }));
      }
      syncToCalendar();
    },
    [syncToCalendar, setItems],
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
      const [loadedItems, loadedSettings, loadedRoutines] = await Promise.all([
        loadItems(dateKey(new Date())),
        loadSettings(),
        loadRoutines(),
      ]);
      itemsRef.current = loadedItems;
      syncedRef.current = loadedItems;
      settingsRef.current = loadedSettings;
      routinesRef.current = loadedRoutines;
      setItemsState(loadedItems);
      setSettingsState(loadedSettings);
      setRoutinesState(loadedRoutines);
      setReady(true);
      if (loadedSettings.calendarSync) await connectCalendar();
    })();
  }, [connectCalendar]);

  // On-device model: follow its status; load it if downloaded, otherwise start
  // the one-time download on first launch (automatically only on Wi-Fi).
  useEffect(() => {
    const model = ai();
    if (!ready || !model) return;
    const unsubscribe = model.subscribe(setAiStatus);
    (async () => {
      if (await model.isDownloaded()) {
        if (settingsRef.current.aiOn) model.loadModel(true);
      } else if (settingsRef.current.aiOn && !settingsRef.current.aiDownloadAsked) {
        if (await model.onWifi()) {
          updateSettings({ aiDownloadAsked: true });
          model.downloadModel();
        } else {
          setAskAiDownload(true);
        }
      }
    })();
    return unsubscribe;
  }, [ready, updateSettings]);

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

  // Fill in upcoming occurrences of repeating items (on launch and each new day).
  useEffect(() => {
    if (!ready || !routinesRef.current.length) return;
    const c: Ctx = { now: new Date(), settings: settingsRef.current, busy: busyRef.current, viewDate: today };
    const m = materialize(routinesRef.current, itemsRef.current, c);
    if (m.routines.some((r, k) => r !== routinesRef.current[k])) setRoutines(m.routines);
    if (m.added.length) {
      setItems(m.items);
      syncToCalendar();
    }
  }, [ready, today, setItems, setRoutines, syncToCalendar]);

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
    (result: Result, before: Snapshot) => {
      const changed = result.items !== before.items || !!result.routines || !!result.settings;
      if (result.message) showToast({ message: result.message, tone: result.tone, undo: changed ? before : null });
      if (!changed) return;
      if (result.routines) setRoutines(result.routines);
      if (result.settings) {
        const next = { ...settingsRef.current, ...result.settings };
        settingsRef.current = next;
        setSettingsState(next);
        saveSettings(next);
      }
      setItems(result.items);
      syncToCalendar();
    },
    [setItems, setRoutines, showToast, syncToCalendar],
  );

  const aiReady = settings.aiOn && aiStatus.state === 'ready';

  const submit = useCallback(async () => {
    const input = text.trim();
    if (!input || thinking) return;
    let cmd = parseCommand(input, new Date(), viewDate);
    let usedAi = false;
    const model = ai();
    if (aiReady && model && rulesNeedHelp(cmd)) {
      // The rules missed something: let the on-device model have a go.
      setThinking(true);
      try {
        const raw = await model.understand(input, itemsRef.current, new Date());
        const fromAi = answerToCommand(raw, input, new Date(), viewDate);
        if (fromAi) {
          cmd = fromAi;
          usedAi = true;
        }
      } catch (e) {
        console.warn('On-device AI failed', e);
      } finally {
        setThinking(false);
      }
    }
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
    const before = snapshot();
    const result = applyCommand(cmd, before.items, ctx(b), before.routines);
    if (usedAi && result.message) result.message = `✨ ${result.message}`;
    commit(result, before);
    setText('');
  }, [text, thinking, aiReady, viewDate, busy, calStatus, refreshBusy, commit, ctx, showToast]);

  const undo = useCallback(() => {
    if (!toast?.undo) return;
    // Items whose calendar event is already gone will get a fresh one on sync.
    const live = new Set(itemsRef.current.map((i) => i.eventId).filter(Boolean));
    const snap = toast.undo;
    setItems(snap.items.map((i) => (i.eventId && !live.has(i.eventId) ? { ...i, eventId: null } : i)));
    setRoutines(snap.routines);
    settingsRef.current = snap.settings;
    setSettingsState(snap.settings);
    saveSettings(snap.settings);
    syncToCalendar();
    showToast({ message: 'Undone.', tone: 'ok', undo: null });
  }, [toast, setItems, setRoutines, syncToCalendar, showToast]);

  const act = (fn: (items: Item[], c: Ctx) => Result) => {
    const before = snapshot();
    commit(fn(before.items, ctx()), before);
    setSelected(null);
  };

  const preview = useMemo(() => {
    if (!text.trim()) return null;
    if (thinking) return 'Reading your note…';
    const cmd = parseCommand(text, now, viewDate);
    if (aiReady && rulesNeedHelp(cmd)) return '✨ On-device AI will read this when you send it';
    if (cmd.kind === 'none') return null;
    return applyCommand(cmd, items, { now, settings, busy, viewDate }, routines).preview ?? null;
  }, [text, now, viewDate, items, settings, busy, routines, aiReady, thinking]);

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
            editable={!thinking}
            autoCapitalize="sentences"
            accessibilityLabel="What do you want to do?"
          />
          <Pressable
            onPress={submit}
            disabled={!text.trim() || thinking}
            style={[styles.send, { backgroundColor: text.trim() ? t.accent : t.border }]}
            accessibilityLabel="Add"
          >
            {thinking ? <ActivityIndicator color="#fff" /> : <Ionicons name="arrow-up" size={20} color="#fff" />}
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
        {aiStatus.state === 'downloading' && (
          <View style={[styles.banner, { backgroundColor: t.accentSoft, flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="sparkles-outline" size={20} color={t.accent} />
              <Text style={[styles.bannerText, { color: t.text }]}>
                Downloading on-device AI… {Math.round(aiStatus.progress * 100)}%
              </Text>
              <Pressable onPress={() => ai()?.cancelDownload()} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.bannerAction, { color: t.accent }]}>Cancel</Text>
              </Pressable>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: t.card }]}>
              <View style={[styles.progressFill, { backgroundColor: t.accent, width: `${Math.round(aiStatus.progress * 100)}%` }]} />
            </View>
          </View>
        )}
        {askAiDownload && !settings.aiDownloadAsked && aiStatus.state === 'missing' && (
          <Banner
            t={t}
            icon="sparkles-outline"
            text={`Download on-device AI so the app understands more ways of saying things (one-time ${(ai()!.MODEL.bytes / 1e9).toFixed(1)} GB; you're not on Wi-Fi).`}
            action="Download"
            onPress={() => {
              updateSettings({ aiDownloadAsked: true });
              ai()?.downloadModel();
            }}
            onDismiss={() => updateSettings({ aiDownloadAsked: true })}
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
            routines={routines}
            wake={settings.dayStart}
            bedtime={settings.dayEnd}
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
        onTomorrow={(i) => {
          // The day after the item's day (items on past days go to tomorrow).
          const date = addDays(i.date < today ? today : i.date, 1);
          act((it, c) => moveItem(it, i.id, i.fixed ? { date } : { date, start: null }, c));
        }}
        onDelete={(i) => act((it, c) => removeItem(it, i.id, c))}
        routine={selected?.routineId ? routines.find((r) => r.id === selected.routineId) ?? null : null}
        onStopRepeat={(r) => act((it, c) => stopRoutine(it, routinesRef.current, r.id, c))}
      />
      <SettingsSheet
        t={t}
        visible={showSettings}
        settings={settings}
        calendarStatus={calStatus}
        calendars={calendars}
        routines={routines}
        onStopRepeat={(r) => act((it, c) => stopRoutine(it, routinesRef.current, r.id, c))}
        onClose={() => setShowSettings(false)}
        onChange={updateSettings}
        onConnect={connectCalendar}
        ai={
          ai()
            ? {
                status: aiStatus,
                enabled: settings.aiOn,
                sizeGb: ai()!.MODEL.bytes / 1e9,
                modelName: ai()!.MODEL.name,
                onToggle: (on) => {
                  updateSettings({ aiOn: on });
                  if (on) ai()?.loadModel();
                },
                onDownload: () => {
                  updateSettings({ aiOn: true, aiDownloadAsked: true });
                  ai()?.downloadModel();
                },
                onCancel: () => ai()?.cancelDownload(),
                onDelete: () => ai()?.deleteModel(),
              }
            : null
        }
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
  onDismiss,
}: {
  t: ReturnType<typeof useTheme>;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  action: string;
  onPress: () => void;
  onDismiss?: () => void;
}) {
  return (
    <View style={[styles.banner, { backgroundColor: t.accentSoft }]}>
      <Ionicons name={icon} size={20} color={t.accent} />
      <Text style={[styles.bannerText, { color: t.text }]}>{text}</Text>
      <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
        <Text style={[styles.bannerAction, { color: t.accent }]}>{action}</Text>
      </Pressable>
      {onDismiss && (
        <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Not now">
          <Ionicons name="close" size={18} color={t.muted} />
        </Pressable>
      )}
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
  progressTrack: { height: 6, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
