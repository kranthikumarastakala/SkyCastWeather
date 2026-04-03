const googlePlacesApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? "";
const googleMapsScriptId = "skycast-google-maps-script";
const googleMapsCallbackName = "__skycastGoogleMapsReady";

let googleMapsApiPromise = null;
let googlePlacesLibraryPromise = null;

export function isGooglePlacesConfigured() {
  return Boolean(googlePlacesApiKey);
}

function buildGoogleMapsScriptUrl() {
  const searchParams = new URLSearchParams({
    key: googlePlacesApiKey,
    libraries: "places",
    v: "weekly",
    loading: "async",
    callback: googleMapsCallbackName,
  });

  return `https://maps.googleapis.com/maps/api/js?${searchParams.toString()}`;
}

async function loadGoogleMapsApi() {
  if (typeof window === "undefined") {
    throw new Error("Google Places is only available in the browser.");
  }

  if (!googlePlacesApiKey) {
    throw new Error("Google Places API key is not configured.");
  }

  if (window.google?.maps) {
    return window.google.maps;
  }

  if (googleMapsApiPromise) {
    return googleMapsApiPromise;
  }

  googleMapsApiPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(googleMapsScriptId);

    window[googleMapsCallbackName] = () => {
      resolve(window.google.maps);
      delete window[googleMapsCallbackName];
    };

    if (existingScript) {
      existingScript.addEventListener("error", () => {
        googleMapsApiPromise = null;
        reject(new Error("Google Maps JavaScript API could not load."));
      });
      return;
    }

    const script = document.createElement("script");
    script.id = googleMapsScriptId;
    script.async = true;
    script.defer = true;
    script.src = buildGoogleMapsScriptUrl();
    script.onerror = () => {
      googleMapsApiPromise = null;
      delete window[googleMapsCallbackName];
      reject(new Error("Google Maps JavaScript API could not load."));
    };

    document.head.append(script);
  });

  return googleMapsApiPromise;
}

export async function loadGooglePlacesLibrary() {
  if (googlePlacesLibraryPromise) {
    return googlePlacesLibraryPromise;
  }

  googlePlacesLibraryPromise = loadGoogleMapsApi().then(async (maps) =>
    maps.importLibrary ? maps.importLibrary("places") : maps.places,
  );

  return googlePlacesLibraryPromise;
}

export async function createGooglePlacesSessionToken() {
  const places = await loadGooglePlacesLibrary();
  return places.AutocompleteSessionToken ? new places.AutocompleteSessionToken() : null;
}

export async function fetchGooglePlaceSuggestions(input, sessionToken) {
  const places = await loadGooglePlacesLibrary();
  const request = {
    input,
  };

  if (sessionToken) {
    request.sessionToken = sessionToken;
  }

  const response = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
  return response.suggestions ?? [];
}

export async function resolveGooglePlacePrediction(prediction) {
  const place = prediction.toPlace();
  await place.fetchFields({
    fields: ["location"],
  });

  const latitude =
    typeof place.location?.lat === "function" ? place.location.lat() : place.location?.lat;
  const longitude =
    typeof place.location?.lng === "function" ? place.location.lng() : place.location?.lng;

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    throw new Error("Google Places did not return coordinates for this place.");
  }

  return {
    latitude,
    longitude,
  };
}
