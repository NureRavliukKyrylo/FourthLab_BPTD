import asyncio
import json
import websockets

URI = "ws://localhost:8765"

async def client(name: str):
    async with websockets.connect(URI) as ws:
        print(f"[{name}] connected")

        for _ in range(10):
            msg = await ws.recv()
            data = json.loads(msg)
            print(f"[{name}] recv:", data)
            if data.get("type") == "dh_start":
                break

        # після dh_start нічого не робимо, просто читаємо ще повідомлення
        for _ in range(5):
            msg = await ws.recv()
            print(f"[{name}] recv:", json.loads(msg))

async def main():
    await asyncio.gather(
        client("A"),
        client("B"),
        client("C"),
    )

asyncio.run(main())
