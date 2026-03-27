import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { getWeatherDetails } from "./weatherCodes";

const geocodeBaseUrl = "https://geocoding-api.open-meteo.com/v1";
const forecastBaseUrl = "https://api.open-meteo.com/v1/forecast";
const airQualityBaseUrl = "https://air-quality-api.open-meteo.com/v1/air-quality";
const recentLocationsStorageKey = "skycast-recent-locations";
const maxPastWeatherDays = 92;
const maxFutureWeatherDays = 16;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatDisplayDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

function formatDisplayTime(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatHourLabel(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
  }).format(new Date(timestamp));
}

function formatDurationHours(seconds) {
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatFullDisplayDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function formatInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value) {
  return new Date(`${value}T12:00:00`);
}

function getTodayDateValue() {
  return formatInputDate(new Date());
}

function shiftIsoDate(value, days) {
  const shiftedDate = parseIsoDate(value);
  shiftedDate.setDate(shiftedDate.getDate() + days);
  return formatInputDate(shiftedDate);
}

function compareIsoDate(left, right) {
  return left.localeCompare(right);
}

function clampIsoDate(value, minDate, maxDate) {
  if (compareIsoDate(value, minDate) < 0) {
    return minDate;
  }

  if (compareIsoDate(value, maxDate) > 0) {
    return maxDate;
  }

  return value;
}

function getDateDifferenceInDays(referenceDate, targetDate) {
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  return Math.round((parseIsoDate(targetDate) - parseIsoDate(referenceDate)) / millisecondsPerDay);
}

function buildDateWindow(selectedDate, minDate, maxDate, windowSize = 5) {
  let startDate = shiftIsoDate(selectedDate, -Math.floor(windowSize / 2));
  let endDate = shiftIsoDate(startDate, windowSize - 1);

  if (compareIsoDate(startDate, minDate) < 0) {
    startDate = minDate;
    endDate = shiftIsoDate(startDate, windowSize - 1);
  }

  if (compareIsoDate(endDate, maxDate) > 0) {
    endDate = maxDate;
    startDate = shiftIsoDate(endDate, -(windowSize - 1));
  }

  return {
    startDate: clampIsoDate(startDate, minDate, maxDate),
    endDate: clampIsoDate(endDate, minDate, maxDate),
  };
}

function buildLocationLabel(location) {
  return [location.name, location.admin1, location.country].filter(Boolean).join(", ");
}

function normalizeLocationText(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function loadRecentLocationsFromStorage() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(recentLocationsStorageKey);

    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue) ? parsedValue.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function mergeRecentLocations(existingLocations, nextLocation) {
  const uniqueLocations = [
    nextLocation,
    ...existingLocations.filter(
      (location) =>
        !(
          location.label === nextLocation.label &&
          location.latitude === nextLocation.latitude &&
          location.longitude === nextLocation.longitude
        ),
    ),
  ];

  return uniqueLocations.slice(0, 6);
}

function buildLocationVariants(location) {
  const variants = [
    [location.name, location.admin1, location.country],
    [location.name, location.admin2, location.admin1, location.country],
    [location.name, location.admin3, location.admin2, location.admin1, location.country],
    [location.name, location.country],
    [location.name],
  ];

  return [...new Set(variants.map((parts) => parts.filter(Boolean).join(", ")).filter(Boolean))];
}

function findMatchingLocation(query, locations) {
  const normalizedQuery = normalizeLocationText(query);
  const queryParts = normalizedQuery.split(",").map((part) => part.trim()).filter(Boolean);

  return (
    locations.find((location) =>
      buildLocationVariants(location).some(
        (variant) => normalizeLocationText(variant) === normalizedQuery,
      ),
    ) ??
    locations.find((location) => {
      const searchableParts = [
        location.name,
        location.admin1,
        location.admin2,
        location.admin3,
        location.country,
      ]
        .filter(Boolean)
        .map((part) => normalizeLocationText(part));

      return queryParts.every((part) => searchableParts.includes(part));
    }) ??
    null
  );
}

function getCompassDirection(degrees) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % directions.length];
}

function getAqiDetails(aqi) {
  if (aqi == null) {
    return {
      label: "Unavailable",
      tone: "unknown",
      summary: "Air quality data is not available for this location right now.",
    };
  }

  if (aqi <= 50) {
    return {
      label: "Good",
      tone: "good",
      summary: "Air is clean and comfortable for long stretches outside.",
    };
  }

  if (aqi <= 100) {
    return {
      label: "Moderate",
      tone: "moderate",
      summary: "Most people are fine outside, though sensitive groups may notice it.",
    };
  }

  if (aqi <= 150) {
    return {
      label: "Sensitive",
      tone: "sensitive",
      summary: "Sensitive groups should take it a bit easier outdoors.",
    };
  }

  if (aqi <= 200) {
    return {
      label: "Unhealthy",
      tone: "unhealthy",
      summary: "Air quality is rough enough to limit longer outdoor plans.",
    };
  }

  return {
    label: "Hazardous",
    tone: "hazardous",
    summary: "Best move is to stay indoors unless you really need to go out.",
  };
}

