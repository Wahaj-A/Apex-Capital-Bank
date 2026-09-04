"""Live cryptocurrency service for the five supported assets.

Primary provider: CoinGecko public markets endpoint.
Fallback provider: CoinPaprika public tickers endpoint when CoinGecko rate-limits
or is temporarily unavailable.

The service keeps a short in-process cache so repeated frontend polling does
not repeatedly hit external providers.
"""
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json
import time
from logger import logger

# Keep provider traffic low while retaining reasonably fresh dashboard data.
_CACHE_TTL_SECONDS = 300  # 5 minutes
_cache: dict[str, tuple[float, list[dict]]] = {}

SUPPORTED_CRYPTO = {
    "Bitcoin": {"id": "bitcoin", "ticker": "BTC", "name": "Bitcoin"},
    "Ethereum": {"id": "ethereum", "ticker": "ETH", "name": "Ethereum"},
    "BNB": {"id": "binancecoin", "ticker": "BNB", "name": "BNB"},
    "Solana": {"id": "solana", "ticker": "SOL", "name": "Solana"},
    "XRP": {"id": "ripple", "ticker": "XRP", "name": "XRP"},
}

_ID_TO_ASSET = {config["id"]: asset for asset, config in SUPPORTED_CRYPTO.items()}


def _normalize_crypto(asset: str) -> str:
    if not asset:
        raise ValueError("Cryptocurrency is required.")
    value = asset.strip().lower()
    aliases = {
        "btc": "Bitcoin", "bitcoin": "Bitcoin",
        "eth": "Ethereum", "ethereum": "Ethereum",
        "bnb": "BNB", "binance coin": "BNB",
        "sol": "Solana", "solana": "Solana",
        "xrp": "XRP", "ripple": "XRP",
    }
    if value in aliases:
        return aliases[value]
    raise ValueError(
        "Unsupported cryptocurrency. Crypto data is available only for "
        "Bitcoin, Ethereum, BNB, Solana, and XRP."
    )


def _cache_get(cache_key: str):
    cached = _cache.get(cache_key)
    if cached and (time.monotonic() - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]
    return None


def _cache_set(cache_key: str, payload: list[dict]):
    _cache[cache_key] = (time.monotonic(), payload)


def _request_json(url: str, timeout: int = 12) -> tuple[int, dict | list]:
    request = Request(url, headers={"User-Agent": "Apex-Capital-Bank-Crypto/1.0"})
    with urlopen(request, timeout=timeout) as response:
        status = getattr(response, "status", 200)
        payload = json.loads(response.read().decode("utf-8"))
        return status, payload


def _request_coingecko(ids: list[str]) -> list[dict]:
    params = urlencode({
        "vs_currency": "usd",
        "ids": ",".join(ids),
        "price_change_percentage": "24h",
    })
    url = f"https://api.coingecko.com/api/v3/coins/markets?{params}"
    status, payload = _request_json(url)
    if status != 200 or not isinstance(payload, list):
        raise RuntimeError(f"CoinGecko returned HTTP {status}")
    logger.info("CRYPTO provider response received from CoinGecko")
    return payload


