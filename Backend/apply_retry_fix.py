files = [
    "agent_logic.py", "calendar_agent.py", "crypto_agent.py",
    "email_agent.py", "email_reader_agent.py", "rag_agent.py",
    "tavily_agent.py", "weather_agent.py",
]

for fname in files:
    with open(fname, encoding="utf-8") as f:
        content = f.read()

    original = content

    if "from gemini_retry import generate_content_with_retry" not in content:
        content = content.replace(
            "from google import genai",
            "from google import genai\nfrom gemini_retry import generate_content_with_retry",
            1
        )

    content = content.replace(
        "client.models.generate_content(",
        "generate_content_with_retry(client,"
    )

    if content != original:
        with open(fname, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Updated {fname}")
    else:
        print(f"NO CHANGE (check manually): {fname}")