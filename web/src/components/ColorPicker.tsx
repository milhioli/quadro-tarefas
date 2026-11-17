import { COLOR_LABELS, TASK_COLORS, type TaskColor } from '@quadro/shared';
import { useId } from 'react';

export interface ColorPickerProps {
  value: TaskColor;
  onChange: (color: TaskColor) => void;
}

/** Grupo de rádios com as cores da tarefa; o nome de cada cor é lido pelo leitor de tela. */
export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const name = useId();
  return (
    <fieldset className="color-picker">
      <legend className="field__label">Cor</legend>
      <div className="color-picker__options">
        {TASK_COLORS.map((color) => (
          <label key={color} className={`color-swatch color-swatch--${color}`}>
            <input
              type="radio"
              className="color-swatch__input"
              name={name}
              value={color}
              checked={value === color}
              onChange={() => onChange(color)}
            />
            <span className="color-swatch__dot" aria-hidden="true" />
            <span className="visually-hidden">{COLOR_LABELS[color]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
