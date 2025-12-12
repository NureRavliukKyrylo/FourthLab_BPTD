import json
import pytest

from dh_manager import DHManager
from ring_manager import RingManager
from message_manager import MessageManager


class DummySocket:
    def __init__(self, should_fail=False):
        self.should_fail = should_fail
        self.sent = []

    async def send(self, msg: str):
        if self.should_fail:
            raise RuntimeError("send failed")
        self.sent.append(msg)


#DHManager

def test_dh_start_cycle_initializes_state():
    dh = DHManager()
    ring_order = ["a", "b", "c"]

    dh.start_cycle(ring_order)

    assert dh.active is True
    assert dh.ring == ["a", "b", "c"]
    assert dh.starting_client == "a"
    assert dh.round_starter == "a"
    assert dh.completed_transfers == 0


def test_dh_next_client_wraps_around():
    dh = DHManager()
    dh.start_cycle(["a", "b", "c"])

    assert dh.next_client("a") == "b"
    assert dh.next_client("b") == "c"
    assert dh.next_client("c") == "a"  # wrap


def test_dh_register_transfer_finishes_after_full_ring_len():
    dh = DHManager()
    dh.start_cycle(["a", "b", "c"])

    assert dh.register_transfer() is False  # 1/3
    assert dh.register_transfer() is False  # 2/3
    assert dh.register_transfer() is True   # 3/3 -> finished


def test_dh_reset_clears_state():
    dh = DHManager()
    dh.start_cycle(["a", "b"])
    dh.register_transfer()

    dh.reset()

    assert dh.active is False
    assert dh.ring == []
    assert dh.starting_client is None
    assert dh.round_starter is None
    assert dh.completed_transfers == 0


#RingManager (2 тести)

def test_ring_next_client_returns_none_if_missing_and_wraps():
    r = RingManager()
    r.add_client("a")
    r.add_client("b")
    r.add_client("c")

    assert r.next_client("x") is None
    assert r.next_client("a") == "b"
    assert r.next_client("c") == "a"  # wrap


def test_ring_is_ready_requires_two_or_more_clients():
    r = RingManager()
    assert r.is_ready() is False

    r.add_client("a")
    assert r.is_ready() is False

    r.add_client("b")
    assert r.is_ready() is True


#MessageManager

@pytest.mark.asyncio
async def test_message_relay_sends_to_all_except_sender_and_ignores_errors():
    mgr = MessageManager()

    sender_socket = DummySocket()
    ok_socket = DummySocket()
    failing_socket = DummySocket(should_fail=True)

    clients = [
        {"id": "sender", "socket": sender_socket},
        {"id": "ok", "socket": ok_socket},
        {"id": "fail", "socket": failing_socket},
    ]

    await mgr.relay(clients, "sender", "CIPHER_TEXT", "IV_VALUE")

    assert sender_socket.sent == []

    assert len(ok_socket.sent) == 1
    payload = json.loads(ok_socket.sent[0])
    assert payload["type"] == "message"
    assert payload["from"] == "sender"
    assert payload["cipher"] == "CIPHER_TEXT"
    assert payload["iv"] == "IV_VALUE"

    assert failing_socket.sent == []
