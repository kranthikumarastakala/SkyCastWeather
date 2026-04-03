import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import PremiumDatePicker from "./components/PremiumDatePicker";
import { getWeatherDetails } from "./weatherCodes";

const geocodeBaseUrl = "https://geocoding-api.open-meteo.com/v1";
const forecastBaseUrl = "https://api.open-meteo.com/v1/forecast";
const airQualityBaseUrl = "https://air-quality-api.open-meteo.com/v1/air-quality";
const recentLocationsStorageKey = "skycast-recent-locations";
const maxPastWeatherDays = 92;
const maxFutureWeatherDays = 16;
const usStateAbbreviations = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "District of Columbia": "DC",
  "Puerto Rico": "PR",
  Guam: "GU",
  "American Samoa": "AS",
  "Northern Mariana Islands": "MP",
  "United States Virgin Islands": "VI",
  "U.S. Virgin Islands": "VI",
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatDisplayDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(parseIsoDate(date));
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
  return [location.name, getAdminAreaLabel(location), location.country].filter(Boolean).join(", ");
}

function normalizeLocationText(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isUnitedStatesLocation(location) {
  if (!location) {
    return false;
  }

  if (typeof location.country_code === "string" && location.country_code.toUpperCase() === "US") {
    return true;
  }

  const normalizedCountry = normalizeLocationText(location.country ?? "");
  return (
    normalizedCountry === "united states" ||
    normalizedCountry === "united states of america" ||
    normalizedCountry === "usa" ||
    normalizedCountry === "us"
  );
}

function getAdminAreaLabel(location) {
  if (!location?.admin1 || !isUnitedStatesLocation(location)) {
    return location?.admin1;
  }

  return usStateAbbreviations[location.admin1] ?? location.admin1;
}

function normalizeStoredLocationLabel(label) {
  if (typeof label !== "string") {
    return label;
  }

  const parts = label.split(",").map((part) => part.trim()).filter(Boolean);

  if (parts.length < 3) {
    return label;
  }

  const country = parts[parts.length - 1];
  const adminAreaIndex = parts.length - 2;
  const abbreviation = isUnitedStatesLocation({ country })
    ? usStateAbbreviations[parts[adminAreaIndex]]
    : null;

  if (!abbreviation) {
    return label;
  }

  const normalizedParts = [...parts];
  normalizedParts[adminAreaIndex] = abbreviation;
  return normalizedParts.join(", ");
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

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .filter((location) => location && typeof location === "object")
      .slice(0, 6)
      .map((location) => ({
        ...location,
        label: normalizeStoredLocationLabel(location.label),
      }));
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
    { parts: [location.name, location.admin1, location.country], adminAreaIndex: 1 },
    { parts: [location.name, location.admin2, location.admin1, location.country], adminAreaIndex: 2 },
    {
      parts: [location.name, location.admin3, location.admin2, location.admin1, location.country],
      adminAreaIndex: 3,
    },
    { parts: [location.name, location.country], adminAreaIndex: -1 },
    { parts: [location.name], adminAreaIndex: -1 },
  ];

  const adminAreaLabel = getAdminAreaLabel(location);

  return [
    ...new Set(
      variants
        .flatMap(({ parts, adminAreaIndex }) => {
          const compactParts = parts.filter(Boolean);

          if (!compactParts.length) {
            return [];
          }

          const labels = [compactParts.join(", ")];
          const hasAdminArea = adminAreaIndex >= 0 && Boolean(parts[adminAreaIndex]);

          if (
            hasAdminArea &&
            adminAreaLabel &&
            adminAreaLabel !== location.admin1
          ) {
            const compactAdminAreaIndex = parts.slice(0, adminAreaIndex).filter(Boolean).length;
            const abbreviatedParts = [...compactParts];
            abbreviatedParts[compactAdminAreaIndex] = adminAreaLabel;
            labels.push(abbreviatedParts.join(", "));
          }

          return labels;
        })
        .filter(Boolean),
    ),
  ];
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
        getAdminAreaLabel(location),
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

function isNetworkFetchError(error) {
  return error instanceof TypeError || error?.message === "Failed to fetch";
}

async function fetchJson(url, signal, errorMessage, { allowFailure = false } = {}) {
  try {
    const response = await fetch(url, { signal });

    if (!response.ok) {
      if (allowFailure) {
        return null;
      }

      throw new Error(errorMessage);
    }

    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }

    if (allowFailure) {
      return null;
    }

    if (isNetworkFetchError(error)) {
      throw new Error(errorMessage);
    }

    throw error;
  }
}

async function fetchLocationsByQuery(query, count, signal) {
  const url = new URL(`${geocodeBaseUrl}/search`);
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const data = await fetchJson(
    url,
    signal,
    "Location search could not be reached. Check your connection and try again.",
  );
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

  return fetchJson(
    url,
    signal,
    "Weather data could not be reached. Check your connection and try again.",
  );
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

  return fetchJson(
    url,
    signal,
    "Air quality data could not be reached. Check your connection and try again.",
  );
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

  const data = await fetchJson(
    url,
    signal,
    "Location lookup could not be reached. Check your connection and try again.",
    { allowFailure: true },
  );
  return data.results?.[0] ?? null;
}

function requestCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function getCurrentPositionWithFallback() {
  try {
    return await requestCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5 * 60 * 1000,
    });
  } catch (error) {
    if (error?.code !== 2 && error?.code !== 3) {
      throw error;
    }

    return requestCurrentPosition({
      enableHighAccuracy: false,
      timeout: 20000,
      maximumAge: 15 * 60 * 1000,
    });
  }
}

function getGeolocationErrorMessage(error) {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Current location needs HTTPS or localhost. Open the app in a secure browser tab and try again.";
  }

  switch (error?.code) {
    case 1:
      return "Location permission is blocked for this site. Allow access in your browser settings and try again.";
    case 2:
      return "Your device could not determine a location. Check that location services are turned on and try again.";
    case 3:
      return "Location lookup took too long. Try again, or search for a city instead.";
    default:
      return "We could not get your current location right now. Search for a city instead.";
  }
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

function calculateDistanceInKilometers(fromCoordinates, toCoordinates) {
  const earthRadiusKilometers = 6371;
  const toRadians = (value) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(toCoordinates.latitude - fromCoordinates.latitude);
  const longitudeDelta = toRadians(toCoordinates.longitude - fromCoordinates.longitude);
  const fromLatitude = toRadians(fromCoordinates.latitude);
  const toLatitude = toRadians(toCoordinates.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return Math.round(earthRadiusKilometers * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)));
}

function describeTravelTemperature(feelsLike) {
  if (feelsLike <= 5) {
    return "cold";
  }

  if (feelsLike <= 14) {
    return "cool";
  }

  if (feelsLike <= 24) {
    return "comfortable";
  }

  if (feelsLike <= 31) {
    return "warm";
  }

  if (feelsLike <= 36) {
    return "hot";
  }

  return "very hot";
}

function describeStopTravelScene(stop) {
  const rainRisk = stop.today.precipitationChance ?? 0;
  const strongestWind = Math.max(stop.current.windSpeed, stop.today.windMax);
  let scene = describeTravelTemperature(stop.current.feelsLike);

  if (stop.current.accent === "storm") {
    scene += " with thunder in the mix";
  } else if (rainRisk >= 75) {
    scene += " with a strong rain threat";
  } else if (rainRisk >= 55) {
    scene += " with showers around";
  } else if (stop.current.accent === "sunny") {
    scene += " under clearer skies";
  } else if (stop.current.accent === "cloudy") {
    scene += " under a cloudier sky";
  } else {
    scene += ` with ${stop.current.summary.toLowerCase()} around`;
  }

  if (strongestWind >= 45) {
    scene += " and hard gusts";
  } else if (strongestWind >= 32) {
    scene += " and a noticeable breeze";
  }

  return scene;
}

