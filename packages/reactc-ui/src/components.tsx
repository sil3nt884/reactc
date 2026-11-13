import type { CSSProperties, ReactNode } from 'react';

export interface LayoutProps {
  id?: string;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Stack({ id, children, style }: LayoutProps) {
  return <div id={id} style={{ display: 'flex', flexDirection: 'column', gap: 12, ...style }}>{children}</div>;
}

export function Row({ id, children, style }: LayoutProps) {
  return <div id={id} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, ...style }}>{children}</div>;
}

export function Panel({ id, children, style }: LayoutProps) {
  return <section id={id} style={{
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 16,
    borderColor: '#505765',
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: '#20242c',
    ...style,
  }}>{children}</section>;
}

export interface ButtonProps extends LayoutProps {
  disabled?: boolean;
  label?: string;
  onClick?: () => void | Promise<void>;
}

export function Button({ id, children, style, disabled, label, onClick }: ButtonProps) {
  return <button id={id} type="button" aria-label={label} disabled={disabled} onClick={onClick}
    style={{ padding: 10, borderRadius: 6, ...style }}>{children}</button>;
}

export interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  style?: CSSProperties;
  inputStyle?: CSSProperties;
}

export function TextField({
  id, label, value, onValueChange, disabled, readOnly, placeholder, style, inputStyle,
}: TextFieldProps) {
  return <Stack style={{ gap: 6, ...style }}>
    <label htmlFor={id}>{label}</label>
    <input id={id} type="text" value={value} disabled={disabled} readOnly={readOnly}
      placeholder={placeholder} style={{ padding: 8, ...inputStyle }}
      onChange={event => onValueChange(event.target.value)} />
  </Stack>;
}
