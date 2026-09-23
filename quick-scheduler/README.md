# Quick Scheduler

Open the app, type what you want to do, and it goes on your schedule.

- **No time given** (“groceries”) → it goes in the next free slot.
- **A time given** (“call mom at 5”, “dentist tomorrow 2-3pm”) → it's pinned to that time, and anything auto-placed moves out of the way.
- **A time window** (“groceries after 5pm”, “pay bills before noon”, “study between 2 and 4”) → first free slot inside that window.
- **Repeating** (“workout mon tue thu fri 5-6pm every week”, “standup weekdays at 9:30”) → added on those days every week.
- **Wake-up and bedtime** (“I wake up at 7”, “bedtime 11pm”, or in Settings) → nothing gets auto-placed outside them.
- **Change your mind** (“move gym to 7pm”, “push laundry back 30 min”, “cancel dentist”, “done groceries”) → the schedule adjusts.
- **Phone calendar**: timed items are added to your calendar with an alert, so your calendar app sends the reminder notifications. Existing events (meetings etc.) are read as busy time, so nothing gets auto-placed on top of them.

Everything is stored on the phone. There's no account and no server.

## Install on Android

Every push that touches `quick-scheduler/` runs the **Quick Scheduler APK** GitHub Action, which builds a standalone APK and publishes it as a GitHub Release.

1. On your phone, open the repo's **Releases** page and download `quick-scheduler.apk` from the latest “Quick Scheduler” release.
2. Open the file and allow installing apps from your browser/files app when Android asks.
3. On first launch, allow calendar access. Events go to your main (Google) calendar by default; you can pick another calendar, or a separate “Quick Scheduler” calendar, in Settings.

Newer builds install over older ones and keep your data.

## Things you can type

| You type | What happens |
| --- | --- |
| `groceries` | Next free slot today (default 30 min) |
| `call mom at 5` | 5:00 PM (small bare numbers mean PM) |
| `dentist tomorrow at 10am for an hour` | Tomorrow 10–11 AM |
| `workshop 3-4:30pm` | 3:00–4:30 PM |
| `gym this evening for 1h` | First free hour after 5 PM |
| `check the oven in 20 min` | 20 minutes from now |
| `haircut friday`, `brunch next sat` | That day, next free slot |
| `I work out mon tue thu fri 530pm to 630pm`, `standup mon-fri 9am` | Repeats on those days (lists of days repeat weekly) |
| `brunch this sat and sun at 11` | One item on each of those days (“this”/“next” = just once) |
| `take meds at 8am and 8pm` | One item per time |
| `piano every other wednesday at 4pm` | Repeats every second week |
| `groceries after 5pm`, `run after work` | First free slot after 5 PM |
| `pay bills before 3`, `email Sam by noon` | First free slot that ends by then |
| `study between 2 and 4pm` | First free slot in that window |
| `on Monday Tuesday Thursday Friday I want to workout from 5-6pm every week` | Repeats Mon/Tue/Thu/Fri, 5–6 PM |
| `yoga tuesdays at 7pm`, `standup weekdays at 9:30am`, `meditate every morning` | Repeating items |
| `stop workout`, `cancel yoga every week` | Ends a repeat and removes its upcoming occurrences |
| `I wake up at 6:30`, `bedtime 11pm` | Sets your day; auto-placed items re-fit |
| `move gym to 7pm`, `reschedule dentist to tomorrow` | Moves the matching item |
| `push laundry back 30 min`, `move call earlier by an hour` | Shifts it |
| `postpone groceries` | Next free slot after it |
| `cancel dentist`, `done groceries`, `move it to 6` | Matches items loosely; “it” = the last thing added |

Tap an item to mark it done, push it later, move it to the next day or delete it (for a repeat: just that one, or stop the whole series). The day header arrows switch days.

**How repeats work:** occurrences are created 4 weeks ahead (topped up each time you open the app on a new day) and each one is a normal item and calendar event, so you can move, finish or delete one without touching the rest. Settings lists your repeating items with a Stop button.

## Development

```bash
npm install
npm test          # parser + scheduler unit tests
npm run typecheck
npx expo run:android   # needs Android SDK; or build via the GitHub Action
```

- `src/parser.ts`: turns text into commands (add / move / remove / done)
- `src/scheduler.ts`: slot finding, reflowing auto-placed items, applying commands
- `src/calendar.ts`: phone calendar sync and busy-time lookup (expo-calendar)
- `App.tsx`, `src/components/`: the UI
