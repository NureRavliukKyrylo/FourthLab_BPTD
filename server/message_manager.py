import json

class MessageManager:
    async def relay(self, clients, sender_id, cycle_id, cipher, nonce):
        payload = {
            "type": "message",
            "from": sender_id,
            "cycleId": cycle_id,
            "cipher": cipher,
            "nonce": nonce
        }
        msg = json.dumps(payload)
        for client in clients:
            if client["id"] != sender_id:
                try:
                    await client["socket"].send(msg)
                except:
                    pass
