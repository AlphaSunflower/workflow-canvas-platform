import React, { memo } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = memo<InputProps>(({
  label,
  error,
  className = '',
  ...props
}) => {
  return (
    <div className="input-wrapper">
      {label && (
        <label className="input-label">{label}</label>
      )}
      <input
        className={`input ${error ? 'input--error' : ''} ${className}`.trim()}
        {...props}
      />
      {error && (
        <span className="input-error">{error}</span>
      )}
    </div>
  );
});

Input.displayName = 'Input';
