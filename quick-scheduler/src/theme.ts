import { useColorScheme } from 'react-native';

const light = {
  bg: '#F7F7F9',
  card: '#FFFFFF',
  text: '#16161D',
  muted: '#6B6B7B',
  faint: '#B4B4C2',
  border: '#E6E6EC',
  accent: '#5B5BD6',
  accentSoft: '#E9E9FB',
  flexible: '#8E8EE8',
  busy: '#C9C9D4',
  busyBg: '#EFEFF3',
  now: '#E5484D',
  warn: '#B35900',
  warnBg: '#FFF1E0',
  error: '#CE2C31',
  ok: '#1C7C4D',
  overlay: 'rgba(0,0,0,0.35)',
};

const dark: typeof light = {
  bg: '#111116',
  card: '#1C1C23',
  text: '#EDEDF2',
  muted: '#9A9AAB',
  faint: '#55556A',
  border: '#2C2C36',
  accent: '#8C8CFF',
  accentSoft: '#26264A',
  flexible: '#6A6AC8',
  busy: '#4A4A58',
  busyBg: '#23232B',
  now: '#FF6369',
  warn: '#FFB35C',
  warnBg: '#3A2A14',
  error: '#FF6B6B',
  ok: '#4CC38A',
  overlay: 'rgba(0,0,0,0.6)',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