function describeTripPressurePoint(stop) {
  const rainRisk = stop.today.precipitationChance ?? 0;
  const strongestWind = Math.max(stop.current.windSpeed, stop.today.windMax);

  if (stop.current.accent === "storm") {
    return `thunderstorm energy around ${stop.label}`;
  }

  if (rainRisk >= 75) {
    return `rain chances climbing to ${rainRisk}% near ${stop.label}`;
  }

  if (strongestWind >= 45) {
    return `gusts near ${strongestWind} km/h around ${stop.label}`;
  }

  if (stop.current.feelsLike >= 36) {
    return `heat sitting near ${stop.current.feelsLike}C around ${stop.label}`;
  }

  if (stop.current.feelsLike <= 5) {
    return `a chilly ${stop.current.feelsLike}C feel around ${stop.label}`;
  }

  if (stop.airQuality && !["good", "moderate"].includes(stop.airQuality.details.tone)) {
    return `${stop.airQuality.details.label.toLowerCase()} air quality in ${stop.label}`;
  }

  return `${stop.current.summary.toLowerCase()} around ${stop.label}`;
}

function buildTripPackingCue(fromStop, toStop) {
  const highestRainRisk = Math.max(
    fromStop.today.precipitationChance ?? 0,
    toStop.today.precipitationChance ?? 0,
  );
  const highestWind = Math.max(
    fromStop.current.windSpeed,
    toStop.current.windSpeed,
    fromStop.today.windMax,
    toStop.today.windMax,
  );
  const temperatureSwing = Math.abs(fromStop.current.feelsLike - toStop.current.feelsLike);

  if (highestRainRisk >= 60) {
    return "Keep a rain layer and something dry within easy reach.";
  }

  if (temperatureSwing >= 8) {
    return "Layers will travel better than betting on one outfit.";
  }

  if (highestWind >= 35) {
    return "Pack with the breeze in mind, especially anything light or loose.";
  }

  return "Normal packing should be enough.";
}

function buildTripReadiness(fromStop, toStop) {
  const minimumScore = Math.min(fromStop.outdoorScore.value, toStop.outdoorScore.value);
  const highestRainRisk = Math.max(
    fromStop.today.precipitationChance ?? 0,
    toStop.today.precipitationChance ?? 0,
  );
  const highestWind = Math.max(
    fromStop.current.windSpeed,
    toStop.current.windSpeed,
    fromStop.today.windMax,
    toStop.today.windMax,
  );
  const stormyStop = [fromStop, toStop].find((stop) => stop.current.accent === "storm");
  const temperatureSwing = Math.abs(fromStop.current.feelsLike - toStop.current.feelsLike);
  const fromScene = describeStopTravelScene(fromStop);
  const toScene = describeStopTravelScene(toStop);
  const arrivalIsRougher = toStop.outdoorScore.value + 8 <= fromStop.outdoorScore.value;
  const departureIsRougher = fromStop.outdoorScore.value + 8 <= toStop.outdoorScore.value;
  const harderStop = fromStop.outdoorScore.value <= toStop.outdoorScore.value ? fromStop : toStop;
  const pressurePoint = describeTripPressurePoint(harderStop);
  const packingCue = buildTripPackingCue(fromStop, toStop);

  if (stormyStop || highestRainRisk >= 75 || highestWind >= 45) {
    if (arrivalIsRougher) {
      return {
        label: "High attention",
        summary: `The route is still workable, but the sharper weather waits near ${toStop.label}. You are moving out of ${fromScene} in ${fromStop.label} and into ${toScene} closer to arrival.`,
        detail: `if you only protect one part of this run, make it the final stretch into ${toStop.label}. ${pressurePoint} is the part most likely to slow the day down, so leave buffer time and keep the grab-and-go essentials close.`,
      };
    }

    if (departureIsRougher) {
      return {
        label: "High attention",
        summary: `The hardest weather is front-loaded here. ${fromStop.label} opens ${fromScene}, then the trip loosens its grip as you move toward ${toStop.label}, which trends ${toScene}.`,
        detail: `if you leave ${fromStop.label} with patience instead of urgency, the rest of the route should feel easier. ${pressurePoint} matters more than the distance itself, and ${packingCue.toLowerCase()}`,
      };
    }

    return {
      label: "High attention",
      summary: `Weather has real influence at both ends of this trip, so this is a day to travel thoughtfully. ${fromStop.label} is shaping up ${fromScene}, and ${toStop.label} answers with ${toScene}.`,
      detail: `if this trip needs to stay on schedule, build slack into both ends. ${pressurePoint} is enough to make rigid timing frustrating, and ${packingCue.toLowerCase()}`,
    };
  }

  if (minimumScore >= 72) {
    if (arrivalIsRougher) {
      return {
        label: "Smooth trip day",
        summary: `This route still feels easy to trust, even though ${toStop.label} is a touch less forgiving than the start. You leave ${fromStop.label} in ${fromScene} and finish in ${toScene}.`,
        detail: `nothing here suggests a reroute. Just give the arrival end a little more respect than the departure, and ${packingCue.toLowerCase()}`,
      };
    }

    if (departureIsRougher) {
      return {
        label: "Smooth trip day",
        summary: `The first part of the day has a little more texture, but the route gets easier as you go. ${fromStop.label} starts ${fromScene}, while ${toStop.label} settles into ${toScene}.`,
        detail: `once you are out of the opening weather pocket, this trip should feel straightforward. ${temperatureSwing >= 8 ? `The main shift is the ${temperatureSwing}C swing between the two stops, so layers are the smart play.` : packingCue}`,
      };
    }

    return {
      label: "Smooth trip day",
      summary: `This one has a calm rhythm. ${fromStop.label} and ${toStop.label} both look travel-friendly, so the weather should support the plan instead of trying to rewrite it.`,
      detail: `if you want the simple version: pack normally and go. You are basically moving from ${fromScene} to ${toScene}, and the day stays cooperative at both ends.`,
    };
  }

  if (minimumScore >= 52) {
    if (arrivalIsRougher) {
      return {
        label: "Manageable trip day",
        summary: `This route still looks good, but the bigger weather wrinkle shows up near ${toStop.label}. You start in ${fromScene} around ${fromStop.label} and finish in ${toScene}.`,
        detail: `if you are going to be careful about one thing on this route, make it the arrival window. ${pressurePoint} is worth planning around, even though the trip itself still looks very doable.`,
      };
    }

    if (departureIsRougher) {
      return {
        label: "Manageable trip day",
        summary: `The weather asks a bit more of you at the start than at the finish. ${fromStop.label} is leaning ${fromScene}, then the route settles toward ${toStop.label}, which looks ${toScene}.`,
        detail: `this is more about leaving smart than changing the whole plan. Once you clear the rougher opening conditions, the rest of the day should feel steadier.`,
      };
    }

    return {
      label: "Manageable trip day",
      summary: `This trip is in good shape overall, but it is not completely autopilot. ${fromStop.label} and ${toStop.label} stay within reach of a smooth day, with a few weather edges that deserve a little respect.`,
      detail: `the main difference is not whether to go, but how deliberately you pack and time it. ${packingCue}`,
    };
  }

  return {
    label: "Mixed trip day",
    summary: `This is the kind of route where a little foresight pays you back. One end of the day feels easier, the other carries more friction, and you can feel that contrast between ${fromStop.label} and ${toStop.label}.`,
    detail: arrivalIsRougher
      ? `the sharper edge sits closer to ${toStop.label}, where you are trading ${fromScene} for ${toScene}. If I were packing for this one, I would protect the arrival plan first and let everything else follow from that.`
      : departureIsRougher
        ? `the rougher weather is likely to meet you early near ${fromStop.label}, then ease later on. If you give the opening leg some patience, the rest of the route should feel more forgiving.`
        : `the route swings enough between ${fromScene} and ${toScene} that rigid plans will feel brittle. Go with a little margin, and let the weather guide the small decisions instead of the whole trip.`,
  };
}