function getOutdoorScoreLabel(score) {
  if (score >= 82) {
    return "Prime";
  }

  if (score >= 65) {
    return "Easy";
  }

  if (score >= 48) {
    return "Mixed";
  }

  return "Rugged";
}

function scoreOutdoorConditions({ feelsLike, precipitationChance, windSpeed, aqi, uvIndex, isDay }) {
  let score = 92;

  score -= Math.abs(feelsLike - 20) * 1.9;
  score -= precipitationChance * 0.35;
  score -= windSpeed * 0.8;
  score -= Math.max((aqi ?? 50) - 40, 0) * 0.28;

  if (isDay && uvIndex > 6) {
    score -= (uvIndex - 6) * 4;
  }

  return clamp(Math.round(score), 0, 100);
}

function getDaylightProgress(currentTime, sunrise, sunset, isToday) {
  const current = new Date(currentTime).getTime();
  const start = new Date(sunrise).getTime();
  const end = new Date(sunset).getTime();

  if (Number.isNaN(current) || Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return {
      progress: 0,
      message: "Sun timing is not available.",
    };
  }

  if (current <= start) {
    return {
      progress: 0,
      message: isToday ? "Sunrise is still ahead." : "This snapshot lands before sunrise.",
    };
  }

  if (current >= end) {
    return {
      progress: 100,
      message: isToday ? "The sun has already set for today." : "This snapshot lands after sunset.",
    };
  }

  const progress = ((current - start) / (end - start)) * 100;
  return {
    progress,
    message: isToday
      ? `${Math.round(progress)}% of daylight has passed.`
      : `${Math.round(progress)}% of daylight had unfolded by this snapshot.`,
  };
}

function buildSparkline(values, width, height, padding = 16) {
  if (!values.length) {
    return { line: "", area: "", min: 0, max: 0 };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((value, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(values.length - 1, 1);
    const y =
      height -
      padding -
      ((value - min) / range) * (height - padding * 2);

    return { x, y };
  });

  const line = points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ");

  const area = [
    line,
    `L ${points[points.length - 1].x.toFixed(2)} ${(height - padding).toFixed(2)}`,
    `L ${points[0].x.toFixed(2)} ${(height - padding).toFixed(2)}`,
    "Z",
  ].join(" ");

  return { line, area, min, max };
}

async function fetchLocationsByQuery(query, count, signal) {
  const url = new URL(`${geocodeBaseUrl}/search`);
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error("Location search is unavailable right now.");
  }

  const data = await response.json();
  return data.results ?? [];
}

async function fetchWeatherByCoordinates(
  latitude,
  longitude,
  { startDate, endDate, includeCurrent },
  signal,
) {
  const url = new URL(forecastBaseUrl);
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);

  if (includeCurrent) {
    url.searchParams.set(
      "current",
      [
        "temperature_2m",
        "relative_humidity_2m",
        "apparent_temperature",
        "is_day",
        "precipitation",
        "weather_code",
        "wind_speed_10m",
        "wind_gusts_10m",
        "wind_direction_10m",
        "cloud_cover",
      ].join(","),
    );
  }

  url.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "precipitation_probability",
      "weather_code",
      "wind_speed_10m",
      "wind_gusts_10m",
      "wind_direction_10m",
      "cloud_cover",
      "uv_index",
      "is_day",
    ].join(","),
  );
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "sunrise",
      "sunset",
      "daylight_duration",
      "sunshine_duration",
      "uv_index_max",
      "wind_speed_10m_max",
      "precipitation_sum",
    ].join(","),
  );
  url.searchParams.set("timezone", "auto");

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error("Weather service is unavailable right now.");
  }

  return response.json();
}

async function fetchAirQualityByCoordinates(latitude, longitude, date, signal) {
  const url = new URL(airQualityBaseUrl);
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("current", "us_aqi,pm2_5");
  url.searchParams.set("hourly", "us_aqi,pm2_5");
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);
  url.searchParams.set("timezone", "auto");

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error("Air quality service is unavailable right now.");
  }

  return response.json();
}

async function fetchLocationByQuery(query, signal) {
  const results = await fetchLocationsByQuery(query, 1, signal);
  return results[0] ?? null;
}

