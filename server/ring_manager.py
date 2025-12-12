# ring_manager.py

class RingManager:
    def __init__(self):
        self.ring = []

    def add_client(self, client_id: str):
        self.ring.append(client_id)

    def remove_client(self, client_id: str):
        self.ring = [c for c in self.ring if c != client_id]

    def get_ring(self):
        return self.ring

    def next_client(self, client_id: str):
        if client_id not in self.ring:
            return None
        
        idx = self.ring.index(client_id)
        next_idx = (idx + 1) % len(self.ring)
        return self.ring[next_idx]

    def is_ready(self):
        return len(self.ring) >= 2
