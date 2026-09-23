import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fmtDuration, fmtTime } from '../dates';
import { daysLabel } from '../scheduler';
import { Theme } from '../theme';
import { BusyEvent, Item, Routine } from '../types';

type Props = {
  theme: Theme;
  items: Item[];
  routines: Routine[];
  /** Wake-up time and bedtime, shown as the day's bookends. */
  wake: number;
  bedtime: number;
  busy: BusyEvent[];
  /** Minutes after midnight when the day shown is today, otherwise null. */
  nowMin: number | null;
  isPast: boolean;
  onPress: (item: Item) => void;
  onToggle: (item: Item) => void;
};

type Row = { kind: 'item'; item: Item; start: number } | { kind: 'busy'; ev: BusyEvent; start: number };

export function Timeline({ theme: t, items, routines, wake, bedtime, busy, nowMin, isPast, onPress, onToggle }: Props) {
  const repeatLabel = (i: Item) => {
    const r = i.routineId ? routines.find((x) => x.id === i.routineId) : null;
    return r ? daysLabel(r.days) : null;
  };
  const timed: Row[] = [
    ...items.filter((i) => i.start !== null).map((item) => ({ kind: 'item' as const, item, start: item.start! })),
    ...busy.map((ev) => ({ kind: 'busy' as const, ev, start: ev.start })),
  ].sort((a, b) => a.start - b.start);
  const anytime = items.filter((i) => i.start === null);

  const nowIndex = nowMin === null ? -1 : timed.findIndex((r) => r.start > nowMin);
  const nowLine = (
    <View key="now" style={styles.nowRow}>
      <Text style={[styles.nowLabel, { color: t.now }]}>{fmtTime(nowMin ?? 0)}</Text>
      <View style={[styles.nowDot, { backgroundColor: t.now }]} />
      <View style={[styles.nowBar, { backgroundColor: t.now }]} />
    </View>
  );

  const rows: React.ReactNode[] = [];
  const bookend = (key: string, icon: 'sunny-outline' | 'moon-outline', label: string, min: number) => (
    <View key={key} style={styles.bookend}>
      <Ionicons name={icon} size={14} color={t.muted} />
      <Text style={[styles.bookendText, { color: t.muted }]}>
        {label} · {fmtTime(min)}
      </Text>
    </View>
  );
  let wakeShown = false;
  let bedShown = false;
  timed.forEach((r, idx) => {
    if (!wakeShown && r.start >= wake) {
      rows.push(bookend('wake', 'sunny-outline', 'Wake up', wake));
      wakeShown = true;
    }
    if (!bedShown && r.start >= bedtime) {
      rows.push(bookend('bed', 'moon-outline', 'Bedtime', bedtime));
      bedShown = true;
    }
    if (idx === nowIndex) rows.push(nowLine);
    rows.push(
      r.kind === 'busy' ? (
        <BusyRow key={`b-${r.ev.id}-${r.ev.start}`} t={t} ev={r.ev} />
      ) : (
        <ItemRow
          key={r.item.id}
          t={t}
          item={r.item}
          missed={!r.item.done && (isPast || (nowMin !== null && r.item.start! + r.item.duration <= nowMin))}
          current={!r.item.done && nowMin !== null && r.item.start! <= nowMin && nowMin < r.item.start! + r.item.duration}
          repeat={repeatLabel(r.item)}
          onPress={onPress}
          onToggle={onToggle}
        />
      ),
    );
  });
  if (nowMin !== null && nowIndex === -1) rows.push(nowLine);
  if (!wakeShown) rows.unshift(bookend('wake', 'sunny-outline', 'Wake up', wake));
  if (!bedShown) rows.push(bookend('bed', 'moon-outline', 'Bedtime', bedtime));

  return (
    <View>
      {rows}
      {anytime.length > 0 && (
        <>
          <Text style={[styles.section, { color: t.muted }]}>ANYTIME</Text>
          {anytime.map((item) => (
            <ItemRow
              key={item.id}
              t={t}
              item={item}
              missed={false}
              current={false}
              repeat={repeatLabel(item)}
              onPress={onPress}
              onToggle={onToggle}
            />
          ))}
        </>
      )}
    </View>
  );
}

