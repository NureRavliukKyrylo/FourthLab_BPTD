import { useEffect, useMemo, useRef, useState } from "react";
import { diffie } from "../utils";
import { aesgcm } from "../utils";

type KeyStatus = "idle" | "unavailable" | "generating" | "ready" | "error";

type ChatMsg = {
  id: string;
  kind: "chat" | "system";
  from: string;
  text: string;
  ts: number;
};

type ServerMsg =
  | { type: "welcome"; id: string }
  | { type: "init_params"; p: string; g: string }
  | { type: "ring_update"; cycleId: number; ring: string[] }
  | { type: "dh_start"; cycleId: number; ring: string[]; n: number }
  | { type: "dh_unavailable"; cycleId: number; ring: string[]; minRequired: number }
  | { type: "dh_next_value"; cycleId: number; from: string; origin: string; hop: number; value: string }
  | { type: "message"; from: string; cycleId: number; cipher: string; nonce: string }
  | { type: "user_joined"; cycleId: number; id: string }
  | { type: "user_left"; cycleId: number; id: string };

type ClientMsg =
  | { type: "dh_round_value"; cycleId: number; origin: string; hop: number; value: string }
  | { type: "message"; cycleId: number; cipher: string; nonce: string };

function uid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + String(Math.random());
}

function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function inRing(id: string, ring: string[]): boolean {
  return ring.includes(id);
}

function expectedPrevSenderId(selfId: string, ring: string[]): string | null {
  const idx = ring.indexOf(selfId);
  if (idx < 0) return null;
  const n = ring.length;
  if (n <= 0) return null;
  const prevIdx = (idx - 1 + n) % n;
  return ring[prevIdx] ?? null;
}

