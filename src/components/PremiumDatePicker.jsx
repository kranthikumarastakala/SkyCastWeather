import dayjs from "dayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";

function toPickerDate(value) {
  if (!value) {
    return null;
  }

  const parsedDate = dayjs(value);
  return parsedDate.isValid() ? parsedDate : null;
}

export default function PremiumDatePicker({
  id,
  value,
  minDate,
  maxDate,
  onChange,
  disabled = false,
  placeholder = "Select date",
  ariaLabel = "Select date",
}) {
  return (
    <div className="premium-date-picker">
      <DatePicker
        value={toPickerDate(value)}
        onChange={(nextValue) => {
          if (!nextValue || !nextValue.isValid()) {
            return;
          }

          onChange(nextValue.format("YYYY-MM-DD"));
        }}
        minDate={toPickerDate(minDate)}
        maxDate={toPickerDate(maxDate)}
        disabled={disabled}
        format="MMM D, YYYY"
        formatDensity="spacious"
        views={["year", "month", "day"]}
        openTo="day"
        reduceAnimations
        showDaysOutsideCurrentMonth
        displayWeekNumber
        fixedWeekNumber={6}
        yearsPerRow={4}
        dayOfWeekFormatter={(weekday) => weekday.format("dd")}
        slotProps={{
          textField: {
            id,
            fullWidth: true,
            placeholder,
            inputProps: {
              "aria-label": ariaLabel,
            },
            sx: {
              "& .MuiPickersOutlinedInput-root": {
                borderRadius: "16px",
                backgroundColor: "white",
                color: "var(--text)",
                minHeight: "54px",
                transition:
                  "box-shadow 180ms ease, transform 180ms ease, border-color 180ms ease",
              },
              "& .MuiPickersOutlinedInput-notchedOutline": {
                borderColor: "var(--border-strong)",
              },
              "& .MuiPickersOutlinedInput-root:hover .MuiPickersOutlinedInput-notchedOutline": {
                borderColor: "rgba(29, 111, 165, 0.34)",
              },
              "& .MuiPickersInputBase-root.Mui-focused .MuiPickersOutlinedInput-notchedOutline": {
                borderColor: "rgba(29, 111, 165, 0.34)",
                borderWidth: "1px",
              },
              "& .MuiPickersInputBase-root.Mui-focused": {
                boxShadow: "0 0 0 4px rgba(29, 111, 165, 0.12)",
              },
              "& .MuiPickersSectionList-root": {
                padding: "14px 16px",
                fontSize: "0.98rem",
                lineHeight: 1.45,
              },
              "& .MuiIconButton-root": {
                color: "var(--accent-strong)",
                marginRight: "4px",
              },
              "& .Mui-disabled": {
                WebkitTextFillColor: "rgba(16, 34, 56, 0.5)",
              },
            },
          },
          popper: {
            className: "premium-date-picker-popper",
          },
          desktopPaper: {
            className: "premium-date-picker-paper",
            elevation: 0,
          },
          mobilePaper: {
            className: "premium-date-picker-paper",
            elevation: 0,
          },
        }}
      />
    </div>
  );
}
