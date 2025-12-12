# message_manager.py

class MessageManager:
    def __init__(self):
        pass

    async def relay(self, clients, sender_id, cipher, iv):
        payload = {
            "type": "message",
            "from": sender_id,
            "cipher": cipher,
            "iv": iv
        }

        msg = json_dumps(payload)

        for client in clients:
            if client["id"] != sender_id:
                try:
                    await client["socket"].send(msg)
                except:
                    pass


def json_dumps(obj):
    import json
    return json.dumps(obj)
