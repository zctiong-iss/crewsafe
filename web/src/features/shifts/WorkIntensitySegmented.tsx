/** @author Tang Chee Seng (with assistance from Claude) */
import "./WorkIntensitySegmented.css"
import type { Intensity } from "@/api/shifts";

const OPTIONS: { value: Intensity; label: string }[] = [
  { value: "LIGHT", label: "Light" },
  { value: "MODERATE", label: "Moderate" },
  { value: "HEAVY", label: "Heavy" },
];

export function WorkIntensitySegmented({ name, value, onChange }: {
  name: string;               
  value: Intensity | "";
  onChange: (next: Intensity) => void;
}) {
  return (
    <fieldset className="intensity">
      <legend className="intensity__legend">Intensity</legend>
      <div className="intensity__segments">
        {OPTIONS.map((opt) => (
          <label key={opt.value} className={`intensity__segment intensity__segment--${opt.value.toLowerCase()}`}>
            <input
              type="radio"
              name={name}          
              value={opt.value}
              required
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}