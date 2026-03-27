# SkyCast Weather

A simple React weather app built with Vite. It lets visitors search for a city or use their current location to see current weather and a five-day forecast.

## Run locally

```bash
npm install
npm run dev
```

## Deploy to GitHub Pages

1. Create a GitHub repository and push this project to it.
2. In GitHub, open `Settings -> Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Push to your repository's default branch or run the `Deploy to GitHub Pages` workflow manually from the `Actions` tab.

The workflow file lives at `.github/workflows/deploy.yml`.

Notes:

- `vite.config.js` automatically uses `/` for `username.github.io` repositories and `/<repo-name>/` for standard project repositories during GitHub Actions builds.
- If you later add a custom domain, update the Vite `base` setting to `/`.
