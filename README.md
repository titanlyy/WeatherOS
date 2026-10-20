# WeatherOS

Singapore weather and haze command center. Live NEA readings — 24-hour PSI, 1-hour PM2.5, station wind, rain, temperature, humidity — plus the 2-hour nowcast, 24-hour forecast, and 4-day outlook.

Two themes: cyberpunk and solarpunk. The map is OpenStreetMap's own tile service, with no API key. The dark theme inverts those tiles. Hover a planning area, such as Ang Mo Kio or Bishan, for the 2-hour forecast, PSI, and the nearest station. Weather icons sit on the NEA forecast points.

## Data

All feeds are the public real-time APIs on [data.gov.sg](https://data.gov.sg), published by the National Environment Agency under the Singapore Open Data Licence. No API key is required. WeatherOS requests them from the server and caches the combined briefing for about 75 seconds so the browser does not trip the public rate limit.

Basemap © OpenStreetMap contributors, from the OpenStreetMap tile service. Planning-area boundaries are the URA Master Plan 2019, Singapore Open Data Licence.

This is not an official NEA site.

## Run

```bash
npm install
npm run dev
```

The dev server listens on port 8080.
