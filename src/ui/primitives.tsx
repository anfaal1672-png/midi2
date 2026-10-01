import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { MoreHorizontal, X } from 'lucide-preact';
import { t } from './i18n';

export function IconButton(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    active?: boolean;
    children: ComponentChildren;
  },
) {
  const { label, active, children, class: cls, ...rest } = props;
  return (
    <button
      type="button"
      class={`icon-btn ${active ? 'active' : ''} ${cls ?? ''}`}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onInput: (v: number) => void;
  format?: (v: number) => string;
  resetTo?: number;
  hideLabel?: boolean;
  vertical?: boolean;
  id?: string;
}) {
  const { label, value, min, max, step = 0.01, onInput, format, resetTo, hideLabel, vertical, id } = props;
  return (
    <label class={`slider ${vertical ? 'vertical' : ''}`} title={label}>
      {!hideLabel && <span class="slider-label">{label}</span>}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={format ? format(value) : String(value)}
        onInput={(e) => onInput(Number((e.target as HTMLInputElement).value))}
        onDblClick={() => resetTo !== undefined && onInput(resetTo)}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as any}
      />
      {format && <span class="slider-value">{format(value)}</span>}
    </label>
  );
}

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  wide?: boolean;
  footer?: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const prev = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    return () => prev?.focus?.();
  }, []);
  return (
    <dialog
      ref={ref}
      class={`modal ${props.wide ? 'wide' : ''}`}
      aria-label={props.title}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
    >
      <div class="modal-inner">
        <header class="modal-header">
          <h2>{props.title}</h2>
          <IconButton label={t('common.close')} onClick={props.onClose}>
            <X size={18} />
          </IconButton>
        </header>
        <div class="modal-body">{props.children}</div>
        {props.footer && <footer class="modal-footer">{props.footer}</footer>}
      </div>
    </dialog>
  );
}

export function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label class="toggle">
      <input
        type="checkbox"
        role="switch"
        checked={props.checked}
        onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)}
      />
      <span class="toggle-track" aria-hidden="true" />
      <span class="toggle-text">
        {props.label}
        {props.hint && <small class="muted"> {props.hint}</small>}
      </span>
    </label>
  );
}

export interface MenuItem {
  label: string;
  icon?: ComponentChildren;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** 「その他」メニュー（キーボード操作対応のポップオーバー） */
export function MoreMenu(props: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey, true);
    wrap.current?.querySelector<HTMLButtonElement>('.menu button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <span class="more-menu" ref={wrap}>
      <IconButton
        label={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={16} />
      </IconButton>
      {open && (
        <div class="menu" role="menu">
          {props.items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              class={it.danger ? 'danger' : ''}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
