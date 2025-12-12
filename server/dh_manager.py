# dh_manager.py

class DHManager:
    def __init__(self):
        self.active = False
        self.ring = []
        self.starting_client = None
        self.round_starter = None
        self.completed_transfers = 0

    def start_cycle(self, ring_order):
        self.active = True
        self.ring = ring_order.copy()
        self.starting_client = ring_order[0]
        self.round_starter = ring_order[0]
        self.completed_transfers = 0

    def next_client(self, current_id):
        idx = self.ring.index(current_id)
        next_idx = (idx + 1) % len(self.ring)
        return self.ring[next_idx]

    def register_transfer(self):
        self.completed_transfers += 1
        return self.completed_transfers >= len(self.ring)

    def reset(self):
        self.active = False
        self.ring = []
        self.starting_client = None
        self.round_starter = None
        self.completed_transfers = 0