async function resolveLocationByQuery(query, signal) {
  const directMatch = await fetchLocationByQuery(query, signal);

  if (directMatch) {
    return directMatch;
  }

  const queryParts = query.split(",").map((part) => part.trim()).filter(Boolean);

  if (queryParts.length <= 1) {
    return null;
  }

  const broaderMatches = await fetchLocationsByQuery(queryParts[0], 20, signal);
  return findMatchingLocation(query, broaderMatches);
}

async function fetchLocationByCoordinates(latitude, longitude, signal) {
  const url = new URL(`${geocodeBaseUrl}/reverse`);
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url, { signal });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data.results?.[0] ?? null;
}

function summarizeForecast(daily) {
  return daily.time.map((date, index) => ({
    date,
    weatherCode: daily.weather_code[index],
    high: Math.round(daily.temperature_2m_max[index]),
    low: Math.round(daily.temperature_2m_min[index]),
    precipitationChance: daily.precipitation_probability_max[index],
    sunrise: daily.sunrise[index],
    sunset: daily.sunset[index],
    daylightHours: formatDurationHours(daily.daylight_duration[index]),
    sunshineHours: formatDurationHours(daily.sunshine_duration[index]),
    uvMax: Math.round(daily.uv_index_max[index]),
    windMax: Math.round(daily.wind_speed_10m_max[index]),
    precipitationTotal: Math.round(daily.precipitation_sum[index] * 10) / 10,
  }));
}

function summarizeHourly(hourly, airQualityHourly) {
  return hourly.time.map((time, index) => ({
    time,
    temperature: Math.round(hourly.temperature_2m[index]),
    humidity: Math.round(hourly.relative_humidity_2m[index]),
    feelsLike: Math.round(hourly.apparent_temperature[index]),
    precipitation: Math.round((hourly.precipitation[index] ?? 0) * 10) / 10,
    precipitationChance: hourly.precipitation_probability[index],
    weatherCode: hourly.weather_code[index],
    windSpeed: Math.round(hourly.wind_speed_10m[index]),
    windGusts: Math.round(hourly.wind_gusts_10m[index]),
    windDirection: getCompassDirection(hourly.wind_direction_10m[index]),
    cloudCover: hourly.cloud_cover[index],
    uvIndex: Math.round(hourly.uv_index[index] ?? 0),
    isDay: Boolean(hourly.is_day[index]),
    aqi: airQualityHourly?.us_aqi?.[index] ?? null,
    pm25:
      airQualityHourly?.pm2_5?.[index] != null
        ? Math.round(airQualityHourly.pm2_5[index] * 10) / 10
        : null,
  }));
}

function selectSnapshotHour(hourlyForecast, selectedDate, isToday) {
  if (!hourlyForecast.length) {
    return null;
  }

  const targetTime = isToday ? Date.now() : new Date(`${selectedDate}T12:00:00`).getTime();

  return hourlyForecast.reduce((closestHour, hour) => {
    if (!closestHour) {
      return hour;
    }

    const currentDelta = Math.abs(new Date(hour.time).getTime() - targetTime);
    const closestDelta = Math.abs(new Date(closestHour.time).getTime() - targetTime);
    return currentDelta < closestDelta ? hour : closestHour;
  }, null);
}

function selectBestWindow(hourlyForecast, isToday) {
  let windowCandidates = hourlyForecast;

  if (isToday) {
    const now = Date.now();
    windowCandidates = hourlyForecast
      .filter((hour) => new Date(hour.time).getTime() >= now - 30 * 60 * 1000)
      .slice(0, 12);

    if (!windowCandidates.length) {
      windowCandidates = hourlyForecast.slice(-12);
    }
  } else {
    const daylightCandidates = hourlyForecast.filter((hour) => hour.isDay);
    windowCandidates = daylightCandidates.length ? daylightCandidates : hourlyForecast;
  }

  if (!windowCandidates.length) {
    return null;
  }

  const rankedCandidates = windowCandidates
    .map((hour) => ({
      ...hour,
      score: scoreOutdoorConditions({
        feelsLike: hour.feelsLike,
        precipitationChance: hour.precipitationChance,
        windSpeed: hour.windSpeed,
        aqi: hour.aqi,
        uvIndex: hour.uvIndex,
        isDay: hour.isDay,
      }),
    }))
    .sort((left, right) => right.score - left.score);

  return rankedCandidates[0] ?? null;
}

