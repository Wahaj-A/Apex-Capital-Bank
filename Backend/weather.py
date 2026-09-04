"""Weather service for the five supported cities.

Primary provider: Open-Meteo (batched five-city request).
Fallback provider: MET Norway Locationforecast, used when Open-Meteo is
rate-limited or temporarily unreachable from the hosting environment.

Results are cached in-process to avoid unnecessary provider traffic.
"""
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from datetime import datetime, timezone
from collections import defaultdict
import json
import math
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

# MET Norway symbol codes use names rather than Open-Meteo numeric codes.
MET_CONDITIONS = {
    "clearsky": "Clear sky", "fair": "Mainly clear", "partlycloudy": "Partly cloudy",
    "cloudy": "Cloudy", "fog": "Fog", "lightrain": "Light rain",
    "rain": "Rain", "heavyrain": "Heavy rain", "lightrainshowers": "Light rain showers",
    "rainshowers": "Rain showers", "heavyrainshowers": "Heavy rain showers",
    "lightsleet": "Light sleet", "sleet": "Sleet", "heavysleet": "Heavy sleet",
    "lightsnow": "Light snow", "snow": "Snow", "heavysnow": "Heavy snow",
    "lightsnowshowers": "Light snow showers", "snowshowers": "Snow showers",
    "heavysnowshowers": "Heavy snow showers", "lightrainandthunder": "Light rain and thunder",
    "rainandthunder": "Rain and thunder", "heavyrainandthunder": "Heavy rain and thunder",
    "lightrainshowersandthunder": "Light rain showers and thunder",
    "rainshowersandthunder": "Rain showers and thunder",
    "heavyrainshowersandthunder": "Heavy rain showers and thunder",
    "lightsnowandthunder": "Light snow and thunder", "snowandthunder": "Snow and thunder",
    "heavysnowandthunder": "Heavy snow and thunder",
    "lightsnowshowersandthunder": "Light snow showers and thunder",
    "snowshowersandthunder": "Snow showers and thunder",
    "heavysnowshowersandthunder": "Heavy snow showers and thunder",
}

_CACHE_TTL_SECONDS = 600  # 10 minutes.
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


def _safe_at(values, index):
    return values[index] if index < len(values) else None