function buildTripRecommendations(fromStop, toStop, bestDeparture) {
  const recommendations = [];
  const highestRainRisk = Math.max(
    fromStop.today.precipitationChance ?? 0,
    toStop.today.precipitationChance ?? 0,
  );
  const highestWind = Math.max(
    fromStop.current.windSpeed,
    toStop.current.windSpeed,
    fromStop.today.windMax,
    toStop.today.windMax,
  );
  const temperatureSwing = Math.abs(fromStop.current.feelsLike - toStop.current.feelsLike);
  const poorAirQualityStop = [fromStop, toStop].find(
    (stop) => stop.airQuality && !["good", "moderate"].includes(stop.airQuality.details.tone),
  );
  const stormyStop = [fromStop, toStop].find((stop) => stop.current.accent === "storm");

  if (bestDeparture) {
    recommendations.push({
      title: "Best time to leave",
      body: `${bestDeparture.title} is around ${formatDisplayTime(bestDeparture.departure.time)}. ${bestDeparture.body}`,
    });
  }

  if (stormyStop) {
    recommendations.push({
      title: "Build in buffer time",
      body: `${stormyStop.label} is dealing with stormier weather, so leave later appointments flexible and expect slower travel.`,
    });
  } else if (highestRainRisk >= 55) {
    recommendations.push({
      title: "Pack for wet stops",
      body: `Rain risk reaches ${highestRainRisk}% across the trip, so keep a waterproof layer and dry shoes in reach.`,
    });
  }

  if (highestWind >= 35) {
    recommendations.push({
      title: "Expect a breezier route",
      body: `Winds could push up to ${highestWind} km/h, which is worth accounting for if you are walking, cycling, or carrying light gear.`,
    });
  }

  if (temperatureSwing >= 8) {
    recommendations.push({
      title: "Dress for a temperature swing",
      body: `Conditions shift by about ${temperatureSwing}°C between your stops, so layers will travel better than a single outfit.`,
    });
  }

  if (poorAirQualityStop) {
    recommendations.push({
      title: "Keep outdoor time flexible",
      body: `${poorAirQualityStop.label} has ${poorAirQualityStop.airQuality.details.label.toLowerCase()} air quality, so longer outdoor plans may feel less comfortable there.`,
    });
  }

  if (toStop.bestWindow) {
    recommendations.push({
      title: "Aim your arrival window",
      body: `${formatHourLabel(toStop.bestWindow.time)} looks strongest at ${toStop.label}, with the most comfortable combination of temperature, wind, and rain risk.`,
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      title: "Travel conditions look balanced",
      body: "Both ends of the trip look steady, so normal packing and timing should work well.",
    });
  }

  return recommendations.slice(0, 4);
}

function estimateTravelDurationHours(distanceKilometers) {
  const cruisingSpeed =
    distanceKilometers <= 80 ? 46 : distanceKilometers <= 240 ? 58 : 68;
  const bufferHours =
    distanceKilometers >= 500 ? 0.9 : distanceKilometers >= 180 ? 0.55 : 0.3;

  return clamp(
    Math.round((distanceKilometers / cruisingSpeed + bufferHours) * 2) / 2,
    1,
    14,
  );
}

function formatTravelDurationLabel(hours) {
  const roundedMinutes = Math.round(hours * 60);
  const wholeHours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (!wholeHours) {
    return `${minutes}m`;
  }

  if (!minutes) {
    return `${wholeHours}h`;
  }

  return `${wholeHours}h ${minutes}m`;
}

function getHourValue(timestamp) {
  const timePart = timestamp.split("T")[1] ?? "00:00";
  const [hourPart = "0", minutePart = "0"] = timePart.split(":");

  return Number.parseInt(hourPart, 10) + Number.parseInt(minutePart, 10) / 60;
}

function buildMidpointCoordinates(fromCoordinates, toCoordinates) {
  return {
    latitude: (fromCoordinates.latitude + toCoordinates.latitude) / 2,
    longitude: (fromCoordinates.longitude + toCoordinates.longitude) / 2,
  };
}

async function buildMidpointLocation(fromLocation, toLocation, signal) {
  const coordinates = buildMidpointCoordinates(fromLocation, toLocation);
  const midpointLocation = await fetchLocationByCoordinates(
    coordinates.latitude,
    coordinates.longitude,
    signal,
  ).catch(() => null);

  if (midpointLocation) {
    return midpointLocation;
  }

  return {
    name: "Mid-route pulse",
    country:
      fromLocation.country && fromLocation.country === toLocation.country
        ? fromLocation.country
        : undefined,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  };
}

function selectClosestHourByTarget(hourlyForecast, targetHour) {
  const normalizedTarget = clamp(targetHour, 0, 23.5);

  return hourlyForecast.reduce((closestHour, hour) => {
    if (!closestHour) {
      return hour;
    }

    const currentDelta = Math.abs(getHourValue(hour.time) - normalizedTarget);
    const closestDelta = Math.abs(getHourValue(closestHour.time) - normalizedTarget);
    return currentDelta < closestDelta ? hour : closestHour;
  }, null);
}

function describeRouteMoment(moment) {
  const rainRisk = moment.precipitationChance ?? 0;
  const temperatureTone = describeTravelTemperature(moment.feelsLike);
  let conditionTone = moment.summary.toLowerCase();

  if (moment.accent === "storm") {
    conditionTone = "thunder in the area";
  } else if (rainRisk >= 70) {
    conditionTone = `rain chances near ${rainRisk}%`;
  } else if (rainRisk >= 45) {
    conditionTone = "showers hovering nearby";
  } else if (moment.accent === "sunny") {
    conditionTone = "clearer skies";
  } else if (moment.accent === "cloudy") {
    conditionTone = "a cloudier sky";
  }

  let copy = `${temperatureTone} air and ${conditionTone}`;

  if (moment.windSpeed >= 35) {
    copy += `, with gusts near ${moment.windSpeed} km/h`;
  } else if (moment.windSpeed >= 24) {
    copy += ", with a noticeable breeze";
  }

  return copy;
}

function buildRouteMoment(stop, stage, targetHour) {
  const snapshotHour = selectClosestHourByTarget(stop.hourly, targetHour);

  if (!snapshotHour) {
    return null;
  }

  const details = getWeatherDetails(snapshotHour.weatherCode);
  const aqi = snapshotHour.aqi != null ? Math.round(snapshotHour.aqi) : null;
  const score = scoreOutdoorConditions({
    feelsLike: snapshotHour.feelsLike,
    precipitationChance: snapshotHour.precipitationChance ?? stop.today.precipitationChance ?? 0,
    windSpeed: snapshotHour.windSpeed,
    aqi,
    uvIndex: snapshotHour.uvIndex,
    isDay: snapshotHour.isDay,
  });

  return {
    stage,
    label: stop.label,
    time: snapshotHour.time,
    score,
    summary: details.label,
    accent: details.accent,
    temperature: snapshotHour.temperature,
    feelsLike: snapshotHour.feelsLike,
    precipitationChance: snapshotHour.precipitationChance ?? 0,
    windSpeed: snapshotHour.windSpeed,
    uvIndex: snapshotHour.uvIndex,
    isDay: snapshotHour.isDay,
    aqi,
    aqiDetails: getAqiDetails(aqi),
  };
}

function buildDepartureOptionTitle(plan, bestPlan, index) {
  if (index === 0) {
    return "Best overall";
  }

  if (plan.overnight) {
    return "Long-haul fallback";
  }

  if (plan.departureHour <= bestPlan.departureHour - 2) {
    return "Earlier jump";
  }

  if (plan.departureHour >= bestPlan.departureHour + 2) {
    return "Later backup";
  }

  return "Strong alternate";
}