export function useSecureChat(wsUrl: string) {
  const wsRef = useRef<WebSocket | null>(null);

  const clientIdRef = useRef<string | null>(null);
  const pRef = useRef<bigint | null>(null);
  const gRef = useRef<bigint | null>(null);
  const cycleIdRef = useRef<number | null>(null);
  const ringRef = useRef<string[]>([]);
  const nRef = useRef<number | null>(null);
  const privateKeyRef = useRef<bigint | null>(null);
  const aesKeyRef = useRef<CryptoKey | null>(null);
  const keyStatusRef = useRef<KeyStatus>("idle");

  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);

  const [clientId, _setClientId] = useState<string | null>(null);
  const [p, _setP] = useState<bigint | null>(null);
  const [g, _setG] = useState<bigint | null>(null);

  const [cycleId, _setCycleId] = useState<number | null>(null);
  const [ring, _setRing] = useState<string[]>([]);
  const [n, _setN] = useState<number | null>(null);

  const [privateKey, _setPrivateKey] = useState<bigint | null>(null);
  const [aesKey, _setAesKey] = useState<CryptoKey | null>(null);
  const [keyStatus, _setKeyStatus] = useState<KeyStatus>("idle");

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [connSeq, setConnSeq] = useState(0);

  function setClientIdSync(v: string | null) {
    clientIdRef.current = v;
    _setClientId(v);
  }

  function setPSync(v: bigint | null) {
    pRef.current = v;
    _setP(v);
  }

  function setGSync(v: bigint | null) {
    gRef.current = v;
    _setG(v);
  }

  function setCycleIdSync(v: number | null) {
    cycleIdRef.current = v;
    _setCycleId(v);
  }

  function setRingSync(v: string[]) {
    ringRef.current = v;
    _setRing(v);
  }

  function setNSync(v: number | null) {
    nRef.current = v;
    _setN(v);
  }

  function setPrivateKeySync(v: bigint | null) {
    privateKeyRef.current = v;
    _setPrivateKey(v);
  }

  function setAesKeySync(v: CryptoKey | null) {
    aesKeyRef.current = v;
    _setAesKey(v);
  }

  function setKeyStatusSync(v: KeyStatus) {
    keyStatusRef.current = v;
    _setKeyStatus(v);
  }

  const canSend = useMemo(() => {
    return connected && keyStatus === "ready" && !!aesKey && cycleId !== null && ring.length >= 3;
  }, [connected, keyStatus, aesKey, cycleId, ring.length]);

  function pushSystem(text: string) {
    setMessages((prev) => [...prev, { id: uid(), kind: "system", from: "system", text, ts: Date.now() }]);
  }

  function pushChat(from: string, text: string) {
    setMessages((prev) => [...prev, { id: uid(), kind: "chat", from, text, ts: Date.now() }]);
  }

  function wsSend(obj: ClientMsg) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function rotateToCycle(newCycleId: number, newRing: string[]) {
    setCycleIdSync(newCycleId);
    setRingSync(newRing);
    setNSync(newRing.length);
    setPrivateKeySync(null);
    setAesKeySync(null);
    if (newRing.length >= 3 && clientIdRef.current && pRef.current && gRef.current) {
      setKeyStatusSync("generating");
    } else {
      setKeyStatusSync("idle");
    }
  }

  async function startDh(cId: number, count: number) {
    const cid = clientIdRef.current;
    const pp = pRef.current;
    const gg = gRef.current;
    const rr = ringRef.current;

    if (!cid || !pp || !gg) {
      setKeyStatusSync("error");
      pushSystem("Cannot start DH: missing clientId or p/g.");
      return;
    }

    if (!inRing(cid, rr) || rr.length !== count) {
      setKeyStatusSync("error");
      pushSystem("Cannot start DH: local ring state is inconsistent.");
      return;
    }

    setKeyStatusSync("generating");
    setAesKeySync(null);

    const priv = diffie.generatePrivateKey(pp);
    setPrivateKeySync(priv);

    const pub = diffie.generatePublicKey(gg, priv, pp);

    wsSend({
      type: "dh_round_value",
      cycleId: cId,
      origin: cid,
      hop: 1,
      value: pub.toString(),
    });

    pushSystem(`DH cycle started (cycleId=${cId}, participants=${count}).`);
  }

  async function finalizeSharedKey(shared: bigint) {
    try {
      const k = await aesgcm.deriveAesGcmKey(shared);
      setAesKeySync(k);
      setKeyStatusSync("ready");
      pushSystem("Key established. Encryption is ready.");
    } catch {
      setKeyStatusSync("error");
      pushSystem("Failed to derive AES key.");
    }
  }

  function validateDhPacket(
    msg: Extract<ServerMsg, { type: "dh_next_value" }>
  ): { ok: true } | { ok: false; reason: string } {
    const currentCycle = cycleIdRef.current;
    const rr = ringRef.current;
    const nn = nRef.current;
    const cid = clientIdRef.current;

    if (currentCycle === null) return { ok: false, reason: "cycleId_not_set" };
    if (msg.cycleId !== currentCycle) return { ok: false, reason: "cycleId_mismatch" };

    if (!cid) return { ok: false, reason: "clientId_missing" };
    if (!inRing(cid, rr)) return { ok: false, reason: "self_not_in_ring" };

    if (!inRing(msg.from, rr)) return { ok: false, reason: "from_not_in_ring" };
    if (!inRing(msg.origin, rr)) return { ok: false, reason: "origin_not_in_ring" };

    if (!nn || nn !== rr.length || nn < 3) return { ok: false, reason: "ring_size_invalid" };

    if (typeof msg.hop !== "number" || msg.hop < 1 || msg.hop > nn) return { ok: false, reason: "hop_out_of_range" };
    if (typeof msg.value !== "string" || msg.value.length === 0) return { ok: false, reason: "value_missing" };

    const expectedPrev = expectedPrevSenderId(cid, rr);
    if (!expectedPrev) return { ok: false, reason: "prev_sender_unknown" };
    if (msg.from !== expectedPrev) return { ok: false, reason: "from_not_prev_in_ring" };

    return { ok: true };
  }

  async function handleDhNextValue(msg: Extract<ServerMsg, { type: "dh_next_value" }>) {
    const vRes = validateDhPacket(msg);
    if (!vRes.ok) {
      pushSystem(`DH packet rejected: ${vRes.reason}.`);
      return;
    }

    const pp = pRef.current;
    const priv = privateKeyRef.current;
    const cid = clientIdRef.current;
    const nn = nRef.current;

    if (!pp || !priv || !cid || !nn) {
      pushSystem("DH packet rejected: missing private key or group parameters.");
      return;
    }

    let v: bigint;
    try {
      v = BigInt(msg.value);
    } catch {
      pushSystem("DH packet rejected: value is not a bigint.");
      return;
    }

    if (msg.origin === cid && msg.hop === nn) {
      await finalizeSharedKey(v);
      return;
    }

    const nextV = diffie.computeIntermediate(v, priv, pp);

    wsSend({
      type: "dh_round_value",
      cycleId: msg.cycleId,
      origin: msg.origin,
      hop: msg.hop + 1,
      value: nextV.toString(),
    });
  }

  async function handleEncryptedMessage(msg: Extract<ServerMsg, { type: "message" }>) {
    const currentCycle = cycleIdRef.current;
    const rr = ringRef.current;
    const k = aesKeyRef.current;
    const ks = keyStatusRef.current;

    if (currentCycle === null || msg.cycleId !== currentCycle) {
      pushSystem("Received a message with a stale cycleId. Ignored.");
      return;
    }

    if (!inRing(msg.from, rr)) {
      pushSystem("Received a message from a sender outside the ring. Ignored.");
      return;
    }

    if (!k || ks !== "ready") {
      pushSystem("Received an encrypted message before the key was ready. Ignored.");
      return;
    }

    try {
      const text = await aesgcm.decryptAesGcm(msg.cipher, msg.nonce, k);
      pushChat(msg.from, text);
    } catch {
      pushSystem("Message decryption failed (keys mismatch or invalid nonce/cipher).");
    }
  }

  function handleServerMsg(raw: ServerMsg) {
    if (raw.type === "welcome") {
      setClientIdSync(raw.id);
      pushSystem(`Connected. clientId=${raw.id}`);
      return;
    }

    if (raw.type === "init_params") {
      try {
        setPSync(BigInt(raw.p));
        setGSync(BigInt(raw.g));
        pushSystem("Received p and g.");
      } catch {
        setKeyStatusSync("error");
        pushSystem("Invalid p/g parameters.");
      }
      return;
    }

    if (raw.type === "ring_update") {
      const current = cycleIdRef.current;
      if (current === null || raw.cycleId !== current) {
        rotateToCycle(raw.cycleId, raw.ring);
        pushSystem(`Ring updated (cycleId=${raw.cycleId}, participants=${raw.ring.length}).`);
      } else {
        setRingSync(raw.ring);
        setNSync(raw.ring.length);
      }
      return;
    }

    if (raw.type === "dh_unavailable") {
      const current = cycleIdRef.current;
      if (current === null || raw.cycleId !== current) {
        rotateToCycle(raw.cycleId, raw.ring);
      }
      setAesKeySync(null);
      setPrivateKeySync(null);
      setKeyStatusSync("unavailable");
      pushSystem(`DH unavailable: at least ${raw.minRequired} participants are required.`);
      return;
    }

    if (raw.type === "dh_start") {
      const current = cycleIdRef.current;
      if (current === null || raw.cycleId !== current) {
        rotateToCycle(raw.cycleId, raw.ring);
      } else {
        setRingSync(raw.ring);
        setNSync(raw.n);
      }
      void startDh(raw.cycleId, raw.n);
      return;
    }

    if (raw.type === "dh_next_value") {
      void handleDhNextValue(raw);
      return;
    }

    if (raw.type === "message") {
      void handleEncryptedMessage(raw);
      return;
    }

    if (raw.type === "user_joined") {
      pushSystem(`User joined: ${raw.id}`);
      return;
    }

    if (raw.type === "user_left") {
      pushSystem(`User left: ${raw.id}`);
      return;
    }
  }

  useEffect(() => {
    setConnError(null);
    setConnected(false);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setConnError(null);
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setConnError("WebSocket connection error.");
    };

    ws.onmessage = (ev) => {
      const parsed = safeJsonParse(String(ev.data));
      if (!parsed || typeof parsed !== "object") return;
      const msg = parsed as ServerMsg;
      if (!msg.type || typeof msg.type !== "string") return;
      handleServerMsg(msg);
    };

    return () => {
      try {
        ws.close();
      } catch {
        return;
      }
    };
  }, [wsUrl, connSeq]);

  async function sendPlaintext(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const currentCycle = cycleIdRef.current;
    const rr = ringRef.current;
    const cid = clientIdRef.current;
    const ks = keyStatusRef.current;
    const k = aesKeyRef.current;

    if (!connected) {
      pushSystem("Send blocked: no WebSocket connection.");
      return;
    }

    if (currentCycle === null || !cid || !inRing(cid, rr)) {
      pushSystem("Send blocked: ring state is not ready.");
      return;
    }

    if (rr.length < 3) {
      pushSystem("Send blocked: at least 3 participants are required.");
      return;
    }

    if (ks !== "ready" || !k) {
      pushSystem("Send blocked: encryption key is not ready.");
      return;
    }

    try {
      const enc = await aesgcm.encryptAesGcm(trimmed, k);
      wsSend({ type: "message", cycleId: currentCycle, cipher: enc.cipher, nonce: enc.nonce });
      pushChat("me", trimmed);
    } catch {
      pushSystem("Message encryption failed.");
    }
  }

  function disconnect() {
    const ws = wsRef.current;
    if (ws) {
      try {
        ws.close();
      } catch {
        return;
      }
    }
  }

  function resetUiState() {
    setClientIdSync(null);
    setPSync(null);
    setGSync(null);
    setCycleIdSync(null);
    setRingSync([]);
    setNSync(null);
    setPrivateKeySync(null);
    setAesKeySync(null);
    setKeyStatusSync("idle");
    setMessages([]);
  }

  function reconnect() {
    disconnect();
    resetUiState();
    setConnSeq((x) => x + 1);
  }

  return {
    connected,
    connError,
    clientId,
    cycleId,
    ring,
    n,
    keyStatus,
    canSend,
    messages,
    sendPlaintext,
    disconnect,
    reconnect,
  };
}