function buildDateSelection(selectedDate, todayDate, snapshotTime) {
  const dayDifference = getDateDifferenceInDays(todayDate, selectedDate);
  const relativeLabel =
    dayDifference === 0
      ? "Today"
      : dayDifference === 1
        ? "Tomorrow"
        : dayDifference === -1
          ? "Yesterday"
          : formatFullDisplayDate(selectedDate);

  return {
    date: selectedDate,
    displayDate: formatFullDisplayDate(selectedDate),
    shortLabel: relativeLabel,
    isToday: dayDifference === 0,
    currentCardLabel: dayDifference === 0 ? "Now in" : "Selected day in",
    timestampLabel:
      dayDifference === 0
        ? `Live at ${formatDisplayTime(snapshotTime)}`
        : `${formatFullDisplayDate(selectedDate)} · Snapshot ${formatDisplayTime(snapshotTime)}`,
    studioHeading:
      dayDifference === 0
        ? "Today by the hour"
        : `${formatDisplayDate(selectedDate)} by the hour`,
  };
}

function buildWeatherStory(current, today, airQualityDetails, bestWindow, outdoorScore, selection) {
  const temperatureTone =
    current.feelsLike <= 0
      ? "crisp"
      : current.feelsLike <= 10
        ? "cool"
        : current.feelsLike <= 24
          ? "balanced"
          : "warm";

  const windowCopy = bestWindow
    ? `Best outdoor window is around ${formatHourLabel(bestWindow.time)}.`
    : selection.isToday
      ? "The next few hours are still stabilizing."
      : "The strongest stretch is still a little harder to call.";

  return {
    headline: `${temperatureTone[0].toUpperCase()}${temperatureTone.slice(1)} conditions for ${selection.shortLabel.toLowerCase()}, ${outdoorScore.label.toLowerCase()} outdoor momentum.`,
    summary: `${current.summary} ${
      selection.isToday ? "right now" : `around ${formatDisplayTime(current.time)}`
    } with a high of ${today.high}&deg;C, ${today.precipitationChance}% rain risk, and ${airQualityDetails.label.toLowerCase()} air. ${windowCopy}`,
  };
}

function buildConciergeItems(current, today, airQualityDetails, bestWindow, outdoorScore, selection) {
  const wardrobeCopy =
    current.feelsLike <= 2
      ? "Reach for a proper layer stack. It will feel colder than the headline temperature."
      : current.feelsLike <= 12
        ? "A light jacket or overshirt will make this feel much more comfortable."
        : current.feelsLike <= 24
          ? "Easy outfit territory. You can keep it light and comfortable."
          : "Dress airy, keep water close, and stay ahead of the heat.";

  const bestWindowCopy = bestWindow
    ? `${formatHourLabel(bestWindow.time)} looks strongest with ${bestWindow.temperature}&deg;C, ${bestWindow.precipitationChance}% rain risk, and ${bestWindow.windSpeed} km/h wind.`
    : "The next few hours are still shifting, so it is worth checking back soon.";

  const airCopy =
    airQualityDetails.tone === "good"
      ? "Air is in good shape for a run, walk, or long coffee break outside."
      : airQualityDetails.tone === "moderate"
        ? "Air is decent overall, but sensitive groups may want shorter stretches outside."
        : `${airQualityDetails.summary} If you have a long outdoor plan, keep it flexible.`;

  return [
    {
      title: "Wardrobe",
      body: wardrobeCopy,
    },
    {
      title: "Planner",
      body: `${bestWindowCopy} Overall outdoor score for ${selection.shortLabel.toLowerCase()} is ${outdoorScore.value}/100.`,
    },
    {
      title: "Air & Light",
      body: `${airCopy} UV peaks near ${today.uvMax}, so midday exposure deserves some respect.`,
    },
  ];
}

