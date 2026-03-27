const weatherCodeMap = {
  0: { label: "Clear sky", accent: "sunny" },
  1: { label: "Mostly clear", accent: "sunny" },
  2: { label: "Partly cloudy", accent: "cloudy" },
  3: { label: "Overcast", accent: "cloudy" },
  45: { label: "Fog", accent: "mist" },
  48: { label: "Freezing fog", accent: "mist" },
  51: { label: "Light drizzle", accent: "rain" },
  53: { label: "Drizzle", accent: "rain" },
  55: { label: "Heavy drizzle", accent: "rain" },
  56: { label: "Freezing drizzle", accent: "rain" },
  57: { label: "Dense freezing drizzle", accent: "rain" },
  61: { label: "Light rain", accent: "rain" },
  63: { label: "Rain", accent: "rain" },
  65: { label: "Heavy rain", accent: "storm" },
  66: { label: "Freezing rain", accent: "storm" },
  67: { label: "Heavy freezing rain", accent: "storm" },
  71: { label: "Light snow", accent: "snow" },
  73: { label: "Snow", accent: "snow" },
  75: { label: "Heavy snow", accent: "snow" },
  77: { label: "Snow grains", accent: "snow" },
  80: { label: "Rain showers", accent: "rain" },
  81: { label: "Heavy showers", accent: "storm" },
  82: { label: "Violent showers", accent: "storm" },
  85: { label: "Snow showers", accent: "snow" },
  86: { label: "Heavy snow showers", accent: "snow" },
  95: { label: "Thunderstorm", accent: "storm" },
  96: { label: "Thunderstorm with hail", accent: "storm" },
  99: { label: "Severe thunderstorm", accent: "storm" },
};

export function getWeatherDetails(code) {
  return weatherCodeMap[code] ?? { label: "Conditions unavailable", accent: "cloudy" };
}
