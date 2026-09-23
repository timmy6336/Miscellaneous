import { Ionicons } from '@expo/vector-icons';
import { ComponentProps, ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AiStatus } from '../ai';
import { CalendarChoice } from '../calendar';
import { dayLabel, fmtRange, fmtTime } from '../dates';
import { routineLabel, routineWhen } from '../scheduler';
import { Theme } from '../theme';
import { Item, Routine, Settings } from '../types';

function Sheet({ t, visible, onClose, children }: { t: Theme; visible: boolean; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: t.overlay }]} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: t.card, paddingBottom: insets.bottom + 16 }]}>
        <View style={[styles.grabber, { backgroundColor: t.border }]} />
        {children}
      </View>
    </Modal>
  );
}

function Action({
  t,
  icon,
  label,
  onPress,
  danger,
}: {
  t: Theme;
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const color = danger ? t.error : t.text;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: pressed ? t.accentSoft : 'transparent' }]}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={22} color={danger ? t.error : t.accent} />
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function ItemSheet({
  t,
  item,
  today,
  onClose,
  onToggle,
  onLater,
  onTomorrow,
  onToday,
  onDelete,
  routine,
  onStopRepeat,
}: {
  t: Theme;
  item: Item | null;
  routine: Routine | null;
  onStopRepeat: (r: Routine) => void;
  today: string;
  onClose: () => void;
  onToggle: (i: Item) => void;
  onLater: (i: Item) => void;
  onTomorrow: (i: Item) => void;
  onToday: (i: Item) => void;
  onDelete: (i: Item) => void;
}) {
  return (
    <Sheet t={t} visible={!!item} onClose={onClose}>
      {item && (
        <>
          <Text style={[styles.sheetTitle, { color: t.text }]}>{item.title}</Text>
          <Text style={[styles.sheetSub, { color: t.muted }]}>
            {dayLabel(item.date, today)}
            {item.start !== null ? ` · ${fmtRange(item.start, item.duration)}` : ' · anytime'}
            {item.fixed ? '' : ' · auto-placed'}
          </Text>
          {routine && (
            <Text style={[styles.sheetSub, { color: t.muted, marginTop: -8 }]}>
              <Ionicons name="repeat" size={13} /> Repeats {routineLabel(routine)}
            </Text>
          )}
          <Action t={t} icon={item.done ? 'arrow-undo-outline' : 'checkmark-circle-outline'} label={item.done ? 'Mark not done' : 'Mark done'} onPress={() => onToggle(item)} />
          {!item.done && <Action t={t} icon="play-forward-outline" label="Later — next free slot" onPress={() => onLater(item)} />}
          {!item.done && item.date !== today && <Action t={t} icon="today-outline" label="Move to today" onPress={() => onToday(item)} />}
          {!item.done && <Action t={t} icon="arrow-forward-circle-outline" label={item.date <= today ? 'Move to tomorrow' : 'Move to the next day'} onPress={() => onTomorrow(item)} />}
          <Action t={t} icon="trash-outline" label={routine ? 'Delete just this one' : 'Delete'} danger onPress={() => onDelete(item)} />
          {routine && <Action t={t} icon="stop-circle-outline" label="Stop repeating (remove upcoming)" danger onPress={() => onStopRepeat(routine)} />}
          <Text style={[styles.tip, { color: t.muted }]}>
            Tip: you can also type things like “move {item.title.toLowerCase()} to 5pm”.
          </Text>
        </>
      )}
    </Sheet>
  );
}