function ItemRow({
  t,
  item,
  missed,
  current,
  repeat,
  onPress,
  onToggle,
}: {
  t: Theme;
  item: Item;
  missed: boolean;
  current: boolean;
  repeat: string | null;
  onPress: (i: Item) => void;
  onToggle: (i: Item) => void;
}) {
  const barColor = item.done ? t.faint : item.fixed ? t.accent : t.flexible;
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: current ? t.accentSoft : t.card, borderColor: t.border, opacity: pressed ? 0.7 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${item.start !== null ? ` at ${fmtTime(item.start)}` : ''}`}
    >
      <View style={styles.timeCol}>
        {item.start !== null ? (
          <>
            <Text style={[styles.time, { color: missed ? t.warn : t.text }]}>{fmtTime(item.start)}</Text>
            <Text style={[styles.dur, { color: t.muted }]}>{fmtDuration(item.duration)}</Text>
          </>
        ) : (
          <Text style={[styles.dur, { color: t.muted }]}>{fmtDuration(item.duration)}</Text>
        )}
      </View>
      <View style={[styles.bar, { backgroundColor: barColor }]} />
      <View style={styles.body}>
        <Text
          style={[
            styles.title,
            { color: item.done ? t.muted : t.text, textDecorationLine: item.done ? 'line-through' : 'none' },
          ]}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        <View style={styles.metaRow}>
          {repeat && (
            <Text style={[styles.meta, { color: t.muted }]}>
              <Ionicons name="repeat" size={11} /> {repeat}
            </Text>
          )}
          {!item.fixed && !item.done && (
            <Text style={[styles.meta, { color: t.muted }]}>
              <Ionicons name="flash-outline" size={11} /> {windowText(item) ?? 'auto-placed'}
            </Text>
          )}
          {missed && <Text style={[styles.meta, { color: t.warn }]}>missed · tap to reschedule</Text>}
          {current && <Text style={[styles.meta, { color: t.accent }]}>now</Text>}
        </View>
      </View>
      <Pressable
        onPress={() => onToggle(item)}
        hitSlop={12}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        accessibilityLabel={`Mark ${item.title} ${item.done ? 'not done' : 'done'}`}
      >
        <Ionicons
          name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
          size={26}
          color={item.done ? t.ok : t.faint}
        />
      </Pressable>
    </Pressable>
  );
}

function windowText(i: Item): string | null {
  const lo = i.earliest ?? null;
  const hi = i.latest ?? null;
  if (lo !== null && hi !== null) return `${fmtTime(lo)}–${fmtTime(hi)}`;
  if (lo !== null) return `after ${fmtTime(lo)}`;
  if (hi !== null) return `before ${fmtTime(hi)}`;
  return null;
}

function BusyRow({ t, ev }: { t: Theme; ev: BusyEvent }) {
  return (
    <View style={[styles.row, { backgroundColor: t.busyBg, borderColor: t.border }]}>
      <View style={styles.timeCol}>
        <Text style={[styles.time, { color: t.muted }]}>{fmtTime(ev.start)}</Text>
        <Text style={[styles.dur, { color: t.muted }]}>{fmtDuration(ev.end - ev.start)}</Text>
      </View>
      <View style={[styles.bar, { backgroundColor: t.busy }]} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: t.muted }]} numberOfLines={2}>
          {ev.title}
        </Text>
        <Text style={[styles.meta, { color: t.muted }]}>
          <Ionicons name="calendar-outline" size={11} /> from your calendar
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 10,
  },
  timeCol: { width: 68 },
  time: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dur: { fontSize: 12, marginTop: 2 },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  body: { flex: 1 },
  title: { fontSize: 16, fontWeight: '500' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, marginTop: 2 },
  bookend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 12, marginBottom: 8, marginTop: 2 },
  bookendText: { fontSize: 12, fontWeight: '600' },
  meta: { fontSize: 12 },
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginTop: 16, marginBottom: 8, marginLeft: 4 },
  nowRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, marginTop: -2 },
  nowLabel: { width: 68, fontSize: 11, fontWeight: '700', marginLeft: 12, fontVariant: ['tabular-nums'] },
  nowDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
  nowBar: { flex: 1, height: 2 },
});