def _request_coinpaprika(ids: list[str]) -> list[dict]:
    # CoinPaprika provides a free public /tickers endpoint without requiring
    # an API key. Fetch all active tickers in one request, then keep only the
    # five supported assets.
    paprika_ids = {
        "bitcoin": "btc-bitcoin",
        "ethereum": "eth-ethereum",
        "binancecoin": "bnb-binance-coin",
        "solana": "sol-solana",
        "ripple": "xrp-xrp",
    }
    requested = set(paprika_ids[i] for i in ids)
    url = "https://api.coinpaprika.com/v1/tickers?" + urlencode({"quotes": "USD"})
    status, payload = _request_json(url)
    if status != 200 or not isinstance(payload, list):
        raise RuntimeError(f"CoinPaprika returned HTTP {status}")

    reverse = {v: k for k, v in paprika_ids.items()}
    converted = []
    for item in payload:
        paprika_id = item.get("id")
        if paprika_id not in requested:
            continue
        cg_id = reverse[paprika_id]
        usd = (item.get("quotes") or {}).get("USD") or {}
        converted.append({
            "id": cg_id,
            "current_price": float(usd.get("price") or 0),
            "price_change_percentage_24h": float(usd.get("percent_change_24h") or 0),
            "high_24h": 0,
            "low_24h": 0,
            "total_volume": float(usd.get("volume_24h") or 0),
            "last_updated": item.get("last_updated"),
        })

    if len(converted) < len(requested):
        missing = sorted(requested - {item.get("id") for item in payload})
        logger.warning("CRYPTO CoinPaprika returned incomplete data; missing %s", missing)
        if not converted:
            raise RuntimeError("CoinPaprika returned no matching crypto data")

    logger.info("CRYPTO fallback response received from CoinPaprika")
    return converted


def _request_markets(ids: list[str]) -> list[dict]:
    cache_key = "all" if set(ids) == {config["id"] for config in SUPPORTED_CRYPTO.values()} else ",".join(sorted(ids))
    fresh = _cache_get(cache_key)
    if fresh is not None:
        return fresh

    try:
        payload = _request_coingecko(ids)
        _cache_set(cache_key, payload)
        return payload
    except HTTPError as exc:
        logger.warning("CRYPTO CoinGecko HTTP %s; trying fallback provider", exc.code)
    except Exception as exc:
        logger.warning("CRYPTO CoinGecko failed (%s); trying fallback provider", exc)

    try:
        payload = _request_coinpaprika(ids)
        _cache_set(cache_key, payload)
        return payload
    except Exception as fallback_exc:
        stale = _cache.get(cache_key)
        if stale:
            logger.warning("CRYPTO serving stale cached data after provider failures")
            return stale[1]
        logger.exception("CRYPTO CoinPaprika fallback request failed")
        raise RuntimeError(
            f"Crypto providers are temporarily unavailable for {','.join(ids)}: {fallback_exc}"
        ) from fallback_exc


def _to_result(item: dict) -> dict:
    asset = _ID_TO_ASSET[item["id"]]
    config = SUPPORTED_CRYPTO[asset]
    return {
        "name": config["name"],
        "symbol": config["ticker"],
        "pair": f"{config['ticker']}USDT",
        "price_usd": float(item.get("current_price") or 0),
        "price_change_24h_percent": float(item.get("price_change_percentage_24h") or 0),
        "high_24h_usd": float(item.get("high_24h") or 0),
        "low_24h_usd": float(item.get("low_24h") or 0),
        "volume_24h": float(item.get("total_volume") or 0),
        "quote_volume_24h_usd": float(item.get("total_volume") or 0),
        "updated_at": item.get("last_updated"),
        "source": "CoinGecko" if item.get("last_updated") else "CoinPaprika",
    }


def _fetch_asset(asset: str) -> dict:
    asset = _normalize_crypto(asset)
    config = SUPPORTED_CRYPTO[asset]
    # Reuse the same all-assets cache instead of making a second provider call
    # when the user clicks an individual coin after the dashboard loaded.
    all_ids = [item["id"] for item in SUPPORTED_CRYPTO.values()]
    payload = _request_markets(all_ids)
    for item in payload:
        if item.get("id") == config["id"]:
            return _to_result(item)
    raise RuntimeError(f"Crypto provider returned no data for {asset}")


def get_crypto(asset: str) -> dict:
    """Get live 24-hour market data for one supported cryptocurrency."""
    return _fetch_asset(asset)


def get_all_crypto() -> list[dict]:
    """Get live market data for all five supported cryptocurrencies."""
    ids = [config["id"] for config in SUPPORTED_CRYPTO.values()]
    payload = _request_markets(ids)
    results = [_to_result(item) for item in payload if item.get("id") in _ID_TO_ASSET]

    order = list(SUPPORTED_CRYPTO)
    return sorted(results, key=lambda item: order.index(item["name"]))
