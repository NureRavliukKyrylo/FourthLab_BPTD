import asyncio
import json
import uuid
import websockets

from ring_manager import RingManager
from dh_manager import DHManager
from message_manager import MessageManager

p = int(
    "25195908475657893494027183240048398571429282126204"
    "03202777713783604366202070759555626401852588078440"
    "69182906412495150821892985591491761845028084891200"
    "72844992687392807287776735971418347270261896375014"
    "97182469116507761337985909570009733045974880842840"
    "17974291006424586918171951187461215151726546322822"
    "16869987549182422433637259085141865462043576798423"
    "38718477444792073993423658482382428119816381501067",
    10
)
g = 2

clients = []
clients_by_id = {}
ring = RingManager()
dh = DHManager()
msg_mgr = MessageManager()
cycle_id = 0

async def send_to(client_id, obj):
    ws = clients_by_id.get(client_id)
    if not ws:
        return
    try:
        await ws.send(json.dumps(obj))
    except:
        pass

async def broadcast(obj, exclude_id=None):
    msg = json.dumps(obj)
    for client in clients:
        if client["id"] != exclude_id:
            try:
                await client["socket"].send(msg)
            except:
                pass

async def broadcast_ring():
    await broadcast({
        "type": "ring_update",
        "cycleId": cycle_id,
        "ring": ring.get_ring()
    })

async def announce_dh_state():
    if ring.is_ready():
        order = ring.get_ring()
        dh.start_cycle(order, cycle_id)
        await broadcast({
            "type": "dh_start",
            "cycleId": cycle_id,
            "ring": order,
            "n": len(order)
        })
    else:
        dh.reset(cycle_id)
        await broadcast({
            "type": "dh_unavailable",
            "cycleId": cycle_id,
            "ring": ring.get_ring(),
            "minRequired": 3
        })

async def handle_client(websocket):
    global cycle_id

    client_id = str(uuid.uuid4())
    clients.append({"id": client_id, "socket": websocket})
    clients_by_id[client_id] = websocket
    ring.add_client(client_id)

    cycle_id += 1

    await websocket.send(json.dumps({
        "type": "welcome",
        "id": client_id
    }))

    await websocket.send(json.dumps({
        "type": "init_params",
        "p": str(p),
        "g": str(g)
    }))

    await broadcast({
        "type": "user_joined",
        "cycleId": cycle_id,
        "id": client_id
    }, exclude_id=client_id)

    await broadcast_ring()
    await announce_dh_state()

    try:
        async for raw_message in websocket:
            try:
                data = json.loads(raw_message)
            except:
                continue

            msg_type = data.get("type")

            if msg_type == "message":
                msg_cycle = data.get("cycleId")
                cipher = data.get("cipher")
                nonce = data.get("nonce")

                if msg_cycle != cycle_id or not isinstance(cipher, str) or not isinstance(nonce, str):
                    continue

                await msg_mgr.relay(clients, client_id, cycle_id, cipher, nonce)
                continue

            if msg_type == "dh_round_value":
                msg_cycle = data.get("cycleId")
                origin = data.get("origin")
                hop = data.get("hop")
                value = data.get("value")

                if msg_cycle != cycle_id:
                    continue
                if not dh.active or dh.cycle_id != cycle_id:
                    continue
                if not isinstance(origin, str):
                    continue
                if not isinstance(hop, int):
                    continue
                if not isinstance(value, str):
                    continue

                receiver = dh.next_client(client_id)
                if not receiver:
                    continue

                await send_to(receiver, {
                    "type": "dh_next_value",
                    "cycleId": cycle_id,
                    "from": client_id,
                    "origin": origin,
                    "hop": hop,
                    "value": value
                })
                continue

    except websockets.exceptions.ConnectionClosed:
        pass

    finally:
        cycle_id += 1

        clients[:] = [c for c in clients if c["id"] != client_id]
        clients_by_id.pop(client_id, None)
        ring.remove_client(client_id)

        await broadcast({
            "type": "user_left",
            "cycleId": cycle_id,
            "id": client_id
        })

        await broadcast_ring()
        await announce_dh_state()

async def main():
    async with websockets.serve(handle_client, "localhost", 8765):
        await asyncio.Future()

asyncio.run(main())