def _parse_open_meteo_payload(city: str, payload: dict) -> dict:
    current = payload.get("current", {})
    daily = payload.get("daily", {})

    forecast = []
    days = daily.get("time", [])
    for i, date in enumerate(days):
        code = _safe_at(daily.get("weather_code", []), i)
        forecast.append({
            "date": date,
            "weather_code": code,
            "condition": WEATHER_CODES.get(code, "Unknown"),
            "max_temperature": _safe_at(daily.get("temperature_2m_max", []), i),
            "min_temperature": _safe_at(daily.get("temperature_2m_min", []), i),
            "precipitation_probability": _safe_at(daily.get("precipitation_probability_max", []), i),
            "precipitation": _safe_at(daily.get("precipitation_sum", []), i),
            "max_wind_speed": _safe_at(daily.get("wind_speed_10m_max", []), i),
            "sunrise": _safe_at(daily.get("sunrise", []), i),
            "sunset": _safe_at(daily.get("sunset", []), i),
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


def _fetch_json(url: str, headers: dict[str, str], attempts: int = 3) -> object:
    last_error = None
    for attempt in range(attempts):
        request = Request(url, headers=headers)
        try:
            with urlopen(request, timeout=15) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            last_error = exc
            if exc.code == 429 and attempt < attempts - 1:
                retry_after = exc.headers.get("Retry-After")
                try:
                    delay = min(max(float(retry_after), 1.0), 30.0) if retry_after else (2 ** attempt)
                except (TypeError, ValueError):
                    delay = 2 ** attempt
                time.sleep(delay)
                continue
            raise
        except URLError as exc:
            last_error = exc
            if attempt < attempts - 1:
                time.sleep(2 ** attempt)
                continue
            raise
    raise RuntimeError("Weather provider request failed") from last_error


def _fetch_open_meteo() -> list[dict]:
    cities = list(SUPPORTED_CITIES)
    coords = [SUPPORTED_CITIES[city] for city in cities]
    params = _provider_params(
        [c["latitude"] for c in coords],
        [c["longitude"] for c in coords],
    )
    url = "https://api.open-meteo.com/v1/forecast?" + urlencode(params)
    payload = _fetch_json(
        url,
        {"User-Agent": "Apex-Capital-Bank-Weather/2.0 (+https://github.com/Wahaj-A)"},
    )
    if not isinstance(payload, list):
        payload = [payload]

    results = []
    for idx, city in enumerate(cities):
        if idx >= len(payload) or not isinstance(payload[idx], dict):
            continue
        results.append(_parse_open_meteo_payload(city, payload[idx]))
    if len(results) != len(cities):
        raise RuntimeError("Open-Meteo returned incomplete multi-city data")
    return results


def _met_condition(symbol_code: str | None) -> str:
    base = (symbol_code or "").split("_")[0]
    return MET_CONDITIONS.get(base, base.replace("_", " ").title() if base else "Unknown")


def _parse_met_city(city: str, payload: dict) -> dict:
    series = payload.get("properties", {}).get("timeseries", [])
    if not series:
        raise RuntimeError(f"MET Norway returned no forecast for {city}")

    rows = []
    for item in series:
        try:
            dt = datetime.fromisoformat(item["time"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        data = item.get("data", {})
        instant = data.get("instant", {}).get("details", {})
        next_hour = data.get("next_1_hours", {})
        summary = next_hour.get("summary", {})
        symbol = summary.get("symbol_code")
        precip = next_hour.get("details", {}).get("precipitation_amount", 0.0)
        rows.append({
            "time": dt,
            "temperature": instant.get("air_temperature"),
            "humidity": instant.get("relative_humidity"),
            "wind_speed": instant.get("wind_speed"),
            "precipitation": precip or 0.0,
            "symbol": symbol,
        })

    if not rows:
        raise RuntimeError(f"MET Norway returned unusable forecast for {city}")

    rows.sort(key=lambda x: x["time"])
    current_row = rows[0]

    # Group the forecast into local calendar days. The API timestamps carry
    # offsets, so we preserve those local dates directly.
    by_date: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_date[row["time"].date().isoformat()].append(row)

    forecast = []
    for date in list(by_date.keys())[:5]:
        day_rows = by_date[date]
        temps = [r["temperature"] for r in day_rows if isinstance(r["temperature"], (int, float))]
        winds = [r["wind_speed"] for r in day_rows if isinstance(r["wind_speed"], (int, float))]
        precip = sum(
            r["precipitation"] for r in day_rows
            if isinstance(r["precipitation"], (int, float)) and math.isfinite(r["precipitation"])
        )
        noon = min(
            day_rows,
            key=lambda r: abs((r["time"].hour + r["time"].minute / 60.0) - 12.0),
        )
        forecast.append({
            "date": date,
            "weather_code": noon.get("symbol"),
            "condition": _met_condition(noon.get("symbol")),
            "max_temperature": max(temps) if temps else None,
            "min_temperature": min(temps) if temps else None,
            "precipitation_probability": None,
            "precipitation": round(precip, 2),
            "max_wind_speed": max(winds) if winds else None,
            "sunrise": None,
            "sunset": None,
        })

    coords = SUPPORTED_CITIES[city]
    return {
        "city": city,
        "latitude": coords["latitude"],
        "longitude": coords["longitude"],
        "timezone": str(current_row["time"].tzinfo),
        "updated_at": current_row["time"].isoformat(),
        "current": {
            "temperature": current_row.get("temperature"),
            "feels_like": None,
            "humidity": current_row.get("humidity"),
            "wind_speed": current_row.get("wind_speed"),
            "precipitation": current_row.get("precipitation", 0.0),
            "weather_code": current_row.get("symbol"),
            "condition": _met_condition(current_row.get("symbol")),
            "is_day": 1 if 6 <= current_row["time"].hour < 18 else 0,
        },
        "forecast": forecast,
        "units": {"temperature": "°C", "wind_speed": "m/s", "precipitation": "mm"},
        "source": "MET Norway",
    }


def _fetch_met_norway() -> list[dict]:
    results = []
    headers = {
        "User-Agent": "Apex-Capital-Bank/2.0 (+https://github.com/Wahaj-A; portfolio weather dashboard)"
    }
    for city, coords in SUPPORTED_CITIES.items():
        params = urlencode({"lat": coords["latitude"], "lon": coords["longitude"]})
        url = "https://api.met.no/weatherapi/locationforecast/2.0/compact?" + params
        payload = _fetch_json(url, headers=headers, attempts=2)
        results.append(_parse_met_city(city, payload))
        # Keep fallback traffic gentle; five city requests are only made when
        # the primary provider is unavailable and the result is cached.
        time.sleep(0.2)
    if len(results) != len(SUPPORTED_CITIES):
        raise RuntimeError("MET Norway returned incomplete city data")
    return results


def get_all_weather() -> list[dict]:
    """Get weather for all five cities with caching and provider fallback."""
    cached = _cache.get("all")
    if cached and (time.monotonic() - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]

    try:
        results = _fetch_open_meteo()
        logger.info("WEATHER Open-Meteo provider response received for all five cities")
    except Exception as primary_error:
        logger.warning("WEATHER Open-Meteo unavailable; using MET Norway fallback: %s", primary_error)
        try:
            results = _fetch_met_norway()
            logger.info("WEATHER MET Norway fallback response received for all five cities")
        except Exception as fallback_error:
            stale = _cache.get("all")
            if stale:
                logger.warning("WEATHER serving stale cached data after both providers failed")
                return stale[1]
            logger.exception("WEATHER both providers unavailable: %s", fallback_error)
            raise RuntimeError("Weather providers are temporarily unavailable. Please try again shortly.") from fallback_error

    if not results:
        stale = _cache.get("all")
        if stale:
            return stale[1]
        raise RuntimeError("Weather providers returned no data.")

    now = time.monotonic()
    _cache["all"] = (now, results)
    for item in results:
        _cache[item["city"].lower()] = (now, item)
    return results


def get_weather(city: str) -> dict:
    """Get current weather and a 5-day forecast for one supported city."""
    city = _normalize_city(city)
    cached = _cache.get(city.lower())
    if cached and (time.monotonic() - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]

    all_weather = get_all_weather()
    for item in all_weather:
        if item["city"].lower() == city.lower():
            return item
    raise RuntimeError(f"Weather provider returned no data for {city}.")