export default function App() {
  const todayDate = getTodayDateValue();
  const minSelectableDate = shiftIsoDate(todayDate, -maxPastWeatherDays);
  const maxSelectableDate = shiftIsoDate(todayDate, maxFutureWeatherDays);
  const [query, setQuery] = useState("Toronto");
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [recentLocations, setRecentLocations] = useState(loadRecentLocationsFromStorage);
  const [activeLocation, setActiveLocation] = useState(null);
  const activeRequest = useRef(null);
  const activeSuggestionRequest = useRef(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(recentLocationsStorageKey, JSON.stringify(recentLocations));
  }, [recentLocations]);

  async function loadWeather({ search, latitude, longitude, sourceLabel, date = selectedDate }) {
    activeRequest.current?.abort();

    const controller = new AbortController();
    activeRequest.current = controller;
    const requestedDate = clampIsoDate(date, minSelectableDate, maxSelectableDate);

    setLoading(true);
    setError("");
    setSelectedDate(requestedDate);

    try {
      let location = null;

      if (typeof latitude === "number" && typeof longitude === "number") {
        location = sourceLabel
          ? { name: sourceLabel }
          : await fetchLocationByCoordinates(latitude, longitude, controller.signal);

        if (!location) {
          location = {
            name: "Current location",
            latitude,
            longitude,
          };
        }
      } else {
        location = await resolveLocationByQuery(search, controller.signal);
      }

      if (!location) {
        throw new Error("No matching location was found. Try a different city.");
      }

      const { startDate, endDate } = buildDateWindow(
        requestedDate,
        minSelectableDate,
        maxSelectableDate,
      );
      const isToday = requestedDate === todayDate;
      const forecast = await fetchWeatherByCoordinates(
        location.latitude ?? latitude,
        location.longitude ?? longitude,
        { startDate, endDate, includeCurrent: isToday },
        controller.signal,
      );
      const airQuality = await fetchAirQualityByCoordinates(
        location.latitude ?? latitude,
        location.longitude ?? longitude,
        requestedDate,
        controller.signal,
      ).catch(() => null);
      const dailyForecast = summarizeForecast(forecast.daily);
      const selectedDay = dailyForecast.find((day) => day.date === requestedDate) ?? dailyForecast[0];
      const hourlyForecast = summarizeHourly(forecast.hourly, airQuality?.hourly).filter((hour) =>
        hour.time.startsWith(requestedDate),
      );

      if (!selectedDay || !hourlyForecast.length) {
        throw new Error("Weather for that date is unavailable right now.");
      }

      const snapshotHour = selectSnapshotHour(hourlyForecast, requestedDate, isToday);

      if (!snapshotHour) {
        throw new Error("Weather for that date is unavailable right now.");
      }

      const useLiveCurrent = Boolean(isToday && forecast.current);
      const selectedAirQuality =
        isToday && airQuality?.current?.us_aqi != null
          ? {
              aqi: Math.round(airQuality.current.us_aqi),
              pm25: Math.round(airQuality.current.pm2_5 * 10) / 10,
            }
          : snapshotHour.aqi != null
            ? {
                aqi: Math.round(snapshotHour.aqi),
                pm25: snapshotHour.pm25,
              }
            : null;
      const currentWeatherCode = isToday
        ? forecast.current?.weather_code ?? snapshotHour.weatherCode
        : snapshotHour.weatherCode;
      const details = getWeatherDetails(currentWeatherCode);
      const bestWindow = selectBestWindow(hourlyForecast, isToday);
      const airQualityDetails = getAqiDetails(
        selectedAirQuality?.aqi ?? null,
      );
      const currentConditions = useLiveCurrent
        ? {
            temperature: Math.round(forecast.current.temperature_2m),
            feelsLike: Math.round(forecast.current.apparent_temperature),
            humidity: forecast.current.relative_humidity_2m,
            windSpeed: Math.round(forecast.current.wind_speed_10m),
            windGusts: Math.round(forecast.current.wind_gusts_10m),
            windDirection: getCompassDirection(forecast.current.wind_direction_10m),
            precipitation: forecast.current.precipitation,
            isDay: Boolean(forecast.current.is_day),
            summary: details.label,
            accent: details.accent,
            cloudCover: forecast.current.cloud_cover,
            time: forecast.current.time,
          }
        : {
            temperature: snapshotHour.temperature,
            feelsLike: snapshotHour.feelsLike,
            humidity: snapshotHour.humidity,
            windSpeed: snapshotHour.windSpeed,
            windGusts: snapshotHour.windGusts,
            windDirection: snapshotHour.windDirection,
            precipitation: snapshotHour.precipitation,
            isDay: snapshotHour.isDay,
            summary: details.label,
            accent: details.accent,
            cloudCover: snapshotHour.cloudCover,
            time: snapshotHour.time,
          };
      const selection = buildDateSelection(requestedDate, todayDate, currentConditions.time);
      const outdoorScoreValue = scoreOutdoorConditions({
        feelsLike: currentConditions.feelsLike,
        precipitationChance: selectedDay.precipitationChance ?? 0,
        windSpeed: currentConditions.windSpeed,
        aqi: selectedAirQuality?.aqi ?? null,
        uvIndex: selectedDay.uvMax ?? 0,
        isDay: currentConditions.isDay,
      });
      const outdoorScore = {
        value: outdoorScoreValue,
        label: getOutdoorScoreLabel(outdoorScoreValue),
        summary:
          outdoorScoreValue >= 70
            ? "This day has real momentum for outside plans."
            : outdoorScoreValue >= 50
              ? "A little planning will make the day feel much better."
              : "This is a day to be selective about your outside time.",
      };
      const story = buildWeatherStory(
        {
          summary: details.label,
          feelsLike: currentConditions.feelsLike,
          time: currentConditions.time,
        },
        selectedDay,
        airQualityDetails,
        bestWindow,
        outdoorScore,
        selection,
      );
      const concierge = buildConciergeItems(
        {
          feelsLike: currentConditions.feelsLike,
        },
        selectedDay,
        airQualityDetails,
        bestWindow,
        outdoorScore,
        selection,
      );
      const locationName = buildLocationLabel(location);
      const recentLocation = {
        label: locationName,
        latitude: location.latitude ?? latitude,
        longitude: location.longitude ?? longitude,
      };

      setWeather({
        locationName,
        selection,
        coordinates: {
          latitude: location.latitude ?? latitude,
          longitude: location.longitude ?? longitude,
        },
        current: currentConditions,
        today: selectedDay,
        forecast: dailyForecast,
        hourly: hourlyForecast,
        airQuality: selectedAirQuality
          ? {
              ...selectedAirQuality,
              details: airQualityDetails,
            }
          : null,
        outdoorScore,
        daylight: getDaylightProgress(
          currentConditions.time,
          selectedDay.sunrise,
          selectedDay.sunset,
          isToday,
        ),
        bestWindow,
        story,
        concierge,
      });

      setQuery(locationName);
      setActiveLocation(recentLocation);

      if (locationName !== "Current location") {
        setRecentLocations((currentRecentLocations) =>
          mergeRecentLocations(currentRecentLocations, recentLocation),
        );
      }
    } catch (loadError) {
      if (loadError.name !== "AbortError") {
        setError(loadError.message || "Something went wrong while loading the forecast.");
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadWeather({ search: "Toronto", date: todayDate });

    return () => {
      activeRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    const trimmedQuery = deferredQuery.trim();

    if (trimmedQuery.length < 2) {
      activeSuggestionRequest.current?.abort();
      activeSuggestionRequest.current = null;
      setSuggestions([]);
      return;
    }

    activeSuggestionRequest.current?.abort();

    const controller = new AbortController();
    activeSuggestionRequest.current = controller;

    const timeoutId = window.setTimeout(async () => {
      try {
        const results = await fetchLocationsByQuery(trimmedQuery, 8, controller.signal);
        startTransition(() => {
          setSuggestions(results);
        });
      } catch (suggestionError) {
        if (suggestionError.name !== "AbortError") {
          startTransition(() => {
            setSuggestions([]);
          });
        }
      } finally {
        if (activeSuggestionRequest.current === controller) {
          activeSuggestionRequest.current = null;
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();

      if (activeSuggestionRequest.current === controller) {
        activeSuggestionRequest.current = null;
      }
    };
  }, [deferredQuery]);

  function handleSearchSubmit(event) {
    event.preventDefault();
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setError("Enter a city name to see the forecast.");
      return;
    }

    const matchedSuggestion = suggestions.find(
      (location) => buildLocationLabel(location).toLowerCase() === trimmedQuery.toLowerCase(),
    );

    if (matchedSuggestion) {
      loadWeather({
        latitude: matchedSuggestion.latitude,
        longitude: matchedSuggestion.longitude,
        sourceLabel: buildLocationLabel(matchedSuggestion),
        date: selectedDate,
      });
      return;
    }

    loadWeather({ search: trimmedQuery, date: selectedDate });
  }

  function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported in this browser.");
      return;
    }

    setLoading(true);
    setError("");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        loadWeather({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          date: selectedDate,
        });
      },
      () => {
        setLoading(false);
        setError("Location access was denied. Search for a city instead.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function handleRecentLocationSelect(location) {
    setQuery(location.label);
    loadWeather({
      latitude: location.latitude,
      longitude: location.longitude,
      sourceLabel: location.label,
      date: selectedDate,
    });
  }

  function handleDateSelection(nextDate) {
    if (!nextDate) {
      return;
    }

    const normalizedDate = clampIsoDate(nextDate, minSelectableDate, maxSelectableDate);

    if (activeLocation) {
      loadWeather({
        latitude: activeLocation.latitude,
        longitude: activeLocation.longitude,
        sourceLabel: activeLocation.label,
        date: normalizedDate,
      });
      return;
    }

    loadWeather({
      search: query.trim() || "Toronto",
      date: normalizedDate,
    });
  }

  const accentClass = weather ? `theme-${weather.current.accent}` : "theme-cloudy";
  const sparkline = weather
    ? buildSparkline(weather.hourly.map((hour) => hour.temperature), 480, 160)
    : null;

  return (
    <main className={`app-shell ${accentClass}`}>
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />

      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">SkyCast Weather Studio</p>
          <h1>Weather with atmosphere and smarter timing.</h1>
          <p className="intro">
            Search any city to see live conditions, date-based forecasts, air quality,
            and the best window for getting outside.
          </p>
        </div>

        <div className="hero-controls">
          <form className="search-bar" onSubmit={handleSearchSubmit}>
            <label className="sr-only" htmlFor="city-search">
              Search city
            </label>
            <input
              id="city-search"
              type="text"
              list="location-suggestions"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search city"
              autoComplete="off"
            />
            <datalist id="location-suggestions">
              {suggestions.map((location) => {
                const label = buildLocationLabel(location);

                return <option key={`${location.id}-${location.latitude}-${location.longitude}`} value={label} />;
              })}
            </datalist>

            <button type="submit" disabled={loading}>
              {loading ? "Loading..." : "Search"}
            </button>
          </form>

          <div className="date-toolbar">
            <div className="date-field">
              <label htmlFor="weather-date">Choose a date</label>
              <input
                id="weather-date"
                type="date"
                value={selectedDate}
                min={minSelectableDate}
                max={maxSelectableDate}
                onChange={(event) => handleDateSelection(event.target.value)}
              />
            </div>

            <div className="date-button-row">
              <button
                className="date-button"
                type="button"
                onClick={() => handleDateSelection(shiftIsoDate(selectedDate, -1))}
                disabled={loading || selectedDate === minSelectableDate}
              >
                Previous day
              </button>
              <button
                className="date-button"
                type="button"
                onClick={() => handleDateSelection(todayDate)}
                disabled={loading || selectedDate === todayDate}
              >
                Today
              </button>
              <button
                className="date-button"
                type="button"
                onClick={() => handleDateSelection(shiftIsoDate(selectedDate, 1))}
                disabled={loading || selectedDate === maxSelectableDate}
              >
                Next day
              </button>
            </div>
          </div>

          <p className="date-hint">
            Browse weather from {formatFullDisplayDate(minSelectableDate)} through{" "}
            {formatFullDisplayDate(maxSelectableDate)}.
          </p>

          <div className="hero-actions">
            <button className="location-button" type="button" onClick={handleUseCurrentLocation}>
              Use my location
            </button>

            {recentLocations.length ? (
              <div className="recent-strip">
                <span className="recent-label">Recent</span>
                {recentLocations.map((location) => (
                  <button
                    className="recent-chip"
                    key={`${location.label}-${location.latitude}-${location.longitude}`}
                    type="button"
                    onClick={() => handleRecentLocationSelect(location)}
                  >
                    {location.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {error ? <p className="status-message error-message">{error}</p> : null}

      {weather ? (
        <>
          <section className="current-weather-card surface">
            <div className="current-weather-header">
              <div>
                <p className="section-label">{weather.selection.currentCardLabel}</p>
                <h2>{weather.locationName}</h2>
                <p className="current-time">{weather.selection.timestampLabel}</p>
              </div>
              <span className="summary-badge">{weather.current.summary}</span>
            </div>

            <div className="temperature-shell">
              <div className="temperature-column">
                <p className="temperature-value">
                  {weather.current.temperature}&deg;C
                </p>
                <p className="temperature-subtitle">
                  Feels like {weather.current.feelsLike}&deg;C
                </p>
                <p className="story-headline">{weather.story.headline}</p>
                <p
                  className="story-copy"
                  dangerouslySetInnerHTML={{ __html: weather.story.summary }}
                />
              </div>

              <div className="conditions-grid">
                <article>
                  <span>Humidity</span>
                  <strong>{weather.current.humidity}%</strong>
                </article>
                <article>
                  <span>Wind</span>
                  <strong>
                    {weather.current.windSpeed} km/h {weather.current.windDirection}
                  </strong>
                </article>
                <article>
                  <span>Gusts</span>
                  <strong>{weather.current.windGusts} km/h</strong>
                </article>
                <article>
                  <span>Cloud cover</span>
                  <strong>{weather.current.cloudCover}%</strong>
                </article>
                <article>
                  <span>UV max</span>
                  <strong>{weather.today.uvMax}</strong>
                </article>
                <article>
                  <span>Rain chance</span>
                  <strong>{weather.today.precipitationChance}%</strong>
                </article>
              </div>
            </div>
          </section>

          <section className="signal-grid">
            <article className="signal-card score-card surface">
              <p className="section-label">Outdoor Score</p>
              <div className="score-value">
                <strong>{weather.outdoorScore.value}</strong>
                <span>{weather.outdoorScore.label}</span>
              </div>
              <p className="signal-copy">{weather.outdoorScore.summary}</p>
            </article>

            <article
              className={`signal-card air-card surface ${
                weather.airQuality ? `aqi-${weather.airQuality.details.tone}` : "aqi-unknown"
              }`}
            >
              <p className="section-label">Air Quality</p>
              {weather.airQuality ? (
                <>
                  <div className="air-row">
                    <strong>{weather.airQuality.aqi}</strong>
                    <span>{weather.airQuality.details.label}</span>
                  </div>
                  <p className="signal-copy">
                    PM2.5 is {weather.airQuality.pm25} ug/m3. {weather.airQuality.details.summary}
                  </p>
                </>
              ) : (
                <p className="signal-copy">
                  Air quality is unavailable, but the rest of the forecast is still live.
                </p>
              )}
            </article>

            <article className="signal-card daylight-card surface">
              <p className="section-label">Daylight Arc</p>
              <div className="daylight-track">
                <span style={{ width: `${weather.daylight.progress}%` }} />
              </div>
              <div className="daylight-meta">
                <span>Sunrise {formatDisplayTime(weather.today.sunrise)}</span>
                <span>Sunset {formatDisplayTime(weather.today.sunset)}</span>
              </div>
              <p className="signal-copy">
                {weather.daylight.message} {weather.today.sunshineHours} of likely sunshine today.
              </p>
            </article>
          </section>

          <section className="studio-grid">
            <article className="timeline-card surface">
              <div className="card-header">
                <div>
                  <p className="section-label">Weather Studio</p>
                  <h3>{weather.selection.studioHeading}</h3>
                </div>
                <div className="window-pill">
                  {weather.bestWindow
                    ? `Best window ${formatHourLabel(weather.bestWindow.time)}`
                    : "Watching the next move"}
                </div>
              </div>

              {sparkline ? (
                <div className="sparkline-shell">
                  <svg
                    className="sparkline"
                    viewBox="0 0 480 160"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path className="sparkline-area" d={sparkline.area} />
                    <path className="sparkline-line" d={sparkline.line} />
                  </svg>
                  <div className="sparkline-scale">
                    <span>{sparkline.min}&deg;C</span>
                    <span>{sparkline.max}&deg;C</span>
                  </div>
                </div>
              ) : null}

              <div className="hourly-strip">
                {weather.hourly.slice(0, 12).map((hour) => {
                  const details = getWeatherDetails(hour.weatherCode);

                  return (
                    <article className="hour-card" key={hour.time}>
                      <p className="hour-time">{formatHourLabel(hour.time)}</p>
                      <strong className="hour-temp">{hour.temperature}&deg;</strong>
                      <span className="hour-label">{details.label}</span>
                      <span className="hour-meta">Rain {hour.precipitationChance}%</span>
                      <span className="hour-meta">Wind {hour.windSpeed} km/h</span>
                      <span className="hour-meta">
                        AQI {hour.aqi != null ? Math.round(hour.aqi) : "--"}
                      </span>
                    </article>
                  );
                })}
              </div>
            </article>

            <article className="concierge-card surface">
              <div className="card-header">
                <div>
                  <p className="section-label">Weather Concierge</p>
                  <h3>Make the day feel easier</h3>
                </div>
              </div>

              <p className="concierge-lead">
                {weather.bestWindow
                  ? `${
                      weather.selection.isToday
                        ? "Your strongest outside window is around"
                        : `On ${weather.selection.displayDate}, the strongest outside window looks to be around`
                    } ${formatHourLabel(
                      weather.bestWindow.time,
                    )}, when the conditions look most comfortable.`
                  : weather.selection.isToday
                    ? "Conditions are moving around, so it is worth another look later today."
                    : "This day stays a little more mixed, so it helps to keep plans flexible."}
              </p>

              <div className="concierge-list">
                {weather.concierge.map((item) => (
                  <article className="concierge-item" key={item.title}>
                    <p className="concierge-title">{item.title}</p>
                    <p>{item.body}</p>
                  </article>
                ))}
              </div>
            </article>
          </section>

          <section className="forecast-grid">
            {weather.forecast.map((day, index) => {
              const details = getWeatherDetails(day.weatherCode);
              const isActiveDay = day.date === weather.selection.date;

              return (
                <button
                  className={`forecast-card ${isActiveDay ? "is-active" : ""}`}
                  key={day.date}
                  type="button"
                  style={{ animationDelay: `${index * 90}ms` }}
                  onClick={() => handleDateSelection(day.date)}
                  aria-pressed={isActiveDay}
                >
                  <p className="forecast-date">{formatDisplayDate(day.date)}</p>
                  <h3>{details.label}</h3>
                  <p className="forecast-temp">
                    {day.high}&deg; / {day.low}&deg;
                  </p>
                  <p className="forecast-meta">Rain chance: {day.precipitationChance}%</p>
                  <p className="forecast-meta">Rain total: {day.precipitationTotal} mm</p>
                  <p className="forecast-meta">UV max: {day.uvMax}</p>
                  <p className="forecast-meta">Wind max: {day.windMax} km/h</p>
                  <p className="forecast-meta">Sunshine: {day.sunshineHours}</p>
                </button>
              );
            })}
          </section>

          <p className="data-note">
            Weather and air quality data powered by Open-Meteo.
          </p>
        </>
      ) : (
        <p className="status-message">Search for a city to load the forecast.</p>
      )}
    </main>
  );
}
