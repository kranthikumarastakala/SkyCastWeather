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

function getDaylightProgress(currentTime, sunrise, sunset) {
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
      message: "Sunrise is still ahead.",
    };
  }

  if (current >= end) {
    return {
      progress: 100,
      message: "The sun has already set for today.",
    };
  }

  const progress = ((current - start) / (end - start)) * 100;
  return {
    progress,
    message: `${Math.round(progress)}% of daylight has passed.`,
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

async function fetchWeatherByCoordinates(latitude, longitude, signal) {
  const url = new URL(forecastBaseUrl);
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
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
  url.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "apparent_temperature",
      "precipitation_probability",
      "weather_code",
      "wind_speed_10m",
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
  url.searchParams.set("forecast_days", "5");
  url.searchParams.set("forecast_hours", "24");
  url.searchParams.set("timezone", "auto");

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error("Weather service is unavailable right now.");
  }

  return response.json();
}

async function fetchAirQualityByCoordinates(latitude, longitude, signal) {
  const url = new URL(airQualityBaseUrl);
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("current", "us_aqi,pm2_5");
  url.searchParams.set("hourly", "us_aqi");
  url.searchParams.set("forecast_hours", "12");
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
    feelsLike: Math.round(hourly.apparent_temperature[index]),
    precipitationChance: hourly.precipitation_probability[index],
    weatherCode: hourly.weather_code[index],
    windSpeed: Math.round(hourly.wind_speed_10m[index]),
    uvIndex: Math.round(hourly.uv_index[index] ?? 0),
    isDay: Boolean(hourly.is_day[index]),
    aqi: airQualityHourly?.us_aqi?.[index] ?? null,
  }));
}

function selectBestWindow(hourlyForecast) {
  const windowCandidates = hourlyForecast.slice(0, 12);

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

function buildWeatherStory(current, today, airQualityDetails, bestWindow, outdoorScore) {
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
    : "The next few hours are still stabilizing.";

  return {
    headline: `${temperatureTone[0].toUpperCase()}${temperatureTone.slice(1)} conditions, ${outdoorScore.label.toLowerCase()} outdoor momentum.`,
    summary: `${current.summary} right now with a high of ${today.high}&deg;C, ${today.precipitationChance}% rain risk, and ${airQualityDetails.label.toLowerCase()} air. ${windowCopy}`,
  };
}

function buildConciergeItems(current, today, airQualityDetails, bestWindow, outdoorScore) {
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
      body: `${bestWindowCopy} Overall outdoor score today is ${outdoorScore.value}/100.`,
    },
    {
      title: "Air & Light",
      body: `${airCopy} UV peaks near ${today.uvMax}, so midday exposure deserves some respect.`,
    },
  ];
}

export default function App() {
  const [query, setQuery] = useState("Toronto");
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [recentLocations, setRecentLocations] = useState(loadRecentLocationsFromStorage);
  const activeRequest = useRef(null);
  const activeSuggestionRequest = useRef(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(recentLocationsStorageKey, JSON.stringify(recentLocations));
  }, [recentLocations]);

  async function loadWeather({ search, latitude, longitude, sourceLabel }) {
    activeRequest.current?.abort();

    const controller = new AbortController();
    activeRequest.current = controller;

    setLoading(true);
    setError("");

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

      const forecast = await fetchWeatherByCoordinates(
        location.latitude ?? latitude,
        location.longitude ?? longitude,
        controller.signal,
      );
      const airQuality = await fetchAirQualityByCoordinates(
        location.latitude ?? latitude,
        location.longitude ?? longitude,
        controller.signal,
      ).catch(() => null);
      const details = getWeatherDetails(forecast.current.weather_code);
      const dailyForecast = summarizeForecast(forecast.daily);
      const today = dailyForecast[0];
      const hourlyForecast = summarizeHourly(forecast.hourly, airQuality?.hourly);
      const bestWindow = selectBestWindow(hourlyForecast);
      const airQualityDetails = getAqiDetails(
        airQuality?.current?.us_aqi != null ? Math.round(airQuality.current.us_aqi) : null,
      );
      const outdoorScoreValue = scoreOutdoorConditions({
        feelsLike: Math.round(forecast.current.apparent_temperature),
        precipitationChance: today?.precipitationChance ?? 0,
        windSpeed: Math.round(forecast.current.wind_speed_10m),
        aqi: airQuality?.current?.us_aqi ?? null,
        uvIndex: today?.uvMax ?? 0,
        isDay: Boolean(forecast.current.is_day),
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
          feelsLike: Math.round(forecast.current.apparent_temperature),
        },
        today,
        airQualityDetails,
        bestWindow,
        outdoorScore,
      );
      const concierge = buildConciergeItems(
        {
          feelsLike: Math.round(forecast.current.apparent_temperature),
        },
        today,
        airQualityDetails,
        bestWindow,
        outdoorScore,
      );
      const locationName = buildLocationLabel(location);
      const recentLocation = {
        label: locationName,
        latitude: location.latitude ?? latitude,
        longitude: location.longitude ?? longitude,
      };

      setWeather({
        locationName,
        current: {
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
        },
        today,
        forecast: dailyForecast,
        hourly: hourlyForecast,
        airQuality: airQuality
          ? {
              aqi: Math.round(airQuality.current.us_aqi),
              pm25: Math.round(airQuality.current.pm2_5 * 10) / 10,
              details: airQualityDetails,
            }
          : null,
        outdoorScore,
        daylight: getDaylightProgress(forecast.current.time, today.sunrise, today.sunset),
        bestWindow,
        story,
        concierge,
      });

      setQuery(locationName);

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
    loadWeather({ search: "Toronto" });

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
      });
      return;
    }

    loadWeather({ search: trimmedQuery });
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
          <h1>Weather with atmosphere, strategy, and a sense of occasion.</h1>
          <p className="intro">
            Search any city to unlock a cinematic forecast, air-quality signals, a
            best-time-to-go-out planner, and a living memory of the places you care about.
          </p>
        </div>

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
      </section>

      {error ? <p className="status-message error-message">{error}</p> : null}

      {weather ? (
        <>
          <section className="current-weather-card surface">
            <div className="current-weather-header">
              <div>
                <p className="section-label">Now in</p>
                <h2>{weather.locationName}</h2>
                <p className="current-time">Updated {formatDisplayTime(weather.current.time)}</p>
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
                  <h3>Next 24 hours</h3>
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
                  ? `Your strongest outside window is around ${formatHourLabel(
                      weather.bestWindow.time,
                    )}, when the conditions look most comfortable.`
                  : "Conditions are moving around, so it is worth another look later today."}
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

              return (
                <article className="forecast-card surface" key={day.date} style={{ animationDelay: `${index * 90}ms` }}>
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
                </article>
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
