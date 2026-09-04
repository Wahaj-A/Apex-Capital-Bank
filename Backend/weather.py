"""Weather service for the five supported cities.

Uses Open-Meteo's live forecast endpoint. No weather API key is required.
The five-city dashboard is fetched in one provider request and cached to avoid
repeated requests from the frontend and to reduce cloud-hosting rate limits.
"""
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import time
from logger import logger

SUPPORTED_CITIES = {
    "Lahore": {"latitude": 31.5204, "longitude": 74.3587},
    "Karachi": {"latitude": 24.8607, "longitude": 67.0011},
    "Islamabad": {"latitude": 33.6844, "longitude": 73.0479},
    "Peshawar": {"latitude": 34.0151, "longitude": 71.5249},
    "Quetta": {"latitude": 30.1798, "longitude": 66.9750},
}

WEATHER_CODES = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog", 51: "Light drizzle",
    53: "Moderate drizzle", 55: "Dense drizzle", 56: "Light freezing drizzle",
    57: "Dense freezing drizzle", 61: "Slight rain", 63: "Moderate rain",
    65: "Heavy rain", 66: "Light freezing rain", 67: "Heavy freezing rain",
    71: "Slight snow fall", 73: "Moderate snow fall", 75: "Heavy snow fall",
    77: "Snow grains", 80: "Slight rain showers", 81: "Moderate rain showers",
    82: "Violent rain showers", 85: "Slight snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}

_CACHE_TTL_SECONDS = 600  # 10 minutes; matches the dashboard refresh cadence.
_cache: dict[str, tuple[float, object]] = {}


def _normalize_city(city: str) -> str:
    if not city:
        raise ValueError("City is required.")
    value = city.strip().lower()
    for supported in SUPPORTED_CITIES:
        if supported.lower() == value:
            return supported
    raise ValueError(
        "Unsupported city. Weather is available only for Lahore, Karachi, "
        "Islamabad, Peshawar, and Quetta."
    )


def _parse_payload(city: str, payload: dict) -> dict:
    current = payload.get("current", {})
    daily = payload.get("daily", {})

    forecast = []
    days = daily.get("time", [])
    for i, date in enumerate(days):
        forecast.append({
            "date": date,
            "weather_code": daily.get("weather_code", [None] * len(days))[i],
            "condition": WEATHER_CODES.get(
                daily.get("weather_code", [None] * len(days))[i], "Unknown"
            ),
            "max_temperature": daily.get("temperature_2m_max", [None] * len(days))[i],
            "min_temperature": daily.get("temperature_2m_min", [None] * len(days))[i],
            "precipitation_probability": daily.get(
                "precipitation_probability_max", [None] * len(days)
            )[i],
            "precipitation": daily.get("precipitation_sum", [None] * len(days))[i],
            "max_wind_speed": daily.get("wind_speed_10m_max", [None] * len(days))[i],
            "sunrise": daily.get("sunrise", [None] * len(days))[i],
            "sunset": daily.get("sunset", [None] * len(days))[i],
        })

    return {
        "city": city,
        "latitude": payload.get("latitude"),
        "longitude": payload.get("longitude"),
        "timezone": payload.get("timezone"),
        "updated_at": current.get("time"),
        "current": {
            "temperature": current.get("temperature_2m"),
            "feels_like": current.get("apparent_temperature"),
            "humidity": current.get("relative_humidity_2m"),
            "wind_speed": current.get("wind_speed_10m"),
            "precipitation": current.get("precipitation"),
            "weather_code": current.get("weather_code"),
            "condition": WEATHER_CODES.get(current.get("weather_code"), "Unknown"),
            "is_day": current.get("is_day"),
        },
        "forecast": forecast,
        "units": {"temperature": "°C", "wind_speed": "km/h", "precipitation": "mm"},
        "source": "Open-Meteo",
    }