function buildDeparturePlanNarrative(plan, fromStop, toStop) {
  const departureScene = describeRouteMoment(plan.departure);
  const arrivalScene = describeRouteMoment(plan.arrival);

  if (plan.overnight) {
    return `This is the long-haul play. It starts ${departureScene} out of ${fromStop.label} and uses the latest reliable arrival picture near ${toStop.label}.`;
  }

  if (plan.arrival.score >= plan.departure.score + 10) {
    return `A smart choice if you would rather let the route get easier as it unfolds. You leave ${fromStop.label} with ${departureScene} and arrive into ${arrivalScene}.`;
  }

  if (plan.arrival.score <= plan.departure.score - 10) {
    return `This protects the cleaner part of the day early, before the route tightens near ${toStop.label}. Expect ${departureScene} on the way out and ${arrivalScene} by arrival.`;
  }

  if (plan.worstMoment.stage === "Mid-route") {
    return "This keeps both ends fairly steady and pushes the rougher patch into the middle of the run instead of the finish.";
  }

  if (plan.peakRainRisk >= 60) {
    return `This window does the best job of keeping the wettest part of the day from taking over the whole route, especially near ${plan.worstMoment.label}.`;
  }

  if (plan.peakWind >= 35) {
    return "This timing keeps the route feeling more composed and avoids letting the breeziest stretch own the day.";
  }

  return "This is the cleanest balance of comfort, rain pressure, and wind across the whole route.";
}

function buildRouteTimelineSummary(plan) {
  if (!plan) {
    return "Set both stops to see how the weather rhythm changes from the launch to the finish.";
  }

  if (plan.overnight) {
    return "This is a long-haul estimate, so the arrival view leans on the latest same-day weather window near the destination.";
  }

  if (plan.arrival.score >= plan.departure.score + 10) {
    return "The trip gets friendlier as it goes, so the arrival leg should feel easier than the first hour.";
  }

  if (plan.arrival.score <= plan.departure.score - 10) {
    return "The cleaner conditions happen early, so leaving on time matters more than usual here.";
  }

  if (plan.worstMoment.stage === "Mid-route") {
    return "Most of the route holds together well, with the softer weather pocket showing up around the midpoint.";
  }

  return "The route stays fairly even, so your best win is choosing the window with the lowest overall friction.";
}

