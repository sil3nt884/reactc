import type { CSSProperties, ReactNode } from 'react';

export interface WindowTitleBarProps {
  children: ReactNode;
  height?: number;
  style?: CSSProperties;
}

export function WindowTitleBar({ children, height = 48, style }: WindowTitleBarProps) {
  if (!Number.isFinite(height) || height < 24 || height > 120) {
    throw new Error('WindowTitleBar height must be between 24 and 120');
  }
  return <div data-native-window-titlebar={true} style={{
    position: 'relative',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16181c',
    color: '#f3f5f8',
    gap: 0,
    ...style,
    height,
  }}>{children}</div>;
}

export type WindowCommand = 'minimize' | 'maximize' | 'close' | 'licenses';
const labels: Record<WindowCommand, string> = {
  minimize: 'Minimize',
  maximize: 'Maximize or restore',
  close: 'Close',
  licenses: 'Licenses',
};
const captions: Record<WindowCommand, string> = {
  minimize: '−',
  maximize: '□',
  close: '×',
  licenses: 'Licenses',
};

export interface WindowButtonProps {
  command: WindowCommand;
  children?: ReactNode;
  style?: CSSProperties;
}

export function WindowButton({ command, children, style }: WindowButtonProps) {
  const label = children == null || (Array.isArray(children) && children.length === 0)
    ? captions[command] : children;
  return <button type="button" aria-label={labels[command]} data-native-window-command={command} style={{
    width: command === 'licenses' ? 84 : 46,
    height: 36,
    padding: 4,
    backgroundColor: '#00000000',
    ...style,
  }}>{label}</button>;
}
