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


def test_dh_start_cycle_initializes_state():
    dh = DHManager()
    ring_order = ["a", "b", "c"]

    dh.start_cycle(ring_order, 7)

    assert dh.active is True
    assert dh.ring == ["a", "b", "c"]
    assert dh.cycle_id == 7


def test_dh_next_client_wraps_around_and_handles_missing():
    dh = DHManager()
    dh.start_cycle(["a", "b", "c"], 1)

    assert dh.next_client("x") is None
    assert dh.next_client("a") == "b"
    assert dh.next_client("b") == "c"
    assert dh.next_client("c") == "a"


def test_dh_reset_clears_state():
    dh = DHManager()
    dh.start_cycle(["a", "b", "c"], 1)

    dh.reset(2)

    assert dh.active is False
    assert dh.ring == []
    assert dh.cycle_id == 2


def test_ring_next_client_returns_none_if_missing_and_wraps():
    r = RingManager()
    r.add_client("a")
    r.add_client("b")
    r.add_client("c")

    assert r.next_client("x") is None
    assert r.next_client("a") == "b"
    assert r.next_client("c") == "a"


def test_ring_is_ready_requires_three_or_more_clients():
    r = RingManager()
    assert r.is_ready() is False

    r.add_client("a")
    assert r.is_ready() is False

    r.add_client("b")
    assert r.is_ready() is False

    r.add_client("c")
    assert r.is_ready() is True


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

    await mgr.relay(clients, "sender", 9, "CIPHER_TEXT", "NONCE_VALUE")

    assert sender_socket.sent == []

    assert len(ok_socket.sent) == 1
    payload = json.loads(ok_socket.sent[0])
    assert payload["type"] == "message"
    assert payload["from"] == "sender"
    assert payload["cycleId"] == 9
    assert payload["cipher"] == "CIPHER_TEXT"
    assert payload["nonce"] == "NONCE_VALUE"

    assert failing_socket.sent == []