function buildDepartureOptions(fromStop, midStop, toStop, distanceKilometers) {
  const travelHours = estimateTravelDurationHours(distanceKilometers);
  const uniqueHours = [...new Set(fromStop.hourly.map((hour) => Math.round(getHourValue(hour.time))))];
  let candidateHours = uniqueHours.filter((hour) => hour >= 5 && hour <= 21);

  if (fromStop.selection.isToday) {
    const now = Date.now();
    candidateHours = candidateHours.filter((hour) => {
      const snapshotHour = selectClosestHourByTarget(fromStop.hourly, hour);
      return snapshotHour && new Date(snapshotHour.time).getTime() >= now - 30 * 60 * 1000;
    });
  }

  if (!candidateHours.length) {
    candidateHours = uniqueHours;
  }

  const sameDayCandidateHours = candidateHours.filter((hour) => hour + travelHours <= 23.5);
  const hoursToEvaluate = sameDayCandidateHours.length ? sameDayCandidateHours : candidateHours;

  const departurePlans = hoursToEvaluate
    .map((departureHour) => {
      const overnight = departureHour + travelHours > 23.5;
      const departure = buildRouteMoment(fromStop, "Departure", departureHour);
      const midpoint = buildRouteMoment(midStop, "Mid-route", departureHour + travelHours / 2);
      const arrival = buildRouteMoment(
        toStop,
        "Arrival",
        overnight ? 23 : departureHour + travelHours,
      );

      if (!departure || !midpoint || !arrival) {
        return null;
      }

      const timeline = [departure, midpoint, arrival];
      const scores = timeline.map((moment) => moment.score);
      const scoreSpread = Math.max(...scores) - Math.min(...scores);
      const worstMoment = timeline.reduce((roughestMoment, moment) =>
        moment.score < roughestMoment.score ? moment : roughestMoment,
      );
      const peakRainRisk = Math.max(...timeline.map((moment) => moment.precipitationChance ?? 0));
      const peakWind = Math.max(...timeline.map((moment) => moment.windSpeed));
      const temperatureSwing =
        Math.max(...timeline.map((moment) => moment.feelsLike)) -
        Math.min(...timeline.map((moment) => moment.feelsLike));
      const score = clamp(
        Math.round(
          departure.score * 0.25 +
            midpoint.score * 0.32 +
            arrival.score * 0.43 -
            scoreSpread * 0.12 -
            (overnight ? 8 : 0),
        ),
        0,
        100,
      );

      return {
        departureHour,
        travelHours,
        overnight,
        departure,
        midpoint,
        arrival,
        timeline,
        score,
        worstMoment,
        peakRainRisk,
        peakWind,
        temperatureSwing,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.departureHour - right.departureHour);

  const selectedPlans = [];

  departurePlans.forEach((plan) => {
    if (selectedPlans.length >= 3) {
      return;
    }

    if (selectedPlans.every((existingPlan) => Math.abs(existingPlan.departureHour - plan.departureHour) >= 2)) {
      selectedPlans.push(plan);
    }
  });

  departurePlans.forEach((plan) => {
    if (selectedPlans.length >= 3 || selectedPlans.includes(plan)) {
      return;
    }

    selectedPlans.push(plan);
  });

  const bestPlan = selectedPlans[0] ?? null;

  return selectedPlans.map((plan, index) => ({
    ...plan,
    title: buildDepartureOptionTitle(plan, bestPlan ?? plan, index),
    focusLabel:
      plan.worstMoment.stage === "Arrival"
        ? "Protect arrival"
        : plan.worstMoment.stage === "Mid-route"
          ? "Middle stays touchier"
          : "Front-loaded weather",
    body: buildDeparturePlanNarrative(plan, fromStop, toStop),
  }));
}

function buildTripPackingList(fromStop, midStop, toStop, bestDeparture) {
  const routeMoments = bestDeparture?.timeline ?? [];
  const allFeelsLike = [
    fromStop.current.feelsLike,
    midStop.current.feelsLike,
    toStop.current.feelsLike,
    ...routeMoments.map((moment) => moment.feelsLike),
  ];
  const allWindSpeeds = [
    fromStop.current.windSpeed,
    midStop.current.windSpeed,
    toStop.current.windSpeed,
    fromStop.today.windMax,
    midStop.today.windMax,
    toStop.today.windMax,
    ...routeMoments.map((moment) => moment.windSpeed),
  ];
  const peakRainMoment =
    routeMoments.reduce(
      (wettestMoment, moment) =>
        (moment.precipitationChance ?? 0) > (wettestMoment?.precipitationChance ?? -1)
          ? moment
          : wettestMoment,
      null,
    ) ?? null;
  const stormMoment = routeMoments.find((moment) => moment.accent === "storm") ?? null;
  const temperatureSwing = Math.max(...allFeelsLike) - Math.min(...allFeelsLike);
  const peakFeelsLike = Math.max(...allFeelsLike);
  const lowestFeelsLike = Math.min(...allFeelsLike);
  const peakWind = Math.max(...allWindSpeeds);
  const peakUv = Math.max(
    fromStop.today.uvMax ?? 0,
    midStop.today.uvMax ?? 0,
    toStop.today.uvMax ?? 0,
    ...routeMoments.map((moment) => moment.uvIndex ?? 0),
  );
  const poorAirStop = [fromStop, midStop, toStop].find(
    (stop) => stop.airQuality && !["good", "moderate"].includes(stop.airQuality.details.tone),
  );
  const packingList = [];

  if (stormMoment || (peakRainMoment?.precipitationChance ?? 0) >= 55) {
    packingList.push({
      label: "Carry",
      title: stormMoment
        ? "Make rain protection your fastest grab"
        : "Keep the rain layer on top of the bag",
      body: stormMoment
        ? `Stormier weather is most likely around ${stormMoment.label}, so keep a proper shell and a dry spot for your essentials within one reach.`
        : `Rain risk peaks near ${(peakRainMoment?.precipitationChance ?? 0)}% around ${peakRainMoment?.label}, so a light waterproof layer and protected documents will earn their place.`,
    });
  }

  if (temperatureSwing >= 8 || lowestFeelsLike <= 14) {
    packingList.push({
      label: "Wear",
      title: "Layers will beat a one-note outfit",
      body: `This route swings from about ${lowestFeelsLike}C to ${peakFeelsLike}C in feels-like terms, so one easy extra layer is smarter than overcommitting at the start.`,
    });
  }

  if (peakFeelsLike >= 31) {
    packingList.push({
      label: "Comfort",
      title: "Treat water like part of the route plan",
      body: `The trip pushes into ${peakFeelsLike}C feels-like territory, so cold water, breathable fabric, and a quick cooldown stop will matter more than they sound.`,
    });
  }

  if (peakWind >= 35) {
    packingList.push({
      label: "Secure",
      title: "Pack for gusts, not just temperature",
      body: `Wind could reach ${peakWind} km/h, so secure anything light, skip flimsy outerwear, and keep both hands free if you expect exposed stops.`,
    });
  }

  if (poorAirStop) {
    packingList.push({
      label: "Protect",
      title: "Give yourself a clean-air fallback",
      body: `${poorAirStop.label} is carrying ${poorAirStop.airQuality.details.label.toLowerCase()} air quality, so shorter outdoor stops and cabin recirculation may feel noticeably better there.`,
    });
  }

  if (peakUv >= 7) {
    packingList.push({
      label: "Shield",
      title: "Sun exposure belongs on the checklist too",
      body: `UV peaks near ${peakUv} on this route, so sunglasses and a little skin protection make more sense than leaving it to chance.`,
    });
  }

  if (!packingList.length) {
    packingList.push({
      label: "Base kit",
      title: "A calm, light kit is enough for this one",
      body: "A water bottle, phone cable, and one flexible layer should cover the small shifts this route is likely to throw at you.",
    });
  }

  return packingList.slice(0, 4);
}

async function buildTripStopForecast(location, date, todayDate, signal) {
  const isToday = date === todayDate;
  const forecast = await fetchWeatherByCoordinates(
    location.latitude,
    location.longitude,
    { startDate: date, endDate: date, includeCurrent: isToday },
    signal,
  );
  const airQuality = await fetchAirQualityByCoordinates(
    location.latitude,
    location.longitude,
    date,
    signal,
  ).catch(() => null);
  const dailyForecast = summarizeForecast(forecast.daily);
  const selectedDay = dailyForecast[0];
  const hourlyForecast = summarizeHourly(forecast.hourly, airQuality?.hourly).filter((hour) =>
    hour.time.startsWith(date),
  );

  if (!selectedDay || !hourlyForecast.length) {
    throw new Error(`Weather for ${buildLocationLabel(location)} is unavailable right now.`);
  }

  const snapshotHour = selectSnapshotHour(hourlyForecast, date, isToday);

  if (!snapshotHour) {
    throw new Error(`Weather for ${buildLocationLabel(location)} is unavailable right now.`);
  }

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
  const currentConditions =
    isToday && forecast.current
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
  const outdoorScoreValue = scoreOutdoorConditions({
    feelsLike: currentConditions.feelsLike,
    precipitationChance: selectedDay.precipitationChance ?? 0,
    windSpeed: currentConditions.windSpeed,
    aqi: selectedAirQuality?.aqi ?? null,
    uvIndex: selectedDay.uvMax ?? 0,
    isDay: currentConditions.isDay,
  });

  return {
    label: buildLocationLabel(location),
    coordinates: {
      latitude: location.latitude,
      longitude: location.longitude,
    },
    selection: buildDateSelection(date, todayDate, currentConditions.time),
    current: currentConditions,
    today: selectedDay,
    airQuality: selectedAirQuality
      ? {
          ...selectedAirQuality,
          details: getAqiDetails(selectedAirQuality.aqi ?? null),
        }
      : null,
    outdoorScore: {
      value: outdoorScoreValue,
      label: getOutdoorScoreLabel(outdoorScoreValue),
    },
    hourly: hourlyForecast,
    bestWindow: selectBestWindow(hourlyForecast, isToday),
  };
}

function TripStopCard({ title, stop }) {
  return (
    <article className={`trip-stop-card trip-stop-${stop.current.accent} surface`}>
      <div className="trip-stop-orb" />
      <div className="trip-stop-header">
        <div>
          <p className="section-label">{title}</p>
          <h3>{stop.label}</h3>
          <p className="trip-stop-copy">{stop.selection.timestampLabel}</p>
        </div>
        <span className="trip-stop-summary">{stop.current.summary}</span>
      </div>

      <div className="trip-stop-hero">
        <div className="trip-stop-temperature">
          <strong>{stop.current.temperature}&deg;C</strong>
          <span>Feels like {stop.current.feelsLike}&deg;C</span>
        </div>

        <div className="trip-stop-pills">
          <span className="trip-stop-pill">{stop.outdoorScore.label} momentum</span>
          <span className="trip-stop-pill">
            {stop.bestWindow
              ? `Best near ${formatHourLabel(stop.bestWindow.time)}`
              : "Keep plans flexible"}
          </span>
        </div>
      </div>

      <div className="trip-stop-metrics">
        <article>
          <span>Rain</span>
          <strong>{stop.today.precipitationChance}%</strong>
        </article>
        <article>
          <span>Wind</span>
          <strong>{stop.current.windSpeed} km/h</strong>
        </article>
        <article>
          <span>Outdoor score</span>
          <strong>{stop.outdoorScore.value}/100</strong>
        </article>
        <article>
          <span>Air quality</span>
          <strong>
            {stop.airQuality ? `${stop.airQuality.aqi} ${stop.airQuality.details.label}` : "Unavailable"}
          </strong>
        </article>
      </div>

      <p className="trip-stop-copy">
        {stop.bestWindow
          ? `Best outdoor window looks to be around ${formatHourLabel(stop.bestWindow.time)}, when conditions should feel the most comfortable.`
          : "Conditions stay mixed enough that it helps to keep timing and stops flexible."}
      </p>
    </article>
  );
}

function TripDepartureOptionCard({ option, featured }) {
  return (
    <article
      className={`trip-departure-card ${featured ? "trip-departure-card-featured" : ""}`}
    >
      <div className="trip-departure-header">
        <div>
          <span className="trip-departure-label">{option.title}</span>
          <h3>Leave {formatDisplayTime(option.departure.time)}</h3>
        </div>
        <span className="trip-departure-score">{option.score}/100</span>
      </div>

      <p className="trip-route-copy">{option.body}</p>

      <div className="trip-departure-flags">
        <span>{option.focusLabel}</span>
        <span>{option.overnight ? "Late-day arrival estimate" : "Same-day arrival"}</span>
      </div>

      <div className="trip-departure-metrics">
        <article>
          <span>Arrive</span>
          <strong>{formatDisplayTime(option.arrival.time)}</strong>
        </article>
        <article>
          <span>Wheel-time</span>
          <strong>{formatTravelDurationLabel(option.travelHours)}</strong>
        </article>
        <article>
          <span>Peak rain</span>
          <strong>{option.peakRainRisk}%</strong>
        </article>
        <article>
          <span>Peak wind</span>
          <strong>{option.peakWind} km/h</strong>
        </article>
      </div>
    </article>
  );
}

export default function App() {
  const todayDate = getTodayDateValue();
  const minSelectableDate = shiftIsoDate(todayDate, -maxPastWeatherDays);
  const maxSelectableDate = shiftIsoDate(todayDate, maxFutureWeatherDays);
  const [activePage, setActivePage] = useState("forecast");
  const [query, setQuery] = useState("Toronto");
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tripLoading, setTripLoading] = useState(false);
  const [tripError, setTripError] = useState("");
  const [tripPlan, setTripPlan] = useState(null);
  const [tripForm, setTripForm] = useState({
    from: "",
    to: "",
    date: todayDate,
  });
  const [suggestions, setSuggestions] = useState([]);
  const [recentLocations, setRecentLocations] = useState(loadRecentLocationsFromStorage);
  const [activeLocation, setActiveLocation] = useState(null);
  const activeRequest = useRef(null);
  const activeSuggestionRequest = useRef(null);
  const activeTripRequest = useRef(null);
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
        setError(
          isNetworkFetchError(loadError)
            ? "Weather data could not be reached. Check your connection and try again."
            : loadError.message || "Something went wrong while loading the forecast.",
        );
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
      activeTripRequest.current?.abort();
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

  async function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported in this browser.");
      return;
    }

    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError(
        "Current location needs HTTPS or localhost. Open the app in a secure browser tab and try again.",
      );
      return;
    }

    setLoading(true);
    setError("");

    try {
      const position = await getCurrentPositionWithFallback();

      loadWeather({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        date: selectedDate,
      });
    } catch (locationError) {
      setLoading(false);
      setError(getGeolocationErrorMessage(locationError));
    }
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

  function handleOpenTripPlanner() {
    const candidateStartLocation = [activeLocation?.label, weather?.locationName, query.trim()].find(
      (value) => value && value !== "Current location",
    );

    setTripForm((currentTripForm) => ({
      ...currentTripForm,
      from: currentTripForm.from || candidateStartLocation || "",
      date: currentTripForm.date || selectedDate,
    }));
    setTripError("");
    setActivePage("trip");
  }

  function handleCloseTripPlanner() {
    activeTripRequest.current?.abort();
    activeTripRequest.current = null;
    setTripLoading(false);
    setTripError("");
    setActivePage("forecast");
  }

  function handleTripFieldChange(field, value) {
    setTripForm((currentTripForm) => ({
      ...currentTripForm,
      [field]: value,
    }));
  }

  function handleSwapTripLocations() {
    setTripForm((currentTripForm) => ({
      ...currentTripForm,
      from: currentTripForm.to,
      to: currentTripForm.from,
    }));
  }

  async function handleTripSubmit(event) {
    event.preventDefault();
    const fromQuery = tripForm.from.trim();
    const toQuery = tripForm.to.trim();

    if (!fromQuery || !toQuery) {
      setTripError("Enter both a starting point and a destination.");
      return;
    }

    if (normalizeLocationText(fromQuery) === normalizeLocationText(toQuery)) {
      setTripError("Choose two different places to build a trip plan.");
      return;
    }

    activeTripRequest.current?.abort();

    const controller = new AbortController();
    activeTripRequest.current = controller;

    setTripLoading(true);
    setTripError("");

    try {
      const [fromLocation, toLocation] = await Promise.all([
        resolveLocationByQuery(fromQuery, controller.signal),
        resolveLocationByQuery(toQuery, controller.signal),
      ]);

      if (!fromLocation) {
        throw new Error("We could not find the starting location. Try a city, region, or country.");
      }

      if (!toLocation) {
        throw new Error("We could not find the destination. Try a city, region, or country.");
      }

      const midpointLocationPromise = buildMidpointLocation(
        fromLocation,
        toLocation,
        controller.signal,
      );

      const [fromStop, toStop, midpointLocation] = await Promise.all([
        buildTripStopForecast(fromLocation, tripForm.date, todayDate, controller.signal),
        buildTripStopForecast(toLocation, tripForm.date, todayDate, controller.signal),
        midpointLocationPromise,
      ]);
      const distanceKilometers = calculateDistanceInKilometers(
        fromStop.coordinates,
        toStop.coordinates,
      );
      const midStop = await buildTripStopForecast(
        midpointLocation,
        tripForm.date,
        todayDate,
        controller.signal,
      );
      const departureOptions = buildDepartureOptions(
        fromStop,
        midStop,
        toStop,
        distanceKilometers,
      );
      const bestDeparture = departureOptions[0] ?? null;

      setTripPlan({
        date: tripForm.date,
        from: fromStop,
        mid: midStop,
        to: toStop,
        distanceKilometers,
        estimatedTravelHours:
          bestDeparture?.travelHours ?? estimateTravelDurationHours(distanceKilometers),
        readiness: buildTripReadiness(fromStop, toStop),
        departureOptions,
        bestDeparture,
        routeTimeline: bestDeparture?.timeline ?? [],
        timelineSummary: buildRouteTimelineSummary(bestDeparture),
        packingList: buildTripPackingList(fromStop, midStop, toStop, bestDeparture),
        recommendations: buildTripRecommendations(fromStop, toStop, bestDeparture),
      });
    } catch (tripLoadError) {
      if (tripLoadError.name !== "AbortError") {
        setTripError(
          isNetworkFetchError(tripLoadError)
            ? "Trip weather data could not be reached. Check your connection and try again."
            : tripLoadError.message || "Something went wrong while planning the trip.",
        );
      }
    } finally {
      if (activeTripRequest.current === controller) {
        activeTripRequest.current = null;
        setTripLoading(false);
      }
    }
  }

  const accentClass = weather ? `theme-${weather.current.accent}` : "theme-cloudy";
  const tripAccentClass = tripPlan
    ? `theme-${tripPlan.to.current.accent}`
    : weather
      ? accentClass
      : "theme-cloudy";
  const tripTemperatureSwing = tripPlan
    ? Math.abs(tripPlan.from.current.feelsLike - tripPlan.to.current.feelsLike)
    : 0;
  const tripPeakRainRisk = tripPlan
    ? Math.max(
        tripPlan.from.today.precipitationChance ?? 0,
        tripPlan.mid?.today.precipitationChance ?? 0,
        tripPlan.to.today.precipitationChance ?? 0,
        tripPlan.bestDeparture?.peakRainRisk ?? 0,
      )
    : 0;
  const tripPeakWind = tripPlan
    ? Math.max(
        tripPlan.from.current.windSpeed,
        tripPlan.mid?.current.windSpeed ?? 0,
        tripPlan.to.current.windSpeed,
        tripPlan.from.today.windMax,
        tripPlan.mid?.today.windMax ?? 0,
        tripPlan.to.today.windMax,
        tripPlan.bestDeparture?.peakWind ?? 0,
      )
    : 0;
  const tripRouteConfidence = tripPlan
    ? tripPlan.bestDeparture?.score ??
      Math.round(
        (tripPlan.from.outdoorScore.value +
          (tripPlan.mid?.outdoorScore.value ?? tripPlan.from.outdoorScore.value) +
          tripPlan.to.outdoorScore.value) /
          3,
      )
    : 0;
  const tripBestDepartureLabel = tripPlan?.bestDeparture
    ? formatDisplayTime(tripPlan.bestDeparture.departure.time)
    : "";
  const tripEstimatedTravelLabel = tripPlan
    ? formatTravelDurationLabel(tripPlan.estimatedTravelHours)
    : "";
  const sparkline = weather
    ? buildSparkline(weather.hourly.map((hour) => hour.temperature), 480, 160)
    : null;

  if (activePage === "trip") {
    return (
      <main className={`app-shell ${tripAccentClass}`}>
        <div className="aurora aurora-one" />
        <div className="aurora aurora-two" />

        <section className="hero-card trip-command-card">
          <div className="trip-page-header">
            <button className="back-button" type="button" onClick={handleCloseTripPlanner}>
              Back to forecast
            </button>
            <span className="hero-status">Trip Planner</span>
          </div>

          <div className="trip-command-grid">
            <div className="trip-hero-panel">
              <div className="hero-copy trip-hero-copy">
                <p className="eyebrow">SkyCast Route Intelligence</p>
                <h1 className="trip-hero-title">Plan the route like it already happened.</h1>
                <p className="intro trip-hero-intro">
                  Run a weather brief across both ends of the trip, spot where conditions break,
                  and leave with a route plan that feels deliberate instead of reactive.
                </p>

                <div className="trip-stage">
                  <article className="trip-stage-node">
                    <span className="trip-stage-label">From</span>
                    <strong>{tripPlan ? tripPlan.from.label : tripForm.from || "Starting point"}</strong>
                  </article>

                  <div className="trip-stage-track">
                    <span className="trip-stage-line" />
                    <div className="trip-stage-core">
                      <span className="trip-stage-core-label">
                        {tripPlan ? tripPlan.readiness.label : "Awaiting route brief"}
                      </span>
                      <strong>
                        {tripPlan ? `${tripPlan.distanceKilometers} km` : "Set both stops"}
                      </strong>
                    </div>
                  </div>

                  <article className="trip-stage-node">
                    <span className="trip-stage-label">To</span>
                    <strong>{tripPlan ? tripPlan.to.label : tripForm.to || "Destination"}</strong>
                  </article>
                </div>

                {tripPlan ? (
                  <div className="trip-hero-stats">
                    <article className="trip-stat-tile">
                      <span>Travel date</span>
                      <strong>{formatDisplayDate(tripPlan.date)}</strong>
                    </article>
                    <article className="trip-stat-tile">
                      <span>Best leave</span>
                      <strong>{tripBestDepartureLabel}</strong>
                    </article>
                    <article className="trip-stat-tile">
                      <span>Wheel-time</span>
                      <strong>{tripEstimatedTravelLabel}</strong>
                    </article>
                    <article className="trip-stat-tile">
                      <span>Temperature swing</span>
                      <strong>{tripTemperatureSwing}&deg;C</strong>
                    </article>
                  </div>
                ) : (
                  <div className="trip-hero-preview">
                    <span className="trip-preview-pill">Best departure windows</span>
                    <span className="trip-preview-pill">Route weather timeline</span>
                    <span className="trip-preview-pill">Smart packing assistant</span>
                  </div>
                )}
              </div>
            </div>

            <div className="trip-form-panel">
              <article className="trip-form-card surface">
                <div className="trip-form-topline">
                  <div>
                    <p className="section-label">Build the route brief</p>
                    <h2>Enter both stops and let the planner compare the day.</h2>
                  </div>
                  <span className="trip-form-badge">Live weather intelligence</span>
                </div>

                <form className="trip-form-grid" onSubmit={handleTripSubmit}>
                  <div className="trip-field">
                    <label htmlFor="trip-from">From</label>
                    <input
                      id="trip-from"
                      type="text"
                      value={tripForm.from}
                      onChange={(event) => handleTripFieldChange("from", event.target.value)}
                      placeholder="Starting city"
                    />
                  </div>

                  <div className="trip-field">
                    <label htmlFor="trip-to">To</label>
                    <input
                      id="trip-to"
                      type="text"
                      value={tripForm.to}
                      onChange={(event) => handleTripFieldChange("to", event.target.value)}
                      placeholder="Destination city"
                    />
                  </div>

                  <div className="trip-field">
                    <label htmlFor="trip-date">Travel date</label>
                    <PremiumDatePicker
                      id="trip-date"
                      value={tripForm.date}
                      min={minSelectableDate}
                      max={maxSelectableDate}
                      onChange={(nextDate) => handleTripFieldChange("date", nextDate)}
                      disabled={tripLoading}
                      placeholder="Choose travel date"
                      ariaLabel="Choose travel date"
                    />
                  </div>

                  <div className="trip-form-actions">
                    <button className="trip-primary-button" type="submit" disabled={tripLoading}>
                      {tripLoading ? "Planning..." : "Plan my trip"}
                    </button>
                    <button
                      className="date-button"
                      type="button"
                      onClick={handleSwapTripLocations}
                      disabled={tripLoading}
                    >
                      Swap stops
                    </button>
                  </div>
                </form>
              </article>
            </div>
          </div>
        </section>

        {tripError ? <p className="status-message error-message">{tripError}</p> : null}

        {tripPlan ? (
          <>
            <section className="trip-overview-card surface">
              <div className="trip-overview-grid">
                <div className="trip-overview-copy-block">
                  <div className="trip-route-row">
                    <div>
                      <p className="section-label">Route outlook</p>
                      <h2>
                        {tripPlan.from.label} to {tripPlan.to.label}
                      </h2>
                    </div>
                    <span className="trip-readiness-pill">{tripPlan.readiness.label}</span>
                  </div>
                  <p className="trip-route-copy">{tripPlan.readiness.summary}</p>
                  <p className="trip-route-copy">
                    On {formatFullDisplayDate(tripPlan.date)}, {tripPlan.readiness.detail}
                  </p>
                </div>

                <div className="trip-kpi-grid">
                  <article className="trip-kpi-card">
                    <span>Distance</span>
                    <strong>{tripPlan.distanceKilometers} km</strong>
                  </article>
                  <article className="trip-kpi-card">
                    <span>Wheel-time</span>
                    <strong>{tripEstimatedTravelLabel}</strong>
                  </article>
                  <article className="trip-kpi-card">
                    <span>Route confidence</span>
                    <strong>{tripRouteConfidence}/100</strong>
                  </article>
                  <article className="trip-kpi-card">
                    <span>Peak wind</span>
                    <strong>{tripPeakWind} km/h</strong>
                  </article>
                  <article className="trip-kpi-card">
                    <span>Departure score</span>
                    <strong>{tripPlan.from.outdoorScore.value}/100</strong>
                  </article>
                  <article className="trip-kpi-card">
                    <span>Arrival score</span>
                    <strong>{tripPlan.to.outdoorScore.value}/100</strong>
                  </article>
                </div>
              </div>
            </section>

            <section className="trip-departure-panel surface">
              <div className="card-header">
                <div>
                  <p className="section-label">Best time to leave</p>
                  <h3>Three windows that give this route the cleanest shot</h3>
                  <p className="trip-route-copy">
                    The lead recommendation is built by scoring departure, mid-route, and arrival
                    weather together, not just whichever city looks nicer on its own.
                  </p>
                </div>
                <span className="trip-form-badge">{tripEstimatedTravelLabel} estimated wheel-time</span>
              </div>

              <div className="trip-departure-list">
                {tripPlan.departureOptions.map((option, index) => (
                  <TripDepartureOptionCard
                    key={`${option.departure.time}-${option.title}`}
                    option={option}
                    featured={index === 0}
                  />
                ))}
              </div>
            </section>

            <section className="trip-timeline-card surface">
              <div className="card-header">
                <div>
                  <p className="section-label">Route weather timeline</p>
                  <h3>What the route feels like if you leave around {tripBestDepartureLabel}</h3>
                  <p className="trip-route-copy">{tripPlan.timelineSummary}</p>
                </div>
                <span className="trip-form-badge">
                  {tripPlan.bestDeparture?.overnight ? "Long-haul estimate" : "Built from departure to arrival"}
                </span>
              </div>

              <div className="trip-timeline-grid">
                {tripPlan.routeTimeline.map((moment) => (
                  <article
                    className={`trip-timeline-step trip-timeline-${moment.accent}`}
                    key={`${moment.stage}-${moment.time}`}
                  >
                    <span className="trip-timeline-stage">{moment.stage}</span>
                    <h3>{moment.label}</h3>
                    <p className="trip-timeline-time">{formatDisplayTime(moment.time)}</p>
                    <p className="trip-route-copy">
                      Around {formatDisplayTime(moment.time)}, expect {describeRouteMoment(moment)}.
                    </p>

                    <div className="trip-timeline-metrics">
                      <article>
                        <span>Score</span>
                        <strong>{moment.score}/100</strong>
                      </article>
                      <article>
                        <span>Rain</span>
                        <strong>{moment.precipitationChance}%</strong>
                      </article>
                      <article>
                        <span>Feels like</span>
                        <strong>{moment.feelsLike}&deg;C</strong>
                      </article>
                      <article>
                        <span>Wind</span>
                        <strong>{moment.windSpeed} km/h</strong>
                      </article>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="trip-insight-band">
              <div className="row g-3">
                <div className="col-12 col-lg-4">
                  <article className="trip-band-card">
                    <span className="trip-band-label">Weather tension</span>
                    <strong>{tripTemperatureSwing}&deg;C swing</strong>
                    <p>Enough movement to justify layers and a more flexible arrival outfit.</p>
                  </article>
                </div>
                <div className="col-12 col-lg-4">
                  <article className="trip-band-card">
                    <span className="trip-band-label">Rain pressure</span>
                    <strong>{tripPeakRainRisk}% max risk</strong>
                    <p>The wettest point on the route is where your timing buffer matters most.</p>
                  </article>
                </div>
                <div className="col-12 col-lg-4">
                  <article className="trip-band-card">
                    <span className="trip-band-label">Route confidence</span>
                    <strong>{tripRouteConfidence}/100</strong>
                    <p>
                      Leaving around {tripBestDepartureLabel} gives this route the cleanest overall
                      balance.
                    </p>
                  </article>
                </div>
              </div>
            </section>

            <section className="trip-stop-grid">
              <div className="row g-3">
                <div className="col-12 col-xl-6">
                  <TripStopCard stop={tripPlan.from} title="Starting point" />
                </div>
                <div className="col-12 col-xl-6">
                  <TripStopCard stop={tripPlan.to} title="Destination" />
                </div>
              </div>
            </section>

            <section className="trip-packing-card surface">
              <div className="card-header">
                <div>
                  <p className="section-label">Smart packing assistant</p>
                  <h3>What deserves bag space for this run</h3>
                  <p className="trip-route-copy">
                    These calls come from the roughest weather edges across the departure, midpoint,
                    and arrival windows.
                  </p>
                </div>
                <span className="trip-form-badge">Route-aware packing</span>
              </div>

              <div className="trip-packing-list">
                {tripPlan.packingList.map((item) => (
                  <article className="trip-packing-item" key={item.title}>
                    <span className="trip-packing-label">{item.label}</span>
                    <p className="trip-packing-title">{item.title}</p>
                    <p>{item.body}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="trip-recommendations surface">
              <div className="card-header">
                <div>
                  <p className="section-label">Recommendations</p>
                  <h3>Operator notes for the route</h3>
                </div>
                <span className="trip-form-badge">Built from endpoints + timing</span>
              </div>

              <div className="trip-recommendation-list">
                {tripPlan.recommendations.map((recommendation, index) => (
                  <article className="trip-recommendation-card" key={recommendation.title}>
                    <span className="trip-recommendation-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <p className="trip-recommendation-title">{recommendation.title}</p>
                    <p>{recommendation.body}</p>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : (
          <section className="trip-empty-state surface">
            <p className="section-label">Trip planner</p>
            <h2>Compare two stops before you leave.</h2>
            <p className="trip-route-copy">
              Enter a starting point, a destination, and a date to get a quick weather read on
              both ends of the trip.
            </p>
            <div className="trip-empty-preview">
              <article>
                <span>Best time to leave</span>
                <strong>See three departure windows ranked by how the route behaves end to end</strong>
              </article>
              <article>
                <span>Route timeline</span>
                <strong>Watch the weather change from departure to midpoint to arrival</strong>
              </article>
              <article>
                <span>Packing assistant</span>
                <strong>Get a route-aware packing list instead of generic travel advice</strong>
              </article>
            </div>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className={`app-shell ${accentClass}`}>
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />

      <section className="hero-card">
        <div className="row g-4 align-items-start">
          <div className="col-12 col-xl-6">
            <div className="hero-copy">
              <div className="brand-row">
                <p className="eyebrow">SkyCast</p>
                {weather ? (
                  <span className="hero-status">
                    {weather.selection.shortLabel} in {weather.locationName}
                  </span>
                ) : null}
              </div>
              <h1>Plan around the weather.</h1>
              <p className="intro">
                Search a city, choose a date, and read the day at a glance without wading
                through a landing page.
              </p>

              {weather ? (
                <div className="hero-highlights">
                  <article className="highlight-chip">
                    <span className="highlight-label">Selected day</span>
                    <strong>{weather.selection.displayDate}</strong>
                  </article>
                  <article className="highlight-chip">
                    <span className="highlight-label">Temperature range</span>
                    <strong>
                      {weather.today.high}&deg; / {weather.today.low}&deg;
                    </strong>
                  </article>
                  <article className="highlight-chip">
                    <span className="highlight-label">Outdoor score</span>
                    <strong>{weather.outdoorScore.value}/100</strong>
                  </article>
                </div>
              ) : null}
            </div>
          </div>

          <div className="col-12 col-xl-6">
            <div className="hero-controls">
              <form className="search-bar row g-2 align-items-stretch" onSubmit={handleSearchSubmit}>
                <div className="col-12 col-sm">
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

                      return (
                        <option
                          key={`${location.id}-${location.latitude}-${location.longitude}`}
                          value={label}
                        />
                      );
                    })}
                  </datalist>
                </div>

                <div className="col-12 col-sm-auto">
                  <button className="w-100" type="submit" disabled={loading}>
                    {loading ? "Loading..." : "Search"}
                  </button>
                </div>
              </form>

              <div className="date-toolbar">
                <div className="date-field">
                  <label htmlFor="weather-date">Choose a date</label>
                  <PremiumDatePicker
                    id="weather-date"
                    value={selectedDate}
                    min={minSelectableDate}
                    max={maxSelectableDate}
                    onChange={handleDateSelection}
                    disabled={loading}
                    placeholder="Choose forecast date"
                    ariaLabel="Choose forecast date"
                  />
                </div>

                <div className="date-button-row row g-2">
                  <div className="col-12 col-sm-4">
                    <button
                      className="date-button w-100"
                      type="button"
                      onClick={() => handleDateSelection(shiftIsoDate(selectedDate, -1))}
                      disabled={loading || selectedDate === minSelectableDate}
                    >
                      Previous day
                    </button>
                  </div>
                  <div className="col-12 col-sm-4">
                    <button
                      className="date-button w-100"
                      type="button"
                      onClick={() => handleDateSelection(todayDate)}
                      disabled={loading || selectedDate === todayDate}
                    >
                      Today
                    </button>
                  </div>
                  <div className="col-12 col-sm-4">
                    <button
                      className="date-button w-100"
                      type="button"
                      onClick={() => handleDateSelection(shiftIsoDate(selectedDate, 1))}
                      disabled={loading || selectedDate === maxSelectableDate}
                    >
                      Next day
                    </button>
                  </div>
                </div>
              </div>

              <p className="date-hint">
                Browse weather from {formatFullDisplayDate(minSelectableDate)} through{" "}
                {formatFullDisplayDate(maxSelectableDate)}.
              </p>

              <div className="hero-actions">
                <button
                  className="location-button"
                  type="button"
                  onClick={handleUseCurrentLocation}
                  disabled={loading}
                >
                  Use my location
                </button>
                <button className="trip-launch-button" type="button" onClick={handleOpenTripPlanner}>
                  Plan my trip
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
            <div className="row g-3">
              <div className="col-12 col-md-6 col-xl-4">
                <article className="signal-card score-card surface h-100">
                  <p className="section-label">Outdoor Score</p>
                  <div className="score-value">
                    <strong>{weather.outdoorScore.value}</strong>
                    <span>{weather.outdoorScore.label}</span>
                  </div>
                  <p className="signal-copy">{weather.outdoorScore.summary}</p>
                </article>
              </div>

              <div className="col-12 col-md-6 col-xl-4">
                <article
                  className={`signal-card air-card surface h-100 ${
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
              </div>

              <div className="col-12 col-md-6 col-xl-4">
                <article className="signal-card daylight-card surface h-100">
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
              </div>
            </div>
          </section>

          <section className="studio-grid">
            <div className="row g-3">
              <div className="col-12 col-xl-7">
                <article className="timeline-card surface h-100">
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
              </div>

              <div className="col-12 col-xl-5">
                <article className="concierge-card surface h-100">
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
              </div>
            </div>
          </section>

          <section className="forecast-grid">
            <div className="row g-3">
              {weather.forecast.map((day, index) => {
                const details = getWeatherDetails(day.weatherCode);
                const isActiveDay = day.date === weather.selection.date;

                return (
                  <div className="col-12 col-sm-6 col-lg-4 col-xl-3" key={day.date}>
                    <button
                      className={`forecast-card h-100 w-100 ${isActiveDay ? "is-active" : ""}`}
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
                  </div>
                );
              })}
            </div>
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
