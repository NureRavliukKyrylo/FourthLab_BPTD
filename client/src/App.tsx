import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { useSecureChat } from "./secure-chat/useSecureChat";

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function dotClass(connected: boolean, keyStatus: string) {
  if (!connected) return "dot err";
  if (keyStatus === "ready") return "dot ok";
  if (keyStatus === "generating") return "dot warn";
  if (keyStatus === "unavailable") return "dot warn";
  if (keyStatus === "error") return "dot err";
  return "dot";
}

function keyLabel(keyStatus: string) {
  if (keyStatus === "ready") return "ready";
  if (keyStatus === "generating") return "generating";
  if (keyStatus === "unavailable") return "DH unavailable";
  if (keyStatus === "error") return "error";
  return "idle";
}

function initials(id: string) {
  return id.slice(0, 2).toUpperCase();
}

export default function App() {
  const wsUrl = useMemo(() => "ws://localhost:8765", []);
  const chat = useSecureChat(wsUrl);

  const [text, setText] = useState("");

  const streamRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat.messages.length]);

  const connected = chat.connected;
  const statusDot = dotClass(connected, chat.keyStatus);

  const ring = chat.ring ?? [];
  const myId = chat.clientId ?? null;

  return (
    <div className="app">
      <div className="shell">
        <aside className="panel sidebar">
          <div className="sidebarTop">
            <div className="brandRow">
              <div className="brand">
                <div className="brandTitle">Laboratory work No4</div>
                <div className="brandSub">WebSocket · DH (ring) · AES-GCM</div>
              </div>
              <div className={statusDot} />
            </div>

            <div className="pills">
              <div className="pill">
                <span className={connected ? "dot ok" : "dot err"} />
                {connected ? "WS connected" : "WS disconnected"}
              </div>
              <div className="pill">
                <span
                  className={
                    chat.keyStatus === "ready"
                      ? "dot ok"
                      : chat.keyStatus === "error"
                      ? "dot err"
                      : "dot warn"
                  }
                />
                Key: {keyLabel(chat.keyStatus)}
              </div>
              <div className="pill">Participants: {ring.length}</div>
              <div className="pill">cycleId: {chat.cycleId ?? "-"}</div>
            </div>
          </div>

          <div className="kv">
            <div className="kvRow">
              <div className="k">WS</div>
              <div className="v">{wsUrl}</div>
            </div>
            <div className="kvRow">
              <div className="k">clientId</div>
              <div className="v">{chat.clientId ?? "-"}</div>
            </div>
            <div className="kvRow">
              <div className="k">canSend</div>
              <div className="v">{chat.canSend ? "true" : "false"}</div>
            </div>
          </div>

          <div className="section">
            <div className="sectionTitleRow">
              <div className="sectionTitle">Ring members</div>
              <div className="countBadge">{ring.length}</div>
            </div>

            <div className="memberList">
              {ring.map((id) => (
                <div className="member" key={id}>
                  <div className="memberLeft">
                    <div className="avatar">{initials(id)}</div>
                    <div className="memberId">{id}</div>
                  </div>
                  {myId && id === myId ? <div className="meTag">me</div> : null}
                </div>
              ))}
            </div>
          </div>

          <div className="sidebarBottom">
            <button className="btn" onClick={chat.disconnect} disabled={!chat.connected}>
              Disconnect
            </button>
            <button className="btn btnPrimary" onClick={chat.reconnect}>
              Reconnect
            </button>
          </div>
        </aside>

        <section className="panel content">
          <div className="contentTop">
            <div className="contentTitle">
              <p className="h1">Conversation</p>
              <p className="h2">
                Messages are encrypted locally; the server only relays ciphertext.
              </p>
            </div>
            <div className="statusLine">
              <div className="chip">
                Status: <strong>{connected ? "online" : "offline"}</strong>
              </div>
              <div className="chip">
                Key: <strong>{keyLabel(chat.keyStatus)}</strong>
              </div>
              <div className="chip">
                Participants: <strong>{ring.length}</strong>
              </div>
            </div>
          </div>

          <div className="stream" ref={streamRef}>
            {chat.messages.map((m) => {
              const isSys = m.kind === "system";
              const isMe = m.from === "me";
              const rowClass = isSys ? "block sysRow" : isMe ? "block meRow" : "block";
              const who = isSys ? "system" : isMe ? "me" : m.from;

              return (
                <div className={rowClass} key={m.id}>
                  <div className="metaRow2">
                    <span>{who}</span>
                    <span>{formatTime(m.ts)}</span>
                  </div>
                  <div className="bubble">{m.text}</div>
                </div>
              );
            })}
          </div>

          <div className="composer">
            <textarea
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                connected
                  ? chat.canSend
                    ? "Type a message. Enter to send, Shift+Enter for a new line."
                    : "Sending is locked: waiting for a ready key and a valid group."
                  : "No connection to the server."
              }
              disabled={!connected}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const out = text;
                  setText("");
                  void chat.sendPlaintext(out);
                }
              }}
            />
            <button
              className="btn btnPrimary"
              disabled={!chat.canSend}
              onClick={() => {
                const out = text;
                setText("");
                void chat.sendPlaintext(out);
              }}
            >
              Send
            </button>
            <div className="hint">
              Sending is allowed only when: WS is online, key is ready, cycleId is current, participants ≥ 3.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