def _provider_params(latitudes: list[float], longitudes: list[float]) -> dict:
    return {
        "latitude": ",".join(str(v) for v in latitudes),
        "longitude": ",".join(str(v) for v in longitudes),
        "current": ",".join([
            "temperature_2m", "relative_humidity_2m", "apparent_temperature",
            "weather_code", "wind_speed_10m", "precipitation", "is_day",
        ]),
        "daily": ",".join([
            "weather_code", "temperature_2m_max", "temperature_2m_min",
            "precipitation_probability_max", "precipitation_sum",
            "wind_speed_10m_max", "sunrise", "sunset",
        ]),
        "forecast_days": 5,
        "timezone": "auto",
        "temperature_unit": "celsius",
        "wind_speed_unit": "kmh",
    }


def _fetch_all_cities_from_provider() -> list[dict]:
    cities = list(SUPPORTED_CITIES)
    coords = [SUPPORTED_CITIES[city] for city in cities]
    params = _provider_params(
        [c["latitude"] for c in coords],
        [c["longitude"] for c in coords],
    )
    url = "https://api.open-meteo.com/v1/forecast?" + urlencode(params)
    request = Request(url, headers={"User-Agent": "Apex-Capital-Bank-Weather/1.0"})

    last_error = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=15) as response:
                payload = json.loads(response.read().decode("utf-8"))
            logger.info("WEATHER provider response received for all five cities")
            break
        except HTTPError as exc:
            last_error = exc
            if exc.code == 429 and attempt < 2:
                retry_after = exc.headers.get("Retry-After")
                try:
                    delay = min(max(float(retry_after), 1.0), 30.0) if retry_after else (2 ** attempt)
                except (TypeError, ValueError):
                    delay = 2 ** attempt
                logger.warning("WEATHER provider HTTP 429; retrying in %.1fs", delay)
                time.sleep(delay)
                continue
            logger.warning("WEATHER provider HTTP %s", exc.code)
            raise
        except URLError as exc:
            last_error = exc
            if attempt < 2:
                delay = 2 ** attempt
                logger.warning("WEATHER provider network/DNS error; retrying in %ss: %s", delay, exc.reason)
                time.sleep(delay)
                continue
            logger.exception("WEATHER provider network request failed")
            raise
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                delay = 2 ** attempt
                logger.warning("WEATHER provider error; retrying in %ss: %s", delay, exc)
                time.sleep(delay)
                continue
            logger.exception("WEATHER provider request failed")
            raise
    else:
        raise RuntimeError("Weather provider request failed after retries") from last_error

    # Open-Meteo returns a list for multiple coordinate pairs.
    if not isinstance(payload, list):
        payload = [payload]

    results = []
    for idx, city in enumerate(cities):
        if idx >= len(payload) or not isinstance(payload[idx], dict):
            logger.warning("WEATHER no payload returned for %s", city)
            continue
        results.append(_parse_payload(city, payload[idx]))
    return results


def get_all_weather() -> list[dict]:
    """Get weather for all five cities with one cached provider request."""
    cached = _cache.get("all")
    if cached and (time.monotonic() - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]

    try:
        results = _fetch_all_cities_from_provider()
        if results:
            _cache["all"] = (time.monotonic(), results)
            for item in results:
                _cache[item["city"].lower()] = (time.monotonic(), item)
            return results
    except Exception:
        stale = _cache.get("all")
        if stale:
            logger.warning("WEATHER serving stale cached data after provider error")
            return stale[1]
        raise RuntimeError("Weather provider is temporarily unavailable. Please try again shortly.")

    raise RuntimeError("Weather provider returned no data.")


def get_weather(city: str) -> dict:
    """Get current weather and a 5-day forecast for one supported city."""
    city = _normalize_city(city)
    cached = _cache.get(city.lower())
    if cached and (time.monotonic() - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]

    # Reuse the batched request so a single-city click does not create another
    # external request when the dashboard data is already close to fresh.
    all_weather = get_all_weather()
    for item in all_weather:
        if item["city"].lower() == city.lower():
            return item
    raise RuntimeError(f"Weather provider returned no data for {city}.")
