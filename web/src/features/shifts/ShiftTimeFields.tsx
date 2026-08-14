/** @author Tang Chee Seng (with assistance from Claude) */
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

export function ShiftTimeFields({
  startsAt,
  endsAt,
  onStartChange,
  onEndChange,
  endError,
}: {
  startsAt: Date | null;
  endsAt: Date | null;
  onStartChange: (d: Date | null) => void;
  onEndChange: (d: Date | null) => void;
  endError?: string;
}) {
  return (
    <>
      <label htmlFor="startsAt">Starts at</label>
      <DatePicker
        id="startsAt"
        wrapperClassName="shift-form__datepicker-wrapper"
        className="shift-form__datepicker-input"
        selected={startsAt}
        onChange={onStartChange}
        showTimeSelect
        timeFormat="HH:mm"
        timeIntervals={15}
        dateFormat="d MMM yyyy, HH:mm"
        required
      />

      <label htmlFor="endsAt">Ends at</label>
      <DatePicker
        id="endsAt"
        wrapperClassName="shift-form__datepicker-wrapper"
        className="shift-form__datepicker-input"
        selected={endsAt}
        onChange={onEndChange}
        showTimeSelect
        timeFormat="HH:mm"
        timeIntervals={15}
        dateFormat="d MMM yyyy, HH:mm"
        required
      />
      {endError && <p className="shift-form__error" role="alert">{endError}</p>}
    </>
  );
}