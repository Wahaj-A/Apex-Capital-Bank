"""Live cryptocurrency service for the five supported assets.

Uses CoinGecko's free public "coins/markets" endpoint. No crypto API key
is required. (Previously used Binance, which returns HTTP 451 for requests
originating from many cloud-hosting IP ranges, including common PaaS
providers -- CoinGecko does not impose that restriction.)
"""
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import json
from logger import logger


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


def _request_markets(ids: list[str]) -> list[dict]:
    params = urlencode({
        "vs_currency": "usd",
        "ids": ",".join(ids),
        "price_change_percentage": "24h",
    })
    url = f"https://api.coingecko.com/api/v3/coins/markets?{params}"
    request = Request(url, headers={"User-Agent": "Apex-Capital-Bank-Crypto/1.0"})

    try:
        with urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))
        logger.info("CRYPTO provider response received successfully")
    except Exception as exc:
        logger.exception("CRYPTO provider request failed")
        raise RuntimeError(f"Crypto provider request failed for {','.join(ids)}: {exc}") from exc

    return payload


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
        "source": "CoinGecko",
    }


def _fetch_asset(asset: str) -> dict:
    asset = _normalize_crypto(asset)
    config = SUPPORTED_CRYPTO[asset]
    payload = _request_markets([config["id"]])
    if not payload:
        raise RuntimeError(f"Crypto provider returned no data for {asset}")
    return _to_result(payload[0])


def get_crypto(asset: str) -> dict:
    """Get live 24-hour market data for one supported cryptocurrency."""
    return _fetch_asset(asset)


def get_all_crypto() -> list[dict]:
    """Get live market data for all five supported cryptocurrencies."""
    ids = [config["id"] for config in SUPPORTED_CRYPTO.values()]
    payload = _request_markets(ids)
    results = [_to_result(item) for item in payload]

    order = list(SUPPORTED_CRYPTO)
    return sorted(results, key=lambda item: order.index(item["name"]))