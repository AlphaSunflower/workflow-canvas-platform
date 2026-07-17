import React, { memo } from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Array<{ value: string; label: string }>;
  error?: string;
}

export const Select = memo<SelectProps>(({
  label,
  options,
  error,
  className = '',
  ...props
}) => {
  return (
    <div className="select-wrapper">
      {label && (
        <label className="select-label">{label}</label>
      )}
      <select
        className={`select ${error ? 'select--error' : ''} ${className}`.trim()}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <span className="select-error">{error}</span>
      )}
    </div>
  );
});

Select.displayName = 'Select';
