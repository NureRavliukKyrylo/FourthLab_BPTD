class DHManager:
    def __init__(self):
        self.active = False
        self.ring = []
        self.cycle_id = 0

    def start_cycle(self, ring_order, cycle_id: int):
        self.active = True
        self.ring = ring_order.copy()
        self.cycle_id = cycle_id

    def next_client(self, current_id: str):
        if current_id not in self.ring:
            return None
        idx = self.ring.index(current_id)
        next_idx = (idx + 1) % len(self.ring)
        return self.ring[next_idx]

    def reset(self, cycle_id: int):
        self.active = False
        self.ring = []
        self.cycle_id = cycle_id