function Chips<T extends number>({
  t,
  options,
  value,
  onChange,
}: {
  t: Theme;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.chip, { backgroundColor: on ? t.accent : t.bg, borderColor: on ? t.accent : t.border }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <Text style={{ color: on ? '#fff' : t.text, fontWeight: '500' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Stepper({ t, label, value, onChange }: { t: Theme; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.stepper}>
      <Text style={{ color: t.text, flex: 1 }}>{label}</Text>
      <Pressable onPress={() => onChange(value - 15)} hitSlop={8} accessibilityLabel={`${label} earlier`}>
        <Ionicons name="remove-circle-outline" size={28} color={t.accent} />
      </Pressable>
      <Text style={[styles.stepValue, { color: t.text }]}>{fmtTime(value)}</Text>
      <Pressable onPress={() => onChange(value + 15)} hitSlop={8} accessibilityLabel={`${label} later`}>
        <Ionicons name="add-circle-outline" size={28} color={t.accent} />
      </Pressable>
    </View>
  );
}

const EXAMPLES = [
  'groceries',
  'call mom at 5',
  'dentist tomorrow 2-3pm',
  'groceries after 5pm',
  'pay bills before noon',
  'gym this evening for an hour',
  'workout mon tue thu fri 5-6pm every week',
  'stop workout',
  'I wake up at 6:30 / bedtime 11pm',
  'check the oven in 20 min',
  'move gym to 7pm',
  'push laundry back 30 min',
  'cancel dentist',
  'done groceries',
];

export function SettingsSheet({
  t,
  visible,
  settings,
  calendarStatus,
  calendars,
  routines,
  onStopRepeat,
  ai,
  onClose,
  onChange,
  onConnect,
  onCreateOwnCalendar,
}: {
  t: Theme;
  visible: boolean;
  settings: Settings;
  calendarStatus: 'unknown' | 'granted' | 'denied' | 'blocked';
  calendars: CalendarChoice[];
  routines: Routine[];
  onStopRepeat: (r: Routine) => void;
  /** Null where the on-device model isn't available. */
  ai: {
    status: AiStatus;
    enabled: boolean;
    sizeGb: number;
    modelName: string;
    onToggle: (on: boolean) => void;
    onDownload: () => void;
    onCancel: () => void;
    onDelete: () => void;
  } | null;
  onClose: () => void;
  onChange: (patch: Partial<Settings>) => void;
  onConnect: () => void;
  onCreateOwnCalendar: () => void;
}) {
  const set = (patch: Partial<Settings>) => onChange(patch);
  return (
    <Sheet t={t} visible={visible} onClose={onClose}>
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ paddingBottom: 8 }}>
        <Text style={[styles.sheetTitle, { color: t.text }]}>Settings</Text>

        {ai && (
          <>
            <Text style={[styles.label, { color: t.muted }]}>ON-DEVICE AI</Text>
            {ai.status.state === 'missing' && (
              <>
                <Text style={[styles.hint, { color: t.muted }]}>
                  Lets a small AI model read notes the built-in rules can't fully understand. Runs on your phone; nothing is sent
                  anywhere. One-time download of about {ai.sizeGb.toFixed(1)} GB (Wi-Fi recommended).
                </Text>
                <Pressable onPress={ai.onDownload} style={[styles.button, { backgroundColor: t.accent }]} accessibilityRole="button">
                  <Text style={styles.buttonText}>Download on-device AI</Text>
                </Pressable>
              </>
            )}
            {ai.status.state === 'downloading' && (
              <View style={styles.stepper}>
                <Text style={{ color: t.text, flex: 1 }}>Downloading… {Math.round(ai.status.progress * 100)}%</Text>
                <Pressable onPress={ai.onCancel} hitSlop={8} accessibilityRole="button">
                  <Text style={{ color: t.error, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
              </View>
            )}
            {(ai.status.state === 'ready' || ai.status.state === 'loading') && (
              <>
                <View style={styles.stepper}>
                  <Text style={{ color: t.text, flex: 1 }}>
                    Use AI for notes the rules can't read{ai.status.state === 'loading' ? ' (loading…)' : ''}
                  </Text>
                  <Switch value={ai.enabled} onValueChange={ai.onToggle} trackColor={{ true: t.accent }} />
                </View>
                <Text style={[styles.hint, { color: t.muted }]}>
                  {ai.modelName}. When it's off (or still loading), the built-in rules are used.
                </Text>
                <Pressable onPress={ai.onDelete} style={styles.calRow} accessibilityRole="button">
                  <Ionicons name="trash-outline" size={18} color={t.error} />
                  <Text style={{ color: t.error }}>Delete model (frees {ai.sizeGb.toFixed(1)} GB)</Text>
                </Pressable>
              </>
            )}
            {ai.status.state === 'error' && (
              <>
                <Text style={[styles.hint, { color: t.error }]}>{ai.status.message}</Text>
                <Pressable onPress={ai.onDownload} style={[styles.button, { backgroundColor: t.accent }]} accessibilityRole="button">
                  <Text style={styles.buttonText}>Try again</Text>
                </Pressable>
              </>
            )}
          </>
        )}

        <Text style={[styles.label, { color: t.muted }]}>YOUR DAY</Text>
        <Stepper t={t} label="Wake up" value={settings.dayStart} onChange={(v) => set({ dayStart: Math.max(0, Math.min(v, settings.dayEnd - 60)) })} />
        <Stepper t={t} label="Bedtime" value={settings.dayEnd} onChange={(v) => set({ dayEnd: Math.min(1440, Math.max(v, settings.dayStart + 60)) })} />
        <Text style={[styles.hint, { color: t.muted }]}>Nothing gets auto-placed before you wake up or after bedtime. You can also type “I wake up at 7”.</Text>

        <Text style={[styles.label, { color: t.muted }]}>REPEATING</Text>
        {routines.length === 0 ? (
          <Text style={[styles.hint, { color: t.muted }]}>Nothing yet. Try “workout mon wed fri 5-6pm every week”.</Text>
        ) : (
          routines.map((r) => (
            <View key={r.id} style={styles.calRow}>
              <Ionicons name="repeat" size={18} color={t.accent} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text }}>{r.title}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>
                  {routineLabel(r)} · {routineWhen(r)}
                </Text>
              </View>
              <Pressable onPress={() => onStopRepeat(r)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Stop repeating ${r.title}`}>
                <Text style={{ color: t.error, fontWeight: '600' }}>Stop</Text>
              </Pressable>
            </View>
          ))
        )}

        <Text style={[styles.label, { color: t.muted }]}>PHONE CALENDAR</Text>
        <View style={styles.stepper}>
          <Text style={{ color: t.text, flex: 1 }}>Add timed items to my calendar (for reminders)</Text>
          <Switch
            value={settings.calendarSync}
            onValueChange={(v) => set({ calendarSync: v })}
            trackColor={{ true: t.accent }}
          />
        </View>
        {settings.calendarSync && calendarStatus !== 'granted' && (
          <Pressable onPress={onConnect} style={[styles.button, { backgroundColor: t.accent }]}>
            <Text style={styles.buttonText}>{calendarStatus === 'blocked' ? 'Open settings to allow calendar' : 'Allow calendar access'}</Text>
          </Pressable>
        )}
        {settings.calendarSync && calendarStatus === 'granted' && (
          <>
            <Text style={[styles.hint, { color: t.muted }]}>Save events to:</Text>
            {calendars.map((c) => {
              const on = c.id === settings.calendarId;
              return (
                <Pressable key={c.id} onPress={() => set({ calendarId: c.id })} style={styles.calRow} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <View style={[styles.calDot, { backgroundColor: c.color || t.accent }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text }}>{c.title}</Text>
                    {!!c.source && <Text style={{ color: t.muted, fontSize: 12 }}>{c.source}</Text>}
                  </View>
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? t.accent : t.faint} />
                </Pressable>
              );
            })}
            <Pressable onPress={onCreateOwnCalendar} style={styles.calRow}>
              <Ionicons name="add" size={18} color={t.accent} />
              <Text style={{ color: t.accent }}>Use a separate “Quick Scheduler” calendar</Text>
            </Pressable>
          </>
        )}

        <Text style={[styles.label, { color: t.muted }]}>REMIND ME</Text>
        <Chips
          t={t}
          value={settings.reminderMinutes}
          onChange={(v) => set({ reminderMinutes: v })}
          options={[
            { value: -1, label: 'Off' },
            { value: 0, label: 'At start' },
            { value: 5, label: '5 min' },
            { value: 10, label: '10 min' },
            { value: 15, label: '15 min' },
            { value: 30, label: '30 min' },
          ]}
        />
        <Text style={[styles.hint, { color: t.muted }]}>before each item (applies to new changes).</Text>

        <Text style={[styles.label, { color: t.muted }]}>DEFAULT LENGTH</Text>
        <Chips
          t={t}
          value={settings.defaultDuration}
          onChange={(v) => set({ defaultDuration: v })}
          options={[15, 30, 45, 60, 90].map((m) => ({ value: m, label: m < 60 ? `${m} min` : `${m / 60}h`.replace('1.5h', '1½h') }))}
        />


        <Text style={[styles.label, { color: t.muted }]}>THINGS YOU CAN TYPE</Text>
        {EXAMPLES.map((e) => (
          <Text key={e} style={[styles.example, { color: t.text }]}>
            “{e}”
          </Text>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 8 },
  grabber: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  sheetSub: { fontSize: 14, marginTop: 4, marginBottom: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 8, borderRadius: 10 },
  actionText: { fontSize: 16 },
  tip: { fontSize: 13, marginTop: 12 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginTop: 20, marginBottom: 8 },
  hint: { fontSize: 13, marginTop: 6, marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  stepValue: { width: 84, textAlign: 'center', fontSize: 16, fontVariant: ['tabular-nums'] },
  button: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  calRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  calDot: { width: 12, height: 12, borderRadius: 6 },
  example: { fontSize: 15, paddingVertical: 3 },
});
