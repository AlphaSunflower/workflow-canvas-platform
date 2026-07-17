import { memo } from 'react';

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export const Checkbox = memo<CheckboxProps>(({
  label,
  checked,
  onChange,
  disabled = false,
  className = '',
}) => {
  return (
    <label className={`checkbox ${disabled ? 'checkbox--disabled' : ''} ${className}`.trim()}>
      <input
        type="checkbox"
        className="checkbox__input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className="checkbox__label">{label}</span>
    </label>
  );
});

Checkbox.displayName = 'Checkbox';
