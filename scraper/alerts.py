"""Optional Telegram notifications (free). Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID."""
import os

import requests


def notify(text: str) -> None:
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not (token and chat):
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": text, "disable_web_page_preview": True},
            timeout=15,
        )
    except requests.RequestException:
        pass
