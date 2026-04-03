import Autocomplete from "@mui/material/Autocomplete";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";

function normalizeText(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export default function LocationAutocompleteInput({
  id,
  value,
  options,
  loading = false,
  disabled = false,
  placeholder,
  ariaLabel,
  noOptionsText = "No matching locations",
  loadingText = "Finding locations...",
  buildOptionLabel,
  buildOptionTitle,
  buildOptionCaption,
  buildOptionKey,
  onInputValueChange,
  onOptionSelect,
}) {
  const selectedOption =
    options.find((option) => normalizeText(buildOptionLabel(option)) === normalizeText(value)) ??
    (value ? value : null);

  return (
    <div className="location-autocomplete">
      <Autocomplete
        freeSolo
        autoHighlight
        selectOnFocus
        clearOnBlur={false}
        handleHomeEndKeys
        openOnFocus
        disabled={disabled}
        loading={loading}
        options={options}
        value={selectedOption}
        inputValue={value}
        filterOptions={(availableOptions) => availableOptions}
        getOptionLabel={(option) =>
          typeof option === "string" ? option : buildOptionLabel(option)
        }
        isOptionEqualToValue={(option, selectedValue) =>
          typeof selectedValue === "string"
            ? normalizeText(buildOptionLabel(option)) === normalizeText(selectedValue)
            : buildOptionKey(option) === buildOptionKey(selectedValue)
        }
        noOptionsText={noOptionsText}
        loadingText={loadingText}
        onInputChange={(_, nextValue, reason) => {
          if (reason === "input" || reason === "clear" || reason === "reset") {
            onInputValueChange(nextValue);
          }
        }}
        onChange={(_, nextValue) => {
          if (!nextValue || typeof nextValue === "string") {
            return;
          }

          onInputValueChange(buildOptionLabel(nextValue));
          onOptionSelect?.(nextValue);
        }}
        slotProps={{
          popper: {
            className: "location-autocomplete-popper",
          },
          paper: {
            className: "location-autocomplete-paper",
            elevation: 0,
          },
        }}
        renderOption={(props, option) => {
          const { key, ...optionProps } = props;
          const title = buildOptionTitle ? buildOptionTitle(option) : buildOptionLabel(option);
          const caption = buildOptionCaption(option);

          return (
            <li {...optionProps} key={buildOptionKey(option)}>
              <div className="location-option">
                <strong>{title}</strong>
                {caption ? <span>{caption}</span> : null}
              </div>
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            id={id}
            placeholder={placeholder}
            fullWidth
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={18} sx={{ mr: 1 }} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
            inputProps={{
              ...params.inputProps,
              "aria-label": ariaLabel,
              autoComplete: "off",
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: "16px",
                backgroundColor: "white",
                minHeight: "56px",
              },
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: "var(--border-strong)",
              },
              "& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline": {
                borderColor: "rgba(29, 111, 165, 0.34)",
              },
              "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": {
                borderColor: "rgba(29, 111, 165, 0.34)",
              },
              "& .MuiOutlinedInput-root.Mui-focused": {
                boxShadow: "0 0 0 4px rgba(29, 111, 165, 0.12)",
              },
              "& .MuiInputBase-input": {
                padding: "15px 16px",
                fontSize: "0.98rem",
              },
            }}
          />
        )}
      />
    </div>
  );
}
