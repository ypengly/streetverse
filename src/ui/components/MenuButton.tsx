import type { ButtonHTMLAttributes } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
}

export function MenuButton({ variant = 'ghost', className = '', ...rest }: Props): JSX.Element {
  return <button type="button" className={`menu-btn ${variant} ${className}`} {...rest} />;
}
