import asyncio
import websockets

async def main():
    async with websockets.connect("ws://localhost:8765") as ws:
        for _ in range(4):
            print(await ws.recv())

asyncio.run(main())
