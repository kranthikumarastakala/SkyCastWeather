# SkyCast Weather

A simple React weather app built with Vite. It lets visitors search for a city or use their current location to see current weather and a five-day forecast.

## Run locally

```bash
npm install
npm run dev
```

## Google Places autocomplete

The location textboxes can use Google Places autocomplete if you add a Google Maps API key.

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_GOOGLE_MAPS_API_KEY` to your key.
3. In Google Cloud, enable `Maps JavaScript API`, `Places API`, and `Places API (New)`.

If the key is missing, the app falls back to its built-in location search so development still works.

## Deploy to GitHub Pages

1. Create a GitHub repository and push this project to it.
2. In GitHub, open `Settings -> Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Push to your repository's default branch or run the `Deploy to GitHub Pages` workflow manually from the `Actions` tab.

The workflow file lives at `.github/workflows/deploy.yml`.

Notes:

- `vite.config.js` automatically uses `/` for `username.github.io` repositories and `/<repo-name>/` for standard project repositories during GitHub Actions builds.
- If you later add a custom domain, update the Vite `base` setting to `/`.
