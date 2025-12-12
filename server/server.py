import asyncio
import websockets
import json
import uuid

from ring_manager import RingManager
from dh_manager import DHManager
from message_manager import MessageManager

# Стандартні параметри групи (можна замінити на інші)
# 2048-бітне просте число (безпечне для Diffie-Hellman)
p = int(
    "25195908475657893494027183240048398571429282126204"
    "03202777713783604366202070759555626401852588078440"
    "69182906412495150821892985591491761845028084891200"
    "72844992687392807287776735971418347270261896375014"
    "97182469116507761337985909570009733045974880842840"
    "17974291006424586918171951187461215151726546322822"
    "16869987549182422433637259085141865462043576798423"
    "38718477444792073993423658482382428119816381501067"
    , 10
)

g = 2 


clients = []               # [{"id", "socket"}]
clients_by_id = {}         # { id: websocket }
ring = RingManager()
dh = DHManager()
msg_mgr = MessageManager()

async def send_to(client_id, message: str):
    ws = clients_by_id.get(client_id)
    if ws:
        try:
            await ws.send(message)
        except:
            pass

async def broadcast(message, exclude_id=None):
    for client in clients:
        if client["id"] != exclude_id:
            try:
                await client["socket"].send(message)
            except:
                pass


async def broadcast_ring():
    await broadcast(json.dumps({
        "type": "ring_update",
        "ring": ring.get_ring()
    }))


async def start_dh_cycle():
    if not ring.is_ready():
        print("[DH] Not enough participants for DH cycle")
        return

    order = ring.get_ring()
    dh.start_cycle(order)

    print(f"[DH] Started new DH cycle with ring = {order}")
    
    await broadcast(json.dumps({
        "type": "dh_start",
        "ring": order
    }))


async def handle_client(websocket):
    client_id = str(uuid.uuid4())

    clients.append({"id": client_id, "socket": websocket})
    clients_by_id[client_id] = websocket
    ring.add_client(client_id)

    print(f"[JOIN] {client_id}")

    await websocket.send(json.dumps({
        "type": "welcome",
        "id": client_id
    }))

    await websocket.send(json.dumps({
        "type": "init_params",
        "p": str(p),
        "g": str(g)
    }))

    print(f"[PARAMS] Sent p, g to {client_id}")

    await broadcast(json.dumps({
        "type": "user_joined",
        "id": client_id
    }), exclude_id=client_id)

    await broadcast_ring()

    await start_dh_cycle()

    try:
        async for raw_message in websocket:
            data = json.loads(raw_message)
            
            if data["type"] == "message":
                cipher = data["cipher"]
                iv = data["iv"]

                print(f"[MSG] From {client_id}: {cipher[:20]}...")

                await msg_mgr.relay(clients, client_id, cipher, iv)
                continue

            if data["type"] == "dh_round_value":
                value = data["value"]

                sender = client_id
                receiver = dh.next_client(sender)

                print(f"[DH] {sender} → {receiver}: {value}")
                
                await send_to(receiver, json.dumps({
                    "type": "dh_next_value",
                    "from": sender,
                    "value": value
                }))

                finished = dh.register_transfer()

                if finished:
                    print("[DH] Cycle finished.")

                    await broadcast(json.dumps({
                        "type": "dh_cycle_finished"
                    }))

                    dh.reset()

    except websockets.exceptions.ConnectionClosed:
        pass

    finally:
        print(f"[LEAVE] {client_id}")

        global clients
        clients = [c for c in clients if c["id"] != client_id]
        clients_by_id.pop(client_id, None)

        ring.remove_client(client_id)

        await broadcast(json.dumps({
            "type": "user_left",
            "id": client_id
        }))

        await broadcast_ring()
        await start_dh_cycle()


async def main():
    print("Server started at ws://localhost:8765")
    print("Global DH parameters generated:")
    print("p =", p)
    print("g =", g)

    async with websockets.serve(handle_client, "localhost", 8765):
        await asyncio.Future() 

asyncio.run(main())
