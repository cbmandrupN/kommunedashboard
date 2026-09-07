import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function Button({
  className,
  children,
  variant = 'primary',
  size = 'md',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md'
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:pointer-events-none disabled:opacity-50',
        variant === 'primary'
          ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
          : 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', className)}
      {...rest}
    >
      {children}
    </div>
  )
}

export function Badge({
  children,
  color = 'slate',
}: {
  children: ReactNode
  color?: 'slate' | 'amber' | 'blue' | 'green' | 'red'
}) {
  const colors = {
    slate: 'border-slate-200 bg-slate-100 text-slate-600',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    green: 'border-green-200 bg-green-50 text-green-700',
    red: 'border-red-200 bg-red-50 text-red-700',
  }
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', colors[color])}>
      {children}
    </span>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm',
        'placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40',
        className,
      )}
      {...rest}
    />
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 cursor-pointer rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm',
        'focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  )
}
