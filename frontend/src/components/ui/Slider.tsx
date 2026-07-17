import { memo } from 'react';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label?: string;
  showValue?: boolean;
  disabled?: boolean;
  className?: string;
}

export const Slider = memo<SliderProps>(({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  showValue = true,
  disabled = false,
  className = '',
}) => {
  return (
    <div className={`slider-wrapper ${disabled ? 'slider-wrapper--disabled' : ''} ${className}`.trim()}>
      {label && (
        <div className="slider-header">
          <span className="slider-label">{label}</span>
          {showValue && (
            <span className="slider-value">{value}</span>
          )}
        </div>
      )}
      <input
        type="range"
        className="slider"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      />
    </div>
  );
});

Slider.displayName = 'Slider';
